import { broadcast } from '../ipc/broadcast';
import { interpolate } from '../lib/command-logic';
import { getDatabase } from './database';
import { getSetting, updateSetting } from './settings-service';
import { getCurrentTokens, hasScopes, MODERATION_SCOPES } from './twitch-auth';
import type { ChatMessage } from './twitch-chat';
import { sendChat } from './twitch-chat';
import {
  deleteMessage,
  HelixError,
  timeoutUser,
} from './twitch-helix';

export type ModRule = 'links' | 'caps' | 'emotes' | 'repeat' | 'symbols';

export interface ModWarning {
  id: number;
  user_id: string;
  username: string;
  rule: string;
  message_text: string | null;
  action_taken: string;
  created_at: number;
}

export interface PermittedUser {
  user_id: string;
  username: string;
  created_at: number;
}

export interface ModWarningFilters {
  user_id?: string;
  rule?: string;
  search?: string;
  from?: number;
  to?: number;
  limit?: number;
}

export interface ModStatus {
  botMustBeMod: boolean;
  missingScopes: string[];
}

interface ModSettings {
  linksEnabled: boolean;
  linksWhitelist: string[];
  linksPermitSeconds: number;
  linksSubsExempt: boolean;
  capsEnabled: boolean;
  capsMinLength: number;
  capsMaxPercent: number;
  emoteEnabled: boolean;
  emoteMaxCount: number;
  repeatEnabled: boolean;
  repeatMaxCount: number;
  repeatWindowSeconds: number;
  symbolsEnabled: boolean;
  symbolsMinLength: number;
  symbolsMaxPercent: number;
  vipsExempt: boolean;
  escalation1: 'delete' | 'warn';
  escalation2Timeout: number;
  escalation3Timeout: number;
  escalation4Timeout: number;
}

interface Violation {
  rule: ModRule;
}

const MOD_KEYS = [
  'mod_links_enabled',
  'mod_links_whitelist',
  'mod_links_permit_seconds',
  'mod_links_subs_exempt',
  'mod_caps_enabled',
  'mod_caps_min_length',
  'mod_caps_max_percent',
  'mod_emote_enabled',
  'mod_emote_max_count',
  'mod_repeat_enabled',
  'mod_repeat_max_count',
  'mod_repeat_window_seconds',
  'mod_symbols_enabled',
  'mod_symbols_min_length',
  'mod_symbols_max_percent',
  'mod_vips_exempt',
  'mod_escalation_1',
  'mod_escalation_2_timeout',
  'mod_escalation_3_timeout',
  'mod_escalation_4_timeout',
] as const;

const URL_RE =
  /\b((?:https?:\/\/)?(?:www\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?:\/[^\s]*)?)/gi;

const repeatTracker = new Map<string, Array<{ text: string; timestamp: number }>>();
const offenseCounts = new Map<string, number>();
const temporaryPermits = new Map<string, { username: string; expiresAt: number }>();

let botMustBeMod = false;

