import { broadcast } from '../ipc/broadcast';
import {
  canExecute as canExecuteRoles,
  interpolate,
  normalizeCommandName,
  safeParsePermissions,
  validateCommandName,
  type Role,
} from '../lib/command-logic';
import { getDatabase } from './database';
import { isFollower } from './follower-cache';
import type { ChatMessage } from './twitch-chat';
import { sendChat } from './twitch-chat';

export type { Role } from '../lib/command-logic';
export { interpolate } from '../lib/command-logic';

export interface CustomCommand {
  id: number;
  name: string;
  response: string;
  cooldown_seconds: number;
  permissions: Role[];
  enabled: boolean;
  usage_count: number;
  created_at: string;
}

interface CommandRow {
  id: number;
  name: string;
  response: string;
  cooldown_seconds: number;
  permissions: string;
  enabled: number;
  usage_count: number;
  created_at: string;
}

interface UserRow {
  twitch_id: string;
  username: string;
  exp: number;
  level: number;
  watch_time_minutes: number;
  messages_sent: number;
  watch_streak: number;
  best_watch_streak: number;
}

interface BuiltinSpec {
  name: string;
  aliases?: string[];
  cooldown: number;
  permissions: Role[];
  build: (ctx: CommandContext) => Promise<string> | string;
}

interface CommandContext {
  msg: ChatMessage;
  args: string[];
}

const MAX_CHAT_LENGTH = 480;
const commandCooldowns = new Map<string, number>();
let globalCooldownUntil = 0;

