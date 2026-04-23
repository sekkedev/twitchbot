import { getDatabase } from './database';

export interface OverviewStats {
  totalUsers: number;
  totalExp: number;
  totalSessions: number;
  activeSessions: number;
  totalCommandUses: number;
  totalMessages: number;
  topChatters: Array<{ username: string; messages_sent: number }>;
  topByExp: Array<{ username: string; exp: number; level: number }>;
}

export interface ActivityBucket {
  bucket: string;
  messages: number;
  exp: number;
}

export interface TopCommand {
  name: string;
  usage_count: number;
}

export interface ActivityData {
  range: ActivityRange;
  buckets: ActivityBucket[];
  topCommands: TopCommand[];
  sessions: Array<{
    id: number;
    started_at: string;
    ended_at: string | null;
    peak_viewers: number;
  }>;
}

export type ActivityRange = 'day' | 'week' | 'month';

export function getOverview(): OverviewStats {
  const db = getDatabase();
  const totalUsers =
    (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  const totalExpRow = db.prepare('SELECT COALESCE(SUM(exp), 0) AS n FROM users').get() as
    | { n: number }
    | undefined;
  const totalSessions =
    (db.prepare('SELECT COUNT(*) AS n FROM sessions').get() as { n: number }).n;
  const activeSessions = (
    db
      .prepare('SELECT COUNT(*) AS n FROM sessions WHERE ended_at IS NULL')
      .get() as { n: number }
  ).n;
  const totalCommandUses =
    (
      db
        .prepare('SELECT COALESCE(SUM(usage_count), 0) AS n FROM commands')
        .get() as { n: number }
    ).n;
  const totalMessages =
    (
      db
        .prepare('SELECT COALESCE(SUM(messages_sent), 0) AS n FROM users')
        .get() as { n: number }
    ).n;

  const topChatters = db
    .prepare(
      `SELECT username, messages_sent FROM users
       WHERE messages_sent > 0
       ORDER BY messages_sent DESC LIMIT 5`,
    )
    .all() as Array<{ username: string; messages_sent: number }>;

  const topByExp = db
    .prepare(
      `SELECT username, exp, level FROM users
       WHERE exp > 0
       ORDER BY exp DESC LIMIT 5`,
    )
    .all() as Array<{ username: string; exp: number; level: number }>;

  return {
    totalUsers,
    totalExp: totalExpRow?.n ?? 0,
    totalSessions,
    activeSessions,
    totalCommandUses,
    totalMessages,
    topChatters,
    topByExp,
  };
}

export function getActivity(range: ActivityRange = 'week'): ActivityData {
  const db = getDatabase();
  // Bucket size + window varies by range.
  const config = {
    day: { bucketFmt: '%Y-%m-%dT%H:00:00Z', windowDays: 1 },
    week: { bucketFmt: '%Y-%m-%d', windowDays: 7 },
    month: { bucketFmt: '%Y-%m-%d', windowDays: 30 },
  }[range];

  const buckets = db
    .prepare(
      `SELECT
         strftime(?, created_at) AS bucket,
         SUM(CASE WHEN type = 'message' THEN 1 ELSE 0 END) AS messages,
         COALESCE(SUM(exp_awarded), 0) AS exp
       FROM events
       WHERE created_at >= datetime('now', ?)
       GROUP BY bucket
       ORDER BY bucket ASC`,
    )
    .all(config.bucketFmt, `-${config.windowDays} days`) as ActivityBucket[];

  const topCommands = db
    .prepare(
      `SELECT name, usage_count FROM commands
       WHERE usage_count > 0
       ORDER BY usage_count DESC LIMIT 10`,
    )
    .all() as TopCommand[];

  const sessions = db
    .prepare(
      `SELECT id, started_at, ended_at, peak_viewers FROM sessions
       WHERE started_at >= datetime('now', ?)
       ORDER BY id DESC`,
    )
    .all(`-${config.windowDays} days`) as Array<{
    id: number;
    started_at: string;
    ended_at: string | null;
    peak_viewers: number;
  }>;

  return { range, buckets, topCommands, sessions };
}
