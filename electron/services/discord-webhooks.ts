/**
 * Discord webhook service: URL storage, embed templates, and the payload
 * builder that resolves template variables across every embed string field.
 */

import { interpolate } from '../lib/command-logic';
import { deleteSetting, getAllSettings, getSetting, updateSetting } from './settings-service';

export interface DiscordEmbedField {
  name: string;
  value: string;
  inline?: boolean;
}

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  author?: { name: string; icon_url?: string };
  thumbnail?: { url: string };
  fields?: DiscordEmbedField[];
  footer?: { text: string };
  timestamp?: boolean;
}

export interface EmbedTemplate {
  name: string;
  embed: DiscordEmbed;
}

export interface SendOptions {
  content?: string;
  embed?: DiscordEmbed;
}

export type TemplateVars = Record<string, string | number>;

const WEBHOOK_PREFIX = 'discord_webhook_';
const TEMPLATE_PREFIX = 'discord_embed_template_';

export function normalizeWebhookKey(key: string): string {
  const normalized = key
    .trim()
    .toLowerCase()
    .replace(new RegExp(`^${WEBHOOK_PREFIX}`), '')
    .replace(/[^a-z0-9_-]/g, '_');
  if (!normalized) throw new Error('Webhook name is required.');
  return normalized;
}

export function normalizeTemplateName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(new RegExp(`^${TEMPLATE_PREFIX}`), '')
    .replace(/[^a-z0-9_-]/g, '_');
  if (!normalized) throw new Error('Template name is required.');
  return normalized;
}

// ── webhook URL CRUD ──