function getSetting(key: string, fallback: string): string {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

function getPrefix(): string {
  return getSetting('bot_prefix', '!');
}

function getGlobalCooldownSeconds(): number {
  return Number(getSetting('global_cooldown_seconds', '2'));
}

export function canExecute(permissions: Role[], user: ChatMessage['user']): boolean {
  return canExecuteRoles(permissions, user.roles);
}

/**
 * Async permission check that additionally resolves `follower` via a Helix
 * lookup when the sync check would deny. Use this during actual command
 * execution; the sync `canExecute` is still fine for UI-only decisions.
 */
async function canExecuteAsync(
  permissions: Role[],
  user: ChatMessage['user'],
): Promise<boolean> {
  if (canExecuteRoles(permissions, user.roles)) return true;
  if (!permissions.includes('follower')) return false;
  return isFollower(user.id);
}

async function buildVariables(
  msg: ChatMessage,
  customUsageCount?: number,
): Promise<Record<string, string | number>> {
  const db = getDatabase();
  const userRow = db
    .prepare('SELECT * FROM users WHERE twitch_id = ?')
    .get(msg.user.id) as UserRow | undefined;

  const exp = userRow?.exp ?? 0;
  const level = userRow?.level ?? 1;
  const watchMin = userRow?.watch_time_minutes ?? 0;
  const streak = userRow?.watch_streak ?? 0;
  const bestStreak = userRow?.best_watch_streak ?? 0;
  const messages = userRow?.messages_sent ?? 0;

  let rank: string | number = '—';
  if (userRow) {
    const row = db
      .prepare('SELECT COUNT(*) as n FROM users WHERE exp > ?')
      .get(exp) as { n: number };
    rank = row.n + 1;
  }

  return {
    user: msg.user.displayName,
    level,
    exp,
    watch_time: (watchMin / 60).toFixed(1),
    streak,
    best_streak: bestStreak,
    messages,
    rank,
    channel: msg.channel,
    uptime: 'offline',
    count: customUsageCount ?? 0,
  };
}

const BUILTINS: BuiltinSpec[] = [
  {
    name: 'rank',
    cooldown: 5,
    permissions: ['everyone'],
    build: async ({ msg }) => {
      const v = await buildVariables(msg);
      return `You are level ${v.level} (${v.exp} EXP) -- ranked #${v.rank}`;
    },
  },
  {
    name: 'leaderboard',
    aliases: ['top'],
    cooldown: 10,
    permissions: ['everyone'],
    build: () => {
      const rows = getDatabase()
        .prepare('SELECT username, exp, level FROM users ORDER BY exp DESC LIMIT 5')
        .all() as { username: string; exp: number; level: number }[];
      if (rows.length === 0) return 'No ranked users yet.';
      return (
        'Top viewers: ' +
        rows
          .map((r, i) => `${i + 1}. ${r.username} (L${r.level}, ${r.exp} EXP)`)
          .join(' | ')
      );
    },
  },
  {
    name: 'streak',
    cooldown: 5,
    permissions: ['everyone'],
    build: async ({ msg }) => {
      const v = await buildVariables(msg);
      return `${v.user}: current watch streak ${v.streak}, best ${v.best_streak}`;
    },
  },
  {
    name: 'watchtime',
    cooldown: 5,
    permissions: ['everyone'],
    build: async ({ msg }) => {
      const v = await buildVariables(msg);
      return `${v.user}: ${v.watch_time}h total watch time`;
    },
  },
  {
    name: 'commands',
    cooldown: 10,
    permissions: ['everyone'],
    build: () => {
      const prefix = getPrefix();
      const builtinNames = BUILTINS.map((b) => `${prefix}${b.name}`).join(' ');
      const rows = getDatabase()
        .prepare('SELECT name FROM commands WHERE enabled = 1 ORDER BY name')
        .all() as { name: string }[];
      if (rows.length === 0) return `Built-ins: ${builtinNames}`;
      const custom = rows.map((r) => `${prefix}${r.name}`).join(' ');
      return `Built-ins: ${builtinNames} | Custom: ${custom}`;
    },
  },
];

const BUILTIN_NAMES = new Set<string>();
for (const b of BUILTINS) {
  BUILTIN_NAMES.add(b.name);
  for (const a of b.aliases ?? []) BUILTIN_NAMES.add(a);
}

export function isReservedBuiltinName(name: string): boolean {
  return BUILTIN_NAMES.has(name.toLowerCase());
}

function findBuiltin(name: string): BuiltinSpec | undefined {
  return BUILTINS.find((b) => b.name === name || b.aliases?.includes(name));
}

async function sendResponse(text: string): Promise<void> {
  const trimmed = text.length > MAX_CHAT_LENGTH ? text.slice(0, MAX_CHAT_LENGTH - 1) + '…' : text;
  try {
    await sendChat(trimmed);
  } catch (err) {
    console.error('[cmd] sendChat failed:', err);
  }
}

export async function handleChatMessage(msg: ChatMessage): Promise<void> {
  const prefix = getPrefix();
  if (!msg.message.startsWith(prefix)) return;

  const trimmed = msg.message.slice(prefix.length).trim();
  if (!trimmed) return;

  const parts = trimmed.split(/\s+/);
  const name = parts[0]!.toLowerCase();
  const args = parts.slice(1);

  const now = Date.now();
  if (now < globalCooldownUntil) return;

  const builtin = findBuiltin(name);
  if (builtin) {
    await runBuiltin(builtin, { msg, args }, now);
    return;
  }

  await runCustom(name, msg, now);
}

async function runBuiltin(
  spec: BuiltinSpec,
  ctx: CommandContext,
  now: number,
): Promise<void> {
  if (!(await canExecuteAsync(spec.permissions, ctx.msg.user))) return;
  const key = `builtin:${spec.name}`;
  const last = commandCooldowns.get(key) ?? 0;
  if (now < last + spec.cooldown * 1000) return;

  let response: string;
  try {
    response = await spec.build(ctx);
  } catch (err) {
    console.error(`[cmd] builtin ${spec.name} failed:`, err);
    return;
  }

  commandCooldowns.set(key, now);
  globalCooldownUntil = now + getGlobalCooldownSeconds() * 1000;
  await sendResponse(response);

  broadcast('commands:executed', {
    command: spec.name,
    kind: 'builtin',
    user: ctx.msg.user.displayName,
    timestamp: new Date().toISOString(),
  });
}

async function runCustom(name: string, msg: ChatMessage, now: number): Promise<void> {
  const db = getDatabase();
  const row = db
    .prepare('SELECT * FROM commands WHERE name = ? AND enabled = 1')
    .get(name) as CommandRow | undefined;
  if (!row) return;

  const permissions = safeParsePermissions(row.permissions);
  if (!(await canExecuteAsync(permissions, msg.user))) return;

  const key = `custom:${row.id}`;
  const last = commandCooldowns.get(key) ?? 0;
  if (now < last + row.cooldown_seconds * 1000) return;

  const vars = await buildVariables(msg, row.usage_count + 1);
  const response = interpolate(row.response, vars);

  commandCooldowns.set(key, now);
  globalCooldownUntil = now + getGlobalCooldownSeconds() * 1000;
  await sendResponse(response);

  db.prepare('UPDATE commands SET usage_count = usage_count + 1 WHERE id = ?').run(row.id);

  broadcast('commands:executed', {
    command: row.name,
    kind: 'custom',
    user: msg.user.displayName,
    timestamp: new Date().toISOString(),
  });
}

function rowToCommand(row: CommandRow): CustomCommand {
  return {
    id: row.id,
    name: row.name,
    response: row.response,
    cooldown_seconds: row.cooldown_seconds,
    permissions: safeParsePermissions(row.permissions),
    enabled: row.enabled === 1,
    usage_count: row.usage_count,
    created_at: row.created_at,
  };
}

export function listCommands(): CustomCommand[] {
  const rows = getDatabase()
    .prepare('SELECT * FROM commands ORDER BY name')
    .all() as CommandRow[];
  return rows.map(rowToCommand);
}

export interface CommandInput {
  name: string;
  response: string;
  cooldown_seconds?: number;
  permissions?: Role[];
  enabled?: boolean;
}

function normalizeName(name: string): string {
  return normalizeCommandName(name);
}

function validateName(name: string): void {
  const result = validateCommandName(name);
  if (!result.valid) throw new Error(result.reason ?? 'Invalid command name.');
  if (isReservedBuiltinName(name)) {
    throw new Error(`"${name}" is reserved by a built-in command.`);
  }
}

export function createCommand(input: CommandInput): CustomCommand {
  const name = normalizeName(input.name);
  validateName(name);
  const response = input.response.trim();
  if (!response) throw new Error('Response cannot be empty.');

  const db = getDatabase();
  const now = new Date().toISOString();
  const stmt = db.prepare(
    `INSERT INTO commands (name, response, cooldown_seconds, permissions, enabled, usage_count, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?)`,
  );
  try {
    const info = stmt.run(
      name,
      response,
      input.cooldown_seconds ?? 5,
      JSON.stringify(input.permissions ?? ['everyone']),
      input.enabled === false ? 0 : 1,
      now,
    );
    const row = db
      .prepare('SELECT * FROM commands WHERE id = ?')
      .get(info.lastInsertRowid) as CommandRow;
    return rowToCommand(row);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      throw new Error(`A command named "${name}" already exists.`);
    }
    throw err;
  }
}

