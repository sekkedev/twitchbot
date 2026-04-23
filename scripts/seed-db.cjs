/* eslint-disable */
/**
 * Seed the real userData DB with generated data that looks like a mid-sized
 * Twitch channel: power-law EXP distribution, streams over 60 days, realistic
 * chat/follow/sub/cheer event history, and a handful of custom commands.
 *
 * Preserves the `settings` table. Wipes everything else.
 *
 * Usage (stop `npm run dev` first):
 *   npx electron scripts/seed-db.cjs --size=medium
 *   npx electron scripts/seed-db.cjs --size=small
 *   npx electron scripts/seed-db.cjs --size=large
 */

const { app } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

// When invoked via `npx electron scripts/...`, Electron defaults its app name
// to "Electron", which breaks userData lookup. Pin it to the real app name.
app.setName('twitchbot');

const SIZES = {
  small: { users: 120, sessions: 12, eventsMin: 2000, eventsMax: 3500, commands: 4 },
  medium: { users: 600, sessions: 30, eventsMin: 10_000, eventsMax: 14_000, commands: 6 },
  large: { users: 1800, sessions: 60, eventsMin: 30_000, eventsMax: 40_000, commands: 10 },
};

const ADJECTIVES = [
  'fiery', 'icy', 'dark', 'neon', 'cyber', 'mystic', 'atomic', 'pixel',
  'cosmic', 'wild', 'silent', 'radiant', 'epic', 'frozen', 'shadow', 'lunar',
  'solar', 'crystal', 'violet', 'scarlet', 'electric', 'turbo', 'mega', 'alpha',
  'beta', 'hyper', 'nano', 'quantum', 'zen', 'rogue', 'arcane', 'feral',
  'glacial', 'nebula', 'chrome', 'obsidian', 'crimson', 'emerald', 'amber', 'twilight',
];
const NOUNS = [
  'wolf', 'dragon', 'hawk', 'fox', 'tiger', 'raven', 'phoenix', 'ghost',
  'knight', 'wizard', 'ninja', 'pilot', 'rider', 'hunter', 'scout', 'warrior',
  'sage', 'mage', 'guardian', 'ranger', 'ace', 'bard', 'captain', 'champion',
  'master', 'titan', 'hero', 'spark', 'flame', 'storm', 'blade', 'shield',
  'arrow', 'hammer', 'orb', 'nova', 'void', 'echo', 'pulse', 'glitch',
  'fang', 'claw', 'ember', 'talon', 'cipher', 'vector', 'prism', 'rift',
];

const COMMAND_SAMPLES = [
  { name: 'discord', response: 'Join the Discord: discord.gg/yourserver', perms: ['everyone'], cd: 15 },
  { name: 'socials', response: 'Twitter @{channel} · YouTube @{channel}', perms: ['everyone'], cd: 15 },
  { name: 'schedule', response: 'Streaming Mon / Wed / Fri at 7 PM CET', perms: ['everyone'], cd: 20 },
  { name: 'lurk', response: '{user} vanishes into the shadows (watch time: {watch_time}h)', perms: ['everyone'], cd: 5 },
  { name: 'hug', response: '{user} sends hugs to chat <3', perms: ['everyone'], cd: 10 },
  { name: 'uptime', response: 'Stream uptime: {uptime}', perms: ['everyone'], cd: 10 },
  { name: 'so', response: 'Shoutout to our friend! Go check them out.', perms: ['moderator'], cd: 3 },
  { name: 'vip', response: 'VIP perks: priority requests, golden chat color.', perms: ['vip', 'moderator'], cd: 60 },
  { name: 'subs', response: 'Subscribers get custom emotes + priority on requests!', perms: ['subscriber'], cd: 30 },
  { name: 'about', response: '{channel} · Variety streamer. Try !schedule or !socials.', perms: ['everyone'], cd: 60 },
];

const DAY_MS = 86_400_000;

