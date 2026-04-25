import { broadcast } from '../ipc/broadcast';
import { computeLevel } from '../lib/leveling';
import { getDatabase } from './database';

export interface UserRow {
  twitch_id: string;
  username: string;
  exp: number;
  level: number;
  watch_time_minutes: number;
  messages_sent: number;
  watch_streak: number;
  best_watch_streak: number;
  last_stream_attended: number | null;
  first_seen: string;
  last_seen: string;
}

export interface UserWithRank extends UserRow {
  rank: number;
}

export interface EventRow {
  id: number;
  type: string;
  twitch_user_id: string;
  data: string | null;
  exp_awarded: number;
  created_at: string;
}

export interface UserProfile extends UserWithRank {
  events: EventRow[];
}

export type SortKey =
  | 'exp'
  | 'level'
  | 'watch_time'
  | 'messages'
  | 'username'
  | 'last_seen';

const SORT_COLUMNS: Record<SortKey, string> = {
  exp: 'exp',
  level: 'level',
  watch_time: 'watch_time_minutes',
  messages: 'messages_sent',
  username: 'username',
  last_seen: 'last_seen',
};

export interface ListUsersOptions {
  sort?: SortKey;
  direction?: 'asc' | 'desc';
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListUsersResult {
  users: UserWithRank[];
  total: number;
}

export function upsertUser(twitchId: string, username: string): UserRow {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db
    .prepare('SELECT * FROM users WHERE twitch_id = ?')
    .get(twitchId) as UserRow | undefined;

  if (!existing) {
    db.prepare(
      `INSERT INTO users (twitch_id, username, first_seen, last_seen)
       VALUES (?, ?, ?, ?)`,
    ).run(twitchId, username, now, now);
    return db
      .prepare('SELECT * FROM users WHERE twitch_id = ?')
      .get(twitchId) as UserRow;
  }

  db.prepare('UPDATE users SET username = ?, last_seen = ? WHERE twitch_id = ?').run(
    username,
    now,
    twitchId,
  );
  return { ...existing, username, last_seen: now };
}

export function listUsers(opts: ListUsersOptions = {}): ListUsersResult {
  const db = getDatabase();
  const sort = opts.sort ?? 'exp';
  const direction = opts.direction === 'asc' ? 'ASC' : 'DESC';
  const column = SORT_COLUMNS[sort] ?? SORT_COLUMNS.exp;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const offset = Math.max(opts.offset ?? 0, 0);
  const searchRaw = opts.search?.trim();
  const searchLike = searchRaw ? `%${searchRaw}%` : null;

  const where = searchLike ? 'WHERE username LIKE ?' : '';
  const secondarySort = column === 'username' ? '' : ', username ASC';

  const sql = `SELECT u.*, (SELECT COUNT(*) + 1 FROM users u2 WHERE u2.exp > u.exp) AS rank
    FROM users u
    ${where}
    ORDER BY ${column} ${direction}${secondarySort}
    LIMIT ? OFFSET ?`;

  const params: unknown[] = [];
  if (searchLike) params.push(searchLike);
  params.push(limit, offset);

  const users = db.prepare(sql).all(...params) as UserWithRank[];

  const countSql = `SELECT COUNT(*) AS total FROM users ${where}`;
  const countParams: unknown[] = [];
  if (searchLike) countParams.push(searchLike);
  const { total } = db.prepare(countSql).get(...countParams) as { total: number };

  return { users, total };
}

export function getUserProfile(twitchId: string): UserProfile | null {
  const db = getDatabase();
  const user = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) + 1 FROM users u2 WHERE u2.exp > u.exp) AS rank
       FROM users u WHERE twitch_id = ?`,
    )
    .get(twitchId) as UserWithRank | undefined;
  if (!user) return null;

  const events = db
    .prepare('SELECT * FROM events WHERE twitch_user_id = ? ORDER BY id DESC LIMIT 50')
    .all(twitchId) as EventRow[];

  return { ...user, events };
}

export function adjustUserExp(
  twitchId: string,
  delta: number,
  reason?: string,
): UserWithRank | null {
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Delta must be a non-zero finite number.');
  }

  const db = getDatabase();
  const existing = db
    .prepare('SELECT * FROM users WHERE twitch_id = ?')
    .get(twitchId) as UserRow | undefined;
  if (!existing) throw new Error(`User ${twitchId} not found.`);

  const base = Number(
    (db.prepare("SELECT value FROM settings WHERE key = 'level_base'").get() as
      | { value: string }
      | undefined)?.value ?? '100',
  );
  const exponent = Number(
    (db.prepare("SELECT value FROM settings WHERE key = 'level_exponent'").get() as
      | { value: string }
      | undefined)?.value ?? '1.5',
  );

  const newTotal = Math.max(0, existing.exp + delta);
  const newLevel = computeLevel(newTotal, base, exponent);

  db.prepare('UPDATE users SET exp = ?, level = ? WHERE twitch_id = ?').run(
    newTotal,
    newLevel,
    twitchId,
  );

  db.prepare(
    `INSERT INTO events (type, twitch_user_id, data, exp_awarded, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    'admin',
    twitchId,
    JSON.stringify({ reason: reason ?? null, delta }),
    delta,
    new Date().toISOString(),
  );

  broadcast('users:exp-gained', {
    user: {
      id: existing.twitch_id,
      login: existing.username.toLowerCase(),
      displayName: existing.username,
    },
    amount: delta,
    source: 'admin',
    newTotal,
    newLevel,
  });

  return getUserWithRank(twitchId);
}

function getUserWithRank(twitchId: string): UserWithRank | null {
  const row = getDatabase()
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) + 1 FROM users u2 WHERE u2.exp > u.exp) AS rank
       FROM users u WHERE twitch_id = ?`,
    )
    .get(twitchId) as UserWithRank | undefined;
  return row ?? null;
}

export function resetUser(twitchId: string | null): { affected: number } {
  const db = getDatabase();
  const resetFields = `
    exp = 0, level = 1, watch_time_minutes = 0, messages_sent = 0,
    watch_streak = 0, best_watch_streak = 0, last_stream_attended = NULL`;

  if (twitchId) {
    const info = db
      .prepare(`UPDATE users SET ${resetFields} WHERE twitch_id = ?`)
      .run(twitchId);
    return { affected: info.changes };
  }

  const info = db.prepare(`UPDATE users SET ${resetFields}`).run();
  return { affected: info.changes };
}