export interface CommandUpdate {
  id: number;
  name?: string;
  response?: string;
  cooldown_seconds?: number;
  permissions?: Role[];
  enabled?: boolean;
}

export function updateCommand(update: CommandUpdate): CustomCommand {
  const db = getDatabase();
  const existing = db
    .prepare('SELECT * FROM commands WHERE id = ?')
    .get(update.id) as CommandRow | undefined;
  if (!existing) throw new Error(`Command ${update.id} not found.`);

  const name = update.name ? normalizeName(update.name) : existing.name;
  if (update.name) validateName(name);

  const response = update.response?.trim() ?? existing.response;
  if (!response) throw new Error('Response cannot be empty.');

  const cooldown =
    update.cooldown_seconds !== undefined ? update.cooldown_seconds : existing.cooldown_seconds;
  const permissions =
    update.permissions !== undefined
      ? JSON.stringify(update.permissions)
      : existing.permissions;
  const enabled =
    update.enabled === undefined ? existing.enabled : update.enabled ? 1 : 0;

  try {
    db.prepare(
      `UPDATE commands SET name = ?, response = ?, cooldown_seconds = ?, permissions = ?, enabled = ?
       WHERE id = ?`,
    ).run(name, response, cooldown, permissions, enabled, update.id);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      throw new Error(`A command named "${name}" already exists.`);
    }
    throw err;
  }

  const row = db.prepare('SELECT * FROM commands WHERE id = ?').get(update.id) as CommandRow;
  return rowToCommand(row);
}

export function deleteCommand(id: number): void {
  const info = getDatabase().prepare('DELETE FROM commands WHERE id = ?').run(id);
  if (info.changes === 0) throw new Error(`Command ${id} not found.`);
  commandCooldowns.delete(`custom:${id}`);
}
