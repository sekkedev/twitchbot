import { broadcast } from '../ipc/broadcast';
import { interpolate } from '../lib/command-logic';
import { getDatabase } from './database';
import {
  getEmbedTemplate,
  sendWebhook,
  type DiscordEmbed,
} from './discord-webhooks';
import { getSetting, updateSetting } from './settings-service';
import { getCurrentTokens, hasScopes, MODERATION_SCOPES } from './twitch-auth';
import type { ChatMessage } from './twitch-chat';
import { sendChat } from './twitch-chat';
import {
  deleteMessage,
  HelixError,
  timeoutUser,
} from './twitch-helix';

export type ModRule =
  | 'links'
  | 'caps'
  | 'emotes'
  | 'repeat'
  | 'symbols'
  | 'blocked_words'
  | 'first_message';

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
  blockedWordsEnabled: boolean;
  blockedWords: string[];
  firstMessageScreening: boolean;
  vipsExempt: boolean;
  escalation1: 'delete' | 'warn';
  escalation2Timeout: number;
  escalation3Timeout: number;
  escalation4Timeout: number;
  startTierByRule: Record<ModRule, number>;
  discordWebhookEnabled: boolean;
  discordWebhookKey: string;
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
  'mod_blocked_words',
  'mod_blocked_words_enabled',
  'mod_first_message_screening',
  'mod_vips_exempt',
  'mod_escalation_1',
  'mod_escalation_2_timeout',
  'mod_escalation_3_timeout',
  'mod_escalation_4_timeout',
  'mod_links_start_tier',
  'mod_caps_start_tier',
  'mod_emote_start_tier',
  'mod_repeat_start_tier',
  'mod_symbols_start_tier',
  'mod_blocked_words_start_tier',
  'mod_first_message_start_tier',
  'mod_discord_webhook_key',
  'mod_discord_webhook_enabled',
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