export function getModSettings(): Record<string, string> {
  const rows = getDatabase()
    .prepare("SELECT key, value FROM settings WHERE key LIKE 'mod\\_%' ESCAPE '\\'")
    .all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function updateModSettings(updates: Record<string, unknown>): Record<string, string> {
  for (const [key, value] of Object.entries(updates)) {
    if (!MOD_KEYS.includes(key as (typeof MOD_KEYS)[number])) {
      throw new Error(`Unknown moderation setting: ${key}`);
    }
    updateSetting(key, value);
  }
  return getModSettings();
}

export function getModStatus(): ModStatus {
  return {
    botMustBeMod,
    missingScopes: MODERATION_SCOPES.filter((scope) => !hasScopes([scope])),
  };
}

export function listWarnings(filters: ModWarningFilters = {}): ModWarning[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.user_id) {
    clauses.push('user_id = ?');
    params.push(filters.user_id);
  }
  if (filters.rule) {
    clauses.push('rule = ?');
    params.push(filters.rule);
  }
  if (filters.search?.trim()) {
    clauses.push('username LIKE ?');
    params.push(`%${filters.search.trim()}%`);
  }
  if (filters.from) {
    clauses.push('created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    clauses.push('created_at <= ?');
    params.push(filters.to);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(filters.limit ?? 200, 1), 1000);
  params.push(limit);
  return getDatabase()
    .prepare(`SELECT * FROM mod_warnings ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params) as ModWarning[];
}

export function clearWarnings(userId?: string): { affected: number } {
  const info = userId
    ? getDatabase().prepare('DELETE FROM mod_warnings WHERE user_id = ?').run(userId)
    : getDatabase().prepare('DELETE FROM mod_warnings').run();
  return { affected: info.changes };
}

export function listPermittedUsers(): PermittedUser[] {
  return getDatabase()
    .prepare('SELECT * FROM mod_permitted_users ORDER BY username COLLATE NOCASE')
    .all() as PermittedUser[];
}

export function addPermittedUser(userId: string, username: string): PermittedUser {
  const id = userId.trim();
  const name = username.trim();
  if (!id || !name) throw new Error('User ID and username are required.');
  getDatabase()
    .prepare(
      `INSERT OR REPLACE INTO mod_permitted_users (user_id, username, created_at)
       VALUES (?, ?, unixepoch())`,
    )
    .run(id, name);
  const row = getDatabase()
    .prepare('SELECT * FROM mod_permitted_users WHERE user_id = ?')
    .get(id) as PermittedUser;
  return row;
}

export function removePermittedUser(userId: string): void {
  getDatabase().prepare('DELETE FROM mod_permitted_users WHERE user_id = ?').run(userId);
}

export async function handleModeration(msg: ChatMessage): Promise<boolean> {
  pruneTemporaryPermits();
  const settings = loadSettings();
  const permitHandled = await handlePermitCommand(msg, settings);
  if (permitHandled) return true;

  if (isExempt(msg, settings)) return false;

  const violation = findViolation(msg, settings);
  if (!violation) return false;

  await applyEscalation(msg, violation, settings);
  return true;
}

function loadSettings(): ModSettings {
  const bool = (key: string, fallback: boolean) => {
    const value = getSetting(key, String(fallback)) ?? String(fallback);
    return value === 'true' || value === '1';
  };
  const num = (key: string, fallback: number) => {
    const value = Number(getSetting(key, String(fallback)));
    return Number.isFinite(value) ? value : fallback;
  };
  return {
    linksEnabled: bool('mod_links_enabled', false),
    linksWhitelist: parseWhitelist(getSetting('mod_links_whitelist', '') ?? ''),
    linksPermitSeconds: num('mod_links_permit_seconds', 60),
    linksSubsExempt: bool('mod_links_subs_exempt', true),
    capsEnabled: bool('mod_caps_enabled', false),
    capsMinLength: num('mod_caps_min_length', 10),
    capsMaxPercent: num('mod_caps_max_percent', 70),
    emoteEnabled: bool('mod_emote_enabled', false),
    emoteMaxCount: num('mod_emote_max_count', 10),
    repeatEnabled: bool('mod_repeat_enabled', false),
    repeatMaxCount: num('mod_repeat_max_count', 3),
    repeatWindowSeconds: num('mod_repeat_window_seconds', 60),
    symbolsEnabled: bool('mod_symbols_enabled', false),
    symbolsMinLength: num('mod_symbols_min_length', 10),
    symbolsMaxPercent: num('mod_symbols_max_percent', 50),
    vipsExempt: bool('mod_vips_exempt', false),
    escalation1:
      getSetting('mod_escalation_1', 'delete') === 'warn' ? 'warn' : 'delete',
    escalation2Timeout: num('mod_escalation_2_timeout', 10),
    escalation3Timeout: num('mod_escalation_3_timeout', 600),
    escalation4Timeout: num('mod_escalation_4_timeout', 86400),
  };
}

async function handlePermitCommand(
  msg: ChatMessage,
  settings: ModSettings,
): Promise<boolean> {
  const prefix = getSetting('bot_prefix', '!') ?? '!';
  const parts = msg.message.trim().split(/\s+/);
  if (parts[0]?.toLowerCase() !== `${prefix}permit`) return false;
  if (!msg.user.roles.broadcaster && !msg.user.roles.moderator) return true;

  const usernameRaw = parts[1];
  const username = usernameRaw?.replace(/^@/, '').trim();
  if (!username) return true;

  const key = username.toLowerCase();
  temporaryPermits.set(key, {
    username,
    expiresAt: Date.now() + settings.linksPermitSeconds * 1000,
  });

  void sendChat(
    interpolate('{user} is permitted to post links for {seconds}s.', {
      user: username,
      seconds: settings.linksPermitSeconds,
    }),
  ).catch((err) => console.error('[mod] permit response failed:', err));

  return true;
}

function isExempt(msg: ChatMessage, settings: ModSettings): boolean {
  if (msg.user.roles.broadcaster || msg.user.roles.moderator) return true;
  if (settings.vipsExempt && msg.user.roles.vip) return true;
  if (settings.linksSubsExempt && msg.user.roles.subscriber) return true;
  if (isTemporaryPermitted(msg)) return true;
  const row = getDatabase()
    .prepare(
      `SELECT 1 FROM mod_permitted_users
       WHERE user_id = ?
          OR lower(username) = lower(?)
          OR lower(username) = lower(?)`,
    )
    .get(msg.user.id, msg.user.login, msg.user.displayName);
  return Boolean(row);
}

function isTemporaryPermitted(msg: ChatMessage): boolean {
  const login = msg.user.login.toLowerCase();
  const display = msg.user.displayName.toLowerCase();
  return temporaryPermits.has(login) || temporaryPermits.has(display);
}

function findViolation(msg: ChatMessage, settings: ModSettings): Violation | null {
  trackRepeatMessage(msg, settings);

  if (settings.linksEnabled && hasBlockedLink(msg.message, settings.linksWhitelist)) {
    return { rule: 'links' };
  }
  if (settings.capsEnabled && violatesCaps(msg.message, settings)) {
    return { rule: 'caps' };
  }
  if (settings.emoteEnabled && countEmotes(msg) > settings.emoteMaxCount) {
    return { rule: 'emotes' };
  }
  if (settings.repeatEnabled && violatesRepeat(msg, settings)) {
    return { rule: 'repeat' };
  }
  if (settings.symbolsEnabled && violatesSymbols(msg.message, settings)) {
    return { rule: 'symbols' };
  }
  return null;
}

function parseWhitelist(raw: string): string[] {
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase().replace(/^https?:\/\//, ''))
    .map((item) => item.replace(/^www\./, '').split('/')[0] ?? '')
    .filter(Boolean);
}

function hasBlockedLink(message: string, whitelist: string[]): boolean {
  const matches = message.matchAll(URL_RE);
  for (const match of matches) {
    const raw = match[1];
    if (!raw) continue;
    const host = extractHost(raw);
    if (!host) continue;
    const allowed = whitelist.some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
    if (!allowed) return true;
  }
  return false;
}

function extractHost(raw: string): string | null {
  try {
    const url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function violatesCaps(message: string, settings: ModSettings): boolean {
  if (message.length < settings.capsMinLength) return false;
  const letters = message.match(/[a-z]/gi) ?? [];
  if (letters.length === 0) return false;
  const uppercase = letters.filter((letter) => letter >= 'A' && letter <= 'Z').length;
  return (uppercase / letters.length) * 100 > settings.capsMaxPercent;
}

function countEmotes(msg: ChatMessage): number {
  if (!msg.emotes) return 0;
  return Object.values(msg.emotes).reduce((sum, ranges) => sum + ranges.length, 0);
}

function trackRepeatMessage(msg: ChatMessage, settings: ModSettings): void {
  const now = Date.now();
  const windowMs = settings.repeatWindowSeconds * 1000;
  const existing = repeatTracker.get(msg.user.id) ?? [];
  const recent = existing.filter((entry) => now - entry.timestamp <= windowMs);
  recent.push({ text: normalizeRepeatText(msg.message), timestamp: now });
  repeatTracker.set(msg.user.id, recent);
}

function violatesRepeat(msg: ChatMessage, settings: ModSettings): boolean {
  const text = normalizeRepeatText(msg.message);
  if (!text) return false;
  const recent = repeatTracker.get(msg.user.id) ?? [];
  const count = recent.filter((entry) => entry.text === text).length;
  return count > settings.repeatMaxCount;
}

function normalizeRepeatText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function violatesSymbols(message: string, settings: ModSettings): boolean {
  if (message.length < settings.symbolsMinLength) return false;
  const symbols = Array.from(message).filter((char) => /[^a-z0-9\s]/i.test(char));
  return (symbols.length / message.length) * 100 > settings.symbolsMaxPercent;
}

async function applyEscalation(
  msg: ChatMessage,
  violation: Violation,
  settings: ModSettings,
): Promise<void> {
  const count = (offenseCounts.get(msg.user.id) ?? 0) + 1;
  offenseCounts.set(msg.user.id, count);

  const actions: string[] = [];
  if (count === 1 && settings.escalation1 === 'warn') {
    actions.push('warn');
  } else {
    actions.push(await tryDeleteMessage(msg));
  }

  if (count === 2) {
    actions.push(await tryTimeout(msg, settings.escalation2Timeout, violation.rule));
  } else if (count === 3) {
    actions.push(await tryTimeout(msg, settings.escalation3Timeout, violation.rule));
  } else if (count >= 4) {
    actions.push(await tryTimeout(msg, settings.escalation4Timeout, violation.rule));
  }

  logWarning(msg, violation.rule, actions.join('+'));
}

async function tryDeleteMessage(msg: ChatMessage): Promise<string> {
  const tokens = getCurrentTokens();
  if (!tokens) return 'delete_failed:not_signed_in';
  if (!msg.id) return 'delete_failed:no_message_id';
  try {
    await deleteMessage(tokens.user.id, tokens.user.id, msg.id);
    clearBotMustBeMod();
    return 'delete';
  } catch (err) {
    return handleModActionError(err, 'delete_failed');
  }
}

async function tryTimeout(
  msg: ChatMessage,
  duration: number,
  rule: string,
): Promise<string> {
  const tokens = getCurrentTokens();
  if (!tokens) return 'timeout_failed:not_signed_in';
  try {
    await timeoutUser(
      tokens.user.id,
      tokens.user.id,
      msg.user.id,
      duration,
      `TwitchBot moderation: ${rule}`,
    );
    clearBotMustBeMod();
    return `timeout:${duration}`;
  } catch (err) {
    return handleModActionError(err, 'timeout_failed');
  }
}

function handleModActionError(err: unknown, fallback: string): string {
  if (err instanceof HelixError) {
    if (err.status === 403) {
      setBotMustBeMod();
      return `${fallback}:bot_not_mod`;
    }
    if (err.status === 401) return `${fallback}:reauth_required`;
    return `${fallback}:${err.status}`;
  }
  console.error('[mod] action failed:', err);
  return fallback;
}

function logWarning(msg: ChatMessage, rule: string, action: string): void {
  getDatabase()
    .prepare(
      `INSERT INTO mod_warnings (user_id, username, rule, message_text, action_taken)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(msg.user.id, msg.user.displayName, rule, msg.message, action);
  broadcast('mod:warnings-updated', { user_id: msg.user.id, rule });
}

function setBotMustBeMod(): void {
  if (botMustBeMod) return;
  botMustBeMod = true;
  broadcast('mod:status', getModStatus());
}

function clearBotMustBeMod(): void {
  if (!botMustBeMod) return;
  botMustBeMod = false;
  broadcast('mod:status', getModStatus());
}

function pruneTemporaryPermits(): void {
  const now = Date.now();
  for (const [key, value] of temporaryPermits) {
    if (value.expiresAt <= now) temporaryPermits.delete(key);
  }
}