export function listWebhooks(): Array<{ key: string; url: string }> {
  return Object.entries(getAllSettings())
    .filter(([key]) => key.startsWith(WEBHOOK_PREFIX))
    .map(([key, url]) => ({
      key: key.slice(WEBHOOK_PREFIX.length),
      url,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function saveWebhook(key: string, url: string): void {
  const normalized = normalizeWebhookKey(key);
  updateSetting(`${WEBHOOK_PREFIX}${normalized}`, url);
}

export function deleteWebhook(key: string): void {
  const normalized = normalizeWebhookKey(key);
  deleteSetting(`${WEBHOOK_PREFIX}${normalized}`);
}

export function getWebhookUrl(key: string): string {
  const normalized = normalizeWebhookKey(key);
  return getSetting(`${WEBHOOK_PREFIX}${normalized}`, '') ?? '';
}

// ── embed template CRUD ──

export function listEmbedTemplates(): EmbedTemplate[] {
  return Object.entries(getAllSettings())
    .filter(([key]) => key.startsWith(TEMPLATE_PREFIX))
    .map(([key, value]) => ({
      name: key.slice(TEMPLATE_PREFIX.length),
      embed: parseEmbed(value),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function saveEmbedTemplate(name: string, embed: DiscordEmbed): EmbedTemplate {
  const normalized = normalizeTemplateName(name);
  const sanitized = sanitizeEmbed(embed);
  updateSetting(`${TEMPLATE_PREFIX}${normalized}`, JSON.stringify(sanitized));
  return { name: normalized, embed: sanitized };
}

export function deleteEmbedTemplate(name: string): void {
  const normalized = normalizeTemplateName(name);
  deleteSetting(`${TEMPLATE_PREFIX}${normalized}`);
}

// ── send ──

export async function sendWebhook(
  key: string,
  options: SendOptions,
  vars: TemplateVars = {},
): Promise<void> {
  const url = getWebhookUrl(key);
  if (!url) {
    console.warn(`[discord] webhook ${key} is empty`);
    return;
  }
  await postToUrl(url, options, vars);
}

export async function testEmbed(
  webhookKey: string,
  embed: DiscordEmbed,
  vars: TemplateVars = MOCK_VARS,
): Promise<void> {
  const url = getWebhookUrl(webhookKey);
  if (!url) throw new Error('Webhook URL is empty.');
  await postToUrl(url, { embed }, vars);
}

export function buildPayload(
  options: SendOptions,
  vars: TemplateVars,
): { content?: string; embeds?: object[] } {
  const payload: { content?: string; embeds?: object[] } = {};
  if (options.content?.trim()) {
    payload.content = interpolate(options.content, vars);
  }
  if (options.embed) {
    const built = buildEmbed(options.embed, vars);
    if (built) payload.embeds = [built];
  }
  return payload;
}

const MOCK_VARS: TemplateVars = {
  user: 'TestUser',
  event: 'raid',
  raider: 'TestUser',
  raid_size: 42,
  raid_viewers: 42,
  from_channel: 'testuser',
  tier: '1000',
  tier_label: 'Tier 1',
  months: 6,
  is_gift: 'no',
  is_anonymous: 'no',
  total: 5,
  sub_message: 'thanks for the stream!',
  bits: 500,
  cheer_message: 'cheer500 amazing!',
  timestamp: new Date().toISOString(),
};

async function postToUrl(
  url: string,
  options: SendOptions,
  vars: TemplateVars,
): Promise<void> {
  const payload = buildPayload(options, vars);
  if (!payload.content && !payload.embeds) {
    throw new Error('Webhook payload is empty.');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
  }
}

function buildEmbed(embed: DiscordEmbed, vars: TemplateVars): object | null {
  const out: Record<string, unknown> = {};
  const title = resolveString(embed.title, vars);
  if (title) out.title = title;
  const description = resolveString(embed.description, vars);
  if (description) out.description = description;
  if (typeof embed.color === 'number' && Number.isFinite(embed.color)) {
    out.color = clampColor(embed.color);
  }
  if (embed.author?.name) {
    const author: Record<string, string> = {
      name: interpolate(embed.author.name, vars),
    };
    const iconUrl = resolveString(embed.author.icon_url, vars);
    if (iconUrl) author.icon_url = iconUrl;
    out.author = author;
  }
  const thumbnailUrl = resolveString(embed.thumbnail?.url, vars);
  if (thumbnailUrl) out.thumbnail = { url: thumbnailUrl };
  if (embed.fields?.length) {
    const fields = embed.fields
      .map((field) => ({
        name: interpolate(field.name ?? '', vars),
        value: interpolate(field.value ?? '', vars),
        inline: Boolean(field.inline),
      }))
      .filter((field) => field.name && field.value);
    if (fields.length) out.fields = fields;
  }
  if (embed.footer?.text) {
    out.footer = { text: interpolate(embed.footer.text, vars) };
  }
  if (embed.timestamp) {
    out.timestamp = new Date().toISOString();
  }
  return Object.keys(out).length > 0 ? out : null;
}

function resolveString(
  value: string | undefined,
  vars: TemplateVars,
): string | undefined {
  if (!value) return undefined;
  const resolved = interpolate(value, vars).trim();
  return resolved ? resolved : undefined;
}

function clampColor(color: number): number {
  return Math.max(0, Math.min(0xffffff, Math.floor(color)));
}

function parseEmbed(raw: string): DiscordEmbed {
  try {
    const parsed = JSON.parse(raw) as DiscordEmbed;
    return sanitizeEmbed(parsed);
  } catch {
    return {};
  }
}

function sanitizeEmbed(embed: DiscordEmbed): DiscordEmbed {
  const out: DiscordEmbed = {};
  if (typeof embed.title === 'string') out.title = embed.title;
  if (typeof embed.description === 'string') out.description = embed.description;
  if (typeof embed.color === 'number' && Number.isFinite(embed.color)) {
    out.color = clampColor(embed.color);
  }
  if (embed.author && typeof embed.author.name === 'string') {
    out.author = { name: embed.author.name };
    if (typeof embed.author.icon_url === 'string') {
      out.author.icon_url = embed.author.icon_url;
    }
  }
  if (embed.thumbnail && typeof embed.thumbnail.url === 'string') {
    out.thumbnail = { url: embed.thumbnail.url };
  }
  if (Array.isArray(embed.fields)) {
    out.fields = embed.fields
      .filter(
        (field): field is DiscordEmbedField =>
          !!field && typeof field.name === 'string' && typeof field.value === 'string',
      )
      .map((field) => ({
        name: field.name,
        value: field.value,
        inline: Boolean(field.inline),
      }));
  }
  if (embed.footer && typeof embed.footer.text === 'string') {
    out.footer = { text: embed.footer.text };
  }
  if (embed.timestamp) out.timestamp = true;
  return out;
}
