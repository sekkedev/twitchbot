import { broadcast } from '../ipc/broadcast';
import { getDatabase } from './database';
import { awardExp } from './exp-engine';
import type { ChatMessage } from './twitch-chat';

export interface SessionRow {
  id: number;
  started_at: string;
  ended_at: string | null;
  peak_viewers: number;
}

const PRESENCE_TIMEOUT_MS = 5 * 60 * 1000;
const TICK_INTERVAL_MS = 60 * 1000;

let currentSessionId: number | null = null;
let prevSessionId: number | null = null;
let tickTimer: NodeJS.Timeout | null = null;

interface Presence {
  login: string;
  displayName: string;
  lastActive: number;
}
const presence = new Map<string, Presence>();
const qualifiedThisSession = new Set<string>();

function nowIso(): string {
  return new Date().toISOString();
}

function getSettingNum(key: string, fallback: number): number {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  const v = Number(row?.value);
  return Number.isFinite(v) ? v : fallback;
}

export function closeDanglingSession(): void {
  getDatabase()
    .prepare("UPDATE sessions SET ended_at = ? WHERE ended_at IS NULL")
    .run(nowIso());
}

export function getCurrentSessionRow(): SessionRow | null {
  const row = getDatabase()
    .prepare(
      'SELECT * FROM sessions WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1',
    )
    .get() as SessionRow | undefined;
  return row ?? null;
}

export function listSessionHistory(limit = 50): SessionRow[] {
  return getDatabase()
    .prepare('SELECT * FROM sessions ORDER BY id DESC LIMIT ?')
    .all(limit) as SessionRow[];
}

export function getCurrentSessionId(): number | null {
  return currentSessionId;
}

function broadcastSession(): void {
  broadcast('sessions:current', getCurrentSessionRow());
}

export function onStreamOnline(startedAt?: string): void {
  const db = getDatabase();

  // Safety: close any dangling session from a previous crash or earlier notification.
  closeDanglingSession();

  const prev = db
    .prepare('SELECT id FROM sessions ORDER BY id DESC LIMIT 1')
    .get() as { id: number } | undefined;
  prevSessionId = prev?.id ?? null;

  const info = db
    .prepare('INSERT INTO sessions (started_at) VALUES (?)')
    .run(startedAt ?? nowIso());
  currentSessionId = Number(info.lastInsertRowid);

  presence.clear();
  qualifiedThisSession.clear();

  startTick();
  broadcastSession();
  console.log(
    `[session] started session ${currentSessionId} (prev ${prevSessionId ?? 'none'}, started_at ${startedAt ?? 'now'})`,
  );
}

export function onStreamOffline(): void {
  stopTick();
  if (currentSessionId !== null) {
    getDatabase()
      .prepare(
        'UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL',
      )
      .run(nowIso(), currentSessionId);
    console.log(`[session] ended session ${currentSessionId}`);
  }
  currentSessionId = null;
  presence.clear();
  qualifiedThisSession.clear();
  broadcastSession();
}

export function onChatMessage(msg: ChatMessage): void {
  if (currentSessionId === null) return;
  const now = Date.now();
  presence.set(msg.user.id, {
    login: msg.user.login,
    displayName: msg.user.displayName,
    lastActive: now,
  });

  const db = getDatabase();
  const existing = db
    .prepare(
      'SELECT id FROM viewer_sessions WHERE session_id = ? AND twitch_user_id = ?',
    )
    .get(currentSessionId, msg.user.id) as { id: number } | undefined;
  const iso = nowIso();
  if (existing) {
    db.prepare('UPDATE viewer_sessions SET last_active = ? WHERE id = ?').run(
      iso,
      existing.id,
    );
  } else {
    db.prepare(
      `INSERT INTO viewer_sessions (session_id, twitch_user_id, joined_at, last_active)
       VALUES (?, ?, ?, ?)`,
    ).run(currentSessionId, msg.user.id, iso, iso);
  }
}

function startTick(): void {
  stopTick();
  tickTimer = setInterval(() => {
    try {
      tick();
    } catch (err) {
      console.error('[session] tick error:', err);
    }
  }, TICK_INTERVAL_MS);
}

function stopTick(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function tick(): void {
  if (currentSessionId === null) return;
  const db = getDatabase();
  const now = Date.now();
  const expPerMinute = getSettingNum('exp_per_minute_watched', 1);
  const streakMin = getSettingNum('streak_minimum_minutes', 10);
  const streakBonus = getSettingNum('streak_bonus_per_stream', 5);

  for (const [userId, p] of presence) {
    if (now - p.lastActive > PRESENCE_TIMEOUT_MS) {
      presence.delete(userId);
      continue;
    }

    const res = db
      .prepare(
        `UPDATE viewer_sessions SET minutes_watched = minutes_watched + 1, last_active = ?
         WHERE session_id = ? AND twitch_user_id = ?`,
      )
      .run(nowIso(), currentSessionId, userId);
    if (res.changes === 0) continue;

    db.prepare(
      'UPDATE users SET watch_time_minutes = watch_time_minutes + 1 WHERE twitch_id = ?',
    ).run(userId);

    if (expPerMinute > 0) {
      awardExp(userId, p.displayName, expPerMinute, 'watch_time');
    }

    if (!qualifiedThisSession.has(userId)) {
      const row = db
        .prepare(
          'SELECT minutes_watched FROM viewer_sessions WHERE session_id = ? AND twitch_user_id = ?',
        )
        .get(currentSessionId, userId) as { minutes_watched: number } | undefined;
      if (row && row.minutes_watched >= streakMin) {
        qualifyForStreak(userId, p.displayName, streakBonus);
        qualifiedThisSession.add(userId);
      }
    }
  }

  const count = presence.size;
  if (count > 0) {
    db.prepare(
      'UPDATE sessions SET peak_viewers = MAX(peak_viewers, ?) WHERE id = ?',
    ).run(count, currentSessionId);
  }
}

function qualifyForStreak(
  userId: string,
  displayName: string,
  streakBonus: number,
): void {
  const db = getDatabase();
  const user = db
    .prepare(
      'SELECT watch_streak, best_watch_streak, last_stream_attended FROM users WHERE twitch_id = ?',
    )
    .get(userId) as
    | {
        watch_streak: number;
        best_watch_streak: number;
        last_stream_attended: number | null;
      }
    | undefined;
  if (!user) return;

  if (user.last_stream_attended === currentSessionId) return; // already counted

  const wasContinuation =
    user.last_stream_attended !== null &&
    prevSessionId !== null &&
    user.last_stream_attended === prevSessionId;
  const newStreak = wasContinuation ? user.watch_streak + 1 : 1;
  const newBest = Math.max(user.best_watch_streak, newStreak);

  db.prepare(
    `UPDATE users SET watch_streak = ?, best_watch_streak = ?, last_stream_attended = ?
     WHERE twitch_id = ?`,
  ).run(newStreak, newBest, currentSessionId, userId);

  if (wasContinuation && streakBonus > 0) {
    awardExp(userId, displayName, streakBonus * newStreak, 'streak_bonus', {
      data: { streak: newStreak },
    });
  }
}