export interface ModWarningsPageParams {
  page?: number;
  pageSize?: number;
  ruleFilter?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface ModWarningsPage {
  warnings: ModWarning[];
  total: number;
  page: number;
  pageSize: number;
}

export function listWarningsPage(params: ModWarningsPageParams = {}): ModWarningsPage {
  const pageSize = clampInt(params.pageSize ?? 25, 1, 200);
  const page = Math.max(1, Math.floor(params.page ?? 1));
  const order = params.sortOrder === 'asc' ? 'ASC' : 'DESC';

  const where: string[] = [];
  const args: unknown[] = [];
  if (params.ruleFilter) {
    where.push('rule = ?');
    args.push(params.ruleFilter);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS n FROM mod_warnings ${whereSql}`)
      .get(...args) as { n: number }
  ).n;

  const offset = (page - 1) * pageSize;
  const warnings = getDatabase()
    .prepare(
      `SELECT * FROM mod_warnings ${whereSql}
       ORDER BY created_at ${order}, id ${order}
       LIMIT ? OFFSET ?`,
    )
    .all(...args, pageSize, offset) as ModWarning[];

  return { warnings, total, page, pageSize };
}

export interface ModStats {
  byTimeframe: { today: number; last7Days: number; last30Days: number };
  byRule: Array<{ rule: string; count: number }>;
  byAction: Array<{ action: string; count: number }>;
  topUsers: Array<{ user_id: string; username: string; count: number }>;
}

export function getModStats(): ModStats {
  const db = getDatabase();
  const now = Math.floor(Date.now() / 1000);
  const dayAgo = now - 24 * 60 * 60;
  const weekAgo = now - 7 * 24 * 60 * 60;
  const monthAgo = now - 30 * 24 * 60 * 60;

  const countSince = (since: number): number =>
    (
      db
        .prepare('SELECT COUNT(*) AS n FROM mod_warnings WHERE created_at >= ?')
        .get(since) as { n: number }
    ).n;

  const byRule = db
    .prepare(
      `SELECT rule, COUNT(*) AS count FROM mod_warnings
       GROUP BY rule
       ORDER BY count DESC`,
    )
    .all() as Array<{ rule: string; count: number }>;

  const byAction = db
    .prepare(
      `SELECT action_taken AS action, COUNT(*) AS count FROM mod_warnings
       GROUP BY action_taken
       ORDER BY count DESC`,
    )
    .all() as Array<{ action: string; count: number }>;

  const topUsers = db
    .prepare(
      `SELECT user_id, username, COUNT(*) AS count FROM mod_warnings
       WHERE created_at >= ?
       GROUP BY user_id
       ORDER BY count DESC
       LIMIT 5`,
    )
    .all(monthAgo) as Array<{ user_id: string; username: string; count: number }>;

  return {
    byTimeframe: {
      today: countSince(dayAgo),
      last7Days: countSince(weekAgo),
      last30Days: countSince(monthAgo),
    },
    byRule,
    byAction,
    topUsers,
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
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
  const tier = (key: string) => {
    const n = Math.floor(num(key, 1));
    return Math.min(4, Math.max(1, n));
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
    blockedWordsEnabled: bool('mod_blocked_words_enabled', false),
    blockedWords: parseBlockedWords(getSetting('mod_blocked_words', '[]') ?? '[]'),
    firstMessageScreening: bool('mod_first_message_screening', false),
    vipsExempt: bool('mod_vips_exempt', false),
    escalation1:
      getSetting('mod_escalation_1', 'delete') === 'warn' ? 'warn' : 'delete',
    escalation2Timeout: num('mod_escalation_2_timeout', 10),
    escalation3Timeout: num('mod_escalation_3_timeout', 600),
    escalation4Timeout: num('mod_escalation_4_timeout', 86400),
    startTierByRule: {
      links: tier('mod_links_start_tier'),
      caps: tier('mod_caps_start_tier'),
      emotes: tier('mod_emote_start_tier'),
      repeat: tier('mod_repeat_start_tier'),
      symbols: tier('mod_symbols_start_tier'),
      blocked_words: tier('mod_blocked_words_start_tier'),
      first_message: tier('mod_first_message_start_tier'),
    },
    discordWebhookEnabled: bool('mod_discord_webhook_enabled', false),
    discordWebhookKey: getSetting('mod_discord_webhook_key', '') ?? '',
  };
}

function parseBlockedWords(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.toLowerCase())
      .filter(Boolean);
  } catch {
    return [];
  }
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

  if (
    settings.firstMessageScreening &&
    !msg.user.roles.subscriber &&
    isFirstMessageUser(msg.user.id)
  ) {
    return { rule: 'first_message' };
  }
  if (
    settings.blockedWordsEnabled &&
    hasBlockedWord(msg.message, settings.blockedWords)
  ) {
    return { rule: 'blocked_words' };
  }
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

function hasBlockedWord(message: string, words: string[]): boolean {
  if (words.length === 0) return false;
  const haystack = message.toLowerCase();
  return words.some((word) => word.length > 0 && haystack.includes(word));
}

function isFirstMessageUser(userId: string): boolean {
  const row = getDatabase()
    .prepare('SELECT messages_sent FROM users WHERE twitch_id = ?')
    .get(userId) as { messages_sent: number } | undefined;
  // The chat pipeline upserts the user row before moderation runs, so a
  // genuinely-new user shows messages_sent === 0.
  return !row || row.messages_sent === 0;
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
  const rawCount = (offenseCounts.get(msg.user.id) ?? 0) + 1;
  offenseCounts.set(msg.user.id, rawCount);

  // Per-rule override: a start_tier of N means the first offense lands on
  // tier N. Cap at 4 (the most severe tier).
  const offset = settings.startTierByRule[violation.rule] - 1;
  const tier = Math.min(4, rawCount + offset);

  const actions: string[] = [];
  if (tier === 1 && settings.escalation1 === 'warn') {
    actions.push('warn');
  } else {
    actions.push(await tryDeleteMessage(msg));
  }

  if (tier === 2) {
    actions.push(await tryTimeout(msg, settings.escalation2Timeout, violation.rule));
  } else if (tier === 3) {
    actions.push(await tryTimeout(msg, settings.escalation3Timeout, violation.rule));
  } else if (tier >= 4) {
    actions.push(await tryTimeout(msg, settings.escalation4Timeout, violation.rule));
  }

  const actionTaken = actions.join('+');
  logWarning(msg, violation.rule, actionTaken);
  if (settings.discordWebhookEnabled && settings.discordWebhookKey) {
    void dispatchDiscordAlert(msg, violation.rule, actionTaken, settings).catch(
      (err) => console.error('[mod] discord alert failed:', err),
    );
  }
}

async function dispatchDiscordAlert(
  msg: ChatMessage,
  rule: ModRule,
  action: string,
  settings: ModSettings,
): Promise<void> {
  const embed = getEmbedTemplate('moderation')?.embed ?? FALLBACK_MOD_EMBED;
  const snippet = truncate(msg.message, 100);
  await sendWebhook(
    settings.discordWebhookKey,
    { embed },
    {
      username: msg.user.displayName,
      user_id: msg.user.id,
      rule,
      action,
      message: msg.message,
      message_snippet: snippet,
      event: 'moderation',
      timestamp: new Date().toISOString(),
    },
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

const FALLBACK_MOD_EMBED: DiscordEmbed = {
  title: 'Moderation Action',
  color: 0xff4444,
  fields: [
    { name: 'User', value: '{username}', inline: true },
    { name: 'Rule', value: '{rule}', inline: true },
    { name: 'Action', value: '{action}', inline: true },
    { name: 'Message', value: '{message_snippet}', inline: false },
  ],
  footer: { text: 'TwitchBot moderation' },
  timestamp: true,
};

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