function randint(a, b) {
  return Math.floor(a + Math.random() * (b - a + 1));
}
function choice(arr) {
  return arr[randint(0, arr.length - 1)];
}
function maybe(p) {
  return Math.random() < p;
}
function pickWeighted(entries) {
  let total = 0;
  for (const e of entries) total += e.weight;
  let r = Math.random() * total;
  for (const e of entries) {
    r -= e.weight;
    if (r <= 0) return e;
  }
  return entries[entries.length - 1];
}

function generateName(existing) {
  for (let attempts = 0; attempts < 50; attempts++) {
    const parts = [choice(ADJECTIVES), choice(NOUNS)];
    if (maybe(0.5)) parts.push(String(randint(2, 999)));
    const name = parts.join('');
    if (!existing.has(name)) {
      existing.add(name);
      return name;
    }
  }
  const fallback = `user${randint(10_000, 999_999)}`;
  existing.add(fallback);
  return fallback;
}

function computeLevel(totalExp, base, exponent) {
  let level = 1;
  let cumulative = 0;
  while (level < 1000) {
    const need = Math.floor(base * Math.pow(level, exponent));
    if (cumulative + need > totalExp) break;
    cumulative += need;
    level += 1;
  }
  return level;
}

function main() {
  const sizeArg =
    process.argv.find((a) => a.startsWith('--size='))?.slice(7) ?? 'medium';
  const size = SIZES[sizeArg];
  if (!size) {
    console.error(
      `Unknown size "${sizeArg}". Valid options: ${Object.keys(SIZES).join(', ')}`,
    );
    app.exit(1);
    return;
  }

  const dbPath = path.join(app.getPath('userData'), 'twitchbot.db');
  console.log(`Seeding ${sizeArg} dataset into ${dbPath}`);
  console.log(
    `  target: ${size.users} users, ${size.sessions} sessions, ~${Math.round(
      (size.eventsMin + size.eventsMax) / 2,
    ).toLocaleString()} events, ${size.commands} commands`,
  );

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  console.log('Wiping existing generated data (settings preserved)…');
  db.exec(`
    DELETE FROM viewer_sessions;
    DELETE FROM events;
    DELETE FROM commands;
    UPDATE users SET last_stream_attended = NULL;
    DELETE FROM sessions;
    DELETE FROM users;
  `);

  const baseRow = db
    .prepare("SELECT value FROM settings WHERE key = 'level_base'")
    .get();
  const expRow = db
    .prepare("SELECT value FROM settings WHERE key = 'level_exponent'")
    .get();
  const levelBase = Number(baseRow?.value ?? 100);
  const levelExponent = Number(expRow?.value ?? 1.5);

  const now = Date.now();
  const usernames = new Set();

  // --- Users (power-law distribution) ---
  console.log('Generating users…');
  const tiers = [
    { frac: 0.02, expMin: 50_000, expMax: 200_000, streakMin: 8, streakMax: 40 }, // whales
    { frac: 0.08, expMin: 10_000, expMax: 50_000, streakMin: 4, streakMax: 20 },  // regulars
    { frac: 0.2, expMin: 1500, expMax: 10_000, streakMin: 1, streakMax: 8 },      // actives
    { frac: 0.45, expMin: 150, expMax: 1500, streakMin: 0, streakMax: 3 },         // casual
  ];
  const allocated = tiers.reduce((s, t) => s + Math.ceil(size.users * t.frac), 0);
  const lurkerCount = Math.max(0, size.users - allocated);
  tiers.push({ frac: 0, expMin: 5, expMax: 150, streakMin: 0, streakMax: 1, _count: lurkerCount });

  let idCounter = 1_000_000;
  const users = [];
  for (const tier of tiers) {
    const count = tier._count ?? Math.ceil(size.users * tier.frac);
    for (let i = 0; i < count; i++) {
      const exp = randint(tier.expMin, tier.expMax);
      const messages = Math.floor((exp / 3) * (0.4 + Math.random() * 1.3));
      const watch = Math.floor((exp / 2) * (0.4 + Math.random() * 1.3));
      const streak = randint(tier.streakMin, tier.streakMax);
      const bestStreak = streak + randint(0, Math.max(3, streak));
      const firstSeenDaysAgo = randint(3, 90);
      const lastSeenDaysAgo = Math.max(0, firstSeenDaysAgo - randint(1, firstSeenDaysAgo));
      users.push({
        twitch_id: String(idCounter++),
        username: generateName(usernames),
        exp,
        level: computeLevel(exp, levelBase, levelExponent),
        watch_time_minutes: watch,
        messages_sent: messages,
        watch_streak: streak,
        best_watch_streak: bestStreak,
        first_seen: new Date(now - firstSeenDaysAgo * DAY_MS).toISOString(),
        last_seen: new Date(now - lastSeenDaysAgo * DAY_MS).toISOString(),
      });
    }
  }
  // Trim to exact target
  users.length = Math.min(users.length, size.users);

  const insertUser = db.prepare(`
    INSERT INTO users (twitch_id, username, exp, level, watch_time_minutes,
                       messages_sent, watch_streak, best_watch_streak,
                       last_stream_attended, first_seen, last_seen)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `);
  db.transaction(() => {
    for (const u of users) {
      insertUser.run(
        u.twitch_id,
        u.username,
        u.exp,
        u.level,
        u.watch_time_minutes,
        u.messages_sent,
        u.watch_streak,
        u.best_watch_streak,
        u.first_seen,
        u.last_seen,
      );
    }
  })();

  // --- Sessions (chronological, last 60 days) ---
  console.log('Generating sessions…');
  const insertSession = db.prepare(`
    INSERT INTO sessions (started_at, ended_at, peak_viewers) VALUES (?, ?, ?)
  `);
  const sessionRows = [];
  db.transaction(() => {
    for (let i = 0; i < size.sessions; i++) {
      // Distribute across last 60 days; vary so they're not perfectly spaced
      const daysAgo = Math.max(
        1,
        60 - Math.floor((i / size.sessions) * 60) + randint(-1, 1),
      );
      const hour = randint(17, 22);
      const startedAtMs = now - daysAgo * DAY_MS;
      const start = new Date(startedAtMs);
      start.setUTCHours(hour, randint(0, 59), 0, 0);
      const durationMin = randint(90, 300);
      const endedAt = new Date(start.getTime() + durationMin * 60_000);
      const peak = randint(40, 600);
      const info = insertSession.run(
        start.toISOString(),
        endedAt.toISOString(),
        peak,
      );
      sessionRows.push({
        id: Number(info.lastInsertRowid),
        started_at: start.toISOString(),
        ended_at: endedAt.toISOString(),
        peak,
      });
    }
  })();

  // --- Viewer sessions ---
  console.log('Generating viewer_sessions…');
  const insertVS = db.prepare(`
    INSERT INTO viewer_sessions (session_id, twitch_user_id, joined_at, last_active, minutes_watched)
    VALUES (?, ?, ?, ?, ?)
  `);
  const updateLastStream = db.prepare(
    'UPDATE users SET last_stream_attended = ? WHERE twitch_id = ?',
  );
  db.transaction(() => {
    for (let i = 0; i < sessionRows.length; i++) {
      const session = sessionRows[i];
      const attendanceFraction = 0.3 + Math.random() * 0.5;
      const attendees = Math.floor(session.peak * attendanceFraction);
      const shuffled = [...users].sort(() => Math.random() - 0.5).slice(0, attendees);
      const sessionDurationMs =
        Date.parse(session.ended_at) - Date.parse(session.started_at);
      for (const u of shuffled) {
        const joinDelayMs = Math.floor(Math.random() * sessionDurationMs * 0.5);
        const minutes = randint(5, Math.max(10, Math.floor(sessionDurationMs / 60_000) - 5));
        const joinedAt = new Date(Date.parse(session.started_at) + joinDelayMs);
        const lastActive = new Date(joinedAt.getTime() + minutes * 60_000);
        insertVS.run(
          session.id,
          u.twitch_id,
          joinedAt.toISOString(),
          lastActive.toISOString(),
          minutes,
        );
      }
      // Update last_stream_attended for the latest few sessions (streak continuity)
      if (i >= sessionRows.length - 3) {
        for (const u of shuffled) {
          updateLastStream.run(session.id, u.twitch_id);
        }
      }
    }
  })();

  // --- Events (timeline spanning 60 days) ---
  console.log('Generating events…');
  const totalEvents = randint(size.eventsMin, size.eventsMax);
  const eventTypes = [
    { type: 'message', weight: 70, exp: () => 3 },
    { type: 'watch_time', weight: 12, exp: () => 1 },
    { type: 'follow', weight: 5, exp: () => 10 },
    { type: 'subscribe', weight: 3, exp: () => 50 },
    { type: 'cheer', weight: 4, exp: () => randint(1, 80) },
    { type: 'gift_sub', weight: 1, exp: () => randint(30, 300) },
    { type: 'raid', weight: 0.4, exp: () => randint(20, 400) },
    { type: 'streak_bonus', weight: 2, exp: () => randint(5, 100) },
    { type: 'admin', weight: 0.5, exp: () => (maybe(0.2) ? -randint(10, 500) : randint(50, 1000)) },
  ];

  const insertEvent = db.prepare(`
    INSERT INTO events (type, twitch_user_id, data, exp_awarded, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.transaction(() => {
    for (let i = 0; i < totalEvents; i++) {
      const spec = pickWeighted(eventTypes);
      // Weight user selection toward high-EXP users (more likely to be active).
      const u = Math.random() < 0.6 ? users[randint(0, Math.min(50, users.length - 1))] : choice(users);
      // Skew timestamps toward recent days (sqrt ≈ U shape biased to small days).
      const daysAgo = Math.floor(60 * Math.pow(Math.random(), 1.6));
      const createdAt = new Date(
        now - daysAgo * DAY_MS - randint(0, DAY_MS),
      ).toISOString();
      let data = null;
      if (spec.type === 'admin') {
        data = JSON.stringify({ reason: choice(['boost', 'event reward', 'giveaway', 'moderation']) });
      } else if (spec.type === 'streak_bonus') {
        data = JSON.stringify({ streak: randint(2, 20) });
      }
      insertEvent.run(spec.type, u.twitch_id, data, spec.exp(), createdAt);
    }
  })();

  // --- Commands ---
  console.log('Generating commands…');
  const insertCommand = db.prepare(`
    INSERT INTO commands (name, response, cooldown_seconds, permissions, enabled, usage_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction(() => {
    for (const c of COMMAND_SAMPLES.slice(0, size.commands)) {
      insertCommand.run(
        c.name,
        c.response,
        c.cd,
        JSON.stringify(c.perms),
        1,
        randint(30, 4000),
        new Date(now - randint(7, 60) * DAY_MS).toISOString(),
      );
    }
  })();

  // --- Summary ---
  const summary = {
    users: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    sessions: db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,
    viewer_sessions: db
      .prepare('SELECT COUNT(*) AS n FROM viewer_sessions')
      .get().n,
    events: db.prepare('SELECT COUNT(*) AS n FROM events').get().n,
    commands: db.prepare('SELECT COUNT(*) AS n FROM commands').get().n,
    totalExp: db
      .prepare('SELECT COALESCE(SUM(exp), 0) AS n FROM users')
      .get().n,
  };

  console.log('\nSeeded:');
  for (const [k, v] of Object.entries(summary)) {
    console.log(`  ${k.padEnd(16)} ${v.toLocaleString()}`);
  }
  console.log('\nDone. Run `npm run dev` to see the populated UI.');

  db.close();
  app.exit(0);
}

app.whenReady().then(main).catch((err) => {
  console.error('Seed failed:', err);
  app.exit(1);
});
