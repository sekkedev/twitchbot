import { broadcast } from '../ipc/broadcast';
import { interpolate } from '../lib/command-logic';
import { computeLevel } from '../lib/leveling';
import { getDatabase } from './database';
import { getCurrentTokens } from './twitch-auth';
import type { ChatMessage } from './twitch-chat';
import { sendChat } from './twitch-chat';
import { upsertUser } from './users-repo';

export { computeLevel, expForNextLevel } from '../lib/leveling';

export type ExpSource =
  | 'message'
  | 'watch_time'
  | 'follow'
  | 'subscribe'
  | 'gift_sub'
  | 'cheer'
  | 'raid'
  | 'streak_bonus'
  | 'admin';

interface ExpSettings {
  expPerMessage: number;
  expPerMinuteWatched: number;
  expPerFollow: number;
  expPerSubscribe: number;
  expPerGiftSub: number;
  expPer10Bits: number;
  expPerRaidViewer: number;
  streakBonusPerStream: number;
  messageExpCapPerMinute: number;
  levelBase: number;
  levelExponent: number;
  levelupAnnouncement: string;
  levelupAnnounceEnabled: boolean;
}

const MESSAGE_WINDOW_MS = 60_000;
const messageWindows = new Map<
  string,
  { windowStart: number; expThisWindow: number }
>();

function getBotPrefix(): string {
  const row = getDatabase()
    .prepare("SELECT value FROM settings WHERE key = 'bot_prefix'")
    .get() as { value: string } | undefined;
  return row?.value ?? '!';
}

function loadSettings(): ExpSettings {
  const rows = getDatabase()
    .prepare('SELECT key, value FROM settings')
    .all() as { key: string; value: string }[];
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const num = (k: string, d: number) => {
    const v = m.get(k);
    const n = v === undefined ? d : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const str = (k: string, d: string) => m.get(k) ?? d;
  return {
    expPerMessage: num('exp_per_message', 3),
    expPerMinuteWatched: num('exp_per_minute_watched', 1),
    expPerFollow: num('exp_per_follow', 10),
    expPerSubscribe: num('exp_per_subscribe', 50),
    expPerGiftSub: num('exp_per_gift_sub', 30),
    expPer10Bits: num('exp_per_10_bits', 1),
    expPerRaidViewer: num('exp_per_raid_viewer', 2),
    streakBonusPerStream: num('streak_bonus_per_stream', 5),
    messageExpCapPerMinute: num('message_exp_cap_per_minute', 30),
    levelBase: num('level_base', 100),
    levelExponent: num('level_exponent', 1.5),
    levelupAnnouncement: str(
      'levelup_announcement',
      '{user} just reached level {level}!',
    ),
    levelupAnnounceEnabled: num('levelup_announce_enabled', 1) === 1,
  };
}

function logEvent(
  type: ExpSource,
  twitchUserId: string,
  expAwarded: number,
  data?: object,
): void {
  getDatabase()
    .prepare(
      `INSERT INTO events (type, twitch_user_id, data, exp_awarded, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      type,
      twitchUserId,
      data ? JSON.stringify(data) : null,
      expAwarded,
      new Date().toISOString(),
    );
}

export interface AwardOptions {
  /** Merged into the event row's JSON data payload. */
  data?: object;
  /** Skip the chat level-up announcement (used for historical backfill). */
  silent?: boolean;
  /** Skip the `users:exp-gained` renderer broadcast (used for backfill). */
  suppressFeed?: boolean;
}

export function awardExp(
  twitchId: string,
  username: string,
  amount: number,
  source: ExpSource,
  options: AwardOptions = {},
): void {
  if (amount <= 0) return;

  const settings = loadSettings();
  const user = upsertUser(twitchId, username);
  const oldLevel = user.level;
  const newTotal = user.exp + amount;
  const newLevel = computeLevel(newTotal, settings.levelBase, settings.levelExponent);

  const db = getDatabase();
  const writeAward = db.transaction(() => {
    db.prepare('UPDATE users SET exp = ?, level = ? WHERE twitch_id = ?')
      .run(newTotal, newLevel, twitchId);
    logEvent(source, twitchId, amount, options.data);
  });
  writeAward();

  if (!options.suppressFeed) {
    broadcast('users:exp-gained', {
      user: {
        id: twitchId,
        login: user.username.toLowerCase(),
        displayName: username,
      },
      amount,
      source,
      newTotal,
      newLevel,
    });
  }

  if (!options.silent && newLevel > oldLevel && settings.levelupAnnounceEnabled) {
    const text = interpolate(settings.levelupAnnouncement, {
      user: username,
      level: newLevel,
    });
    void sendChat(text).catch((err) =>
      console.error('[exp] level-up announce failed:', err),
    );
  }
}

export function handleMessageExp(msg: ChatMessage): void {
  const settings = loadSettings();
  const prefix = getBotPrefix();

  upsertUser(msg.user.id, msg.user.displayName);

  // Command invocations aren't organic chat — no EXP, no message count.
  if (prefix && msg.message.startsWith(prefix)) return;

  getDatabase()
    .prepare('UPDATE users SET messages_sent = messages_sent + 1 WHERE twitch_id = ?')
    .run(msg.user.id);

  const now = Date.now();
  let window = messageWindows.get(msg.user.id);
  if (!window || now - window.windowStart >= MESSAGE_WINDOW_MS) {
    window = { windowStart: now, expThisWindow: 0 };
    messageWindows.set(msg.user.id, window);
  }
  const remaining = Math.max(
    0,
    settings.messageExpCapPerMinute - window.expThisWindow,
  );
  const toAward = Math.min(settings.expPerMessage, remaining);
  if (toAward <= 0) return;

  window.expThisWindow += toAward;
  awardExp(msg.user.id, msg.user.displayName, toAward, 'message');
}

export function handleFollowExp(
  userId: string,
  username: string,
  options: { backfilled?: boolean } = {},
): void {
  const prior = getDatabase()
    .prepare(
      `SELECT 1 FROM events WHERE twitch_user_id = ? AND type = 'follow' AND exp_awarded > 0 LIMIT 1`,
    )
    .get(userId);
  if (prior) return;
  const settings = loadSettings();
  awardExp(userId, username, settings.expPerFollow, 'follow', {
    silent: options.backfilled,
    suppressFeed: options.backfilled,
    data: options.backfilled ? { backfilled: true } : undefined,
  });
}

export function handleSubscribeExp(
  userId: string,
  username: string,
  tier: string,
  months: number,
  isGift: boolean,
): void {
  if (isGift) return;
  const settings = loadSettings();
  awardExp(userId, username, settings.expPerSubscribe, 'subscribe', {
    data: { tier, months },
  });
}

export function handleGiftSubExp(
  gifterId: string | null,
  gifterName: string | null,
  total: number,
  tier: string,
  isAnonymous: boolean,
): void {
  if (isAnonymous || !gifterId || !gifterName) return;
  const settings = loadSettings();
  const amount = settings.expPerGiftSub * Math.max(1, total);
  awardExp(gifterId, gifterName, amount, 'gift_sub', { data: { total, tier } });
}

export function handleCheerExp(
  userId: string | null,
  username: string | null,
  bits: number,
  isAnonymous: boolean,
): void {
  if (isAnonymous || !userId || !username || bits <= 0) return;
  const settings = loadSettings();
  const amount = Math.floor((bits / 10) * settings.expPer10Bits);
  if (amount <= 0) return;
  awardExp(userId, username, amount, 'cheer', { data: { bits } });
}

export function handleRaidExp(viewers: number, fromChannel: string): void {
  const tokens = getCurrentTokens();
  if (!tokens || viewers <= 0) return;
  const settings = loadSettings();
  const amount = viewers * settings.expPerRaidViewer;
  if (amount <= 0) return;
  awardExp(tokens.user.id, tokens.user.display_name, amount, 'raid', {
    data: { from: fromChannel, viewers },
  });
}
