/* eslint-disable */
// End-to-end test of the IPC-backing services.
// Runs under electron runtime (required for better-sqlite3's ABI) against a
// disposable userData directory so your real DB is untouched.

const { spawnSync } = require('node:child_process');

if (!process.versions.electron) {
  const electronBinary = require('electron');
  const res = spawnSync(electronBinary, [__filename, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: process.env,
  });
  if (res.error) throw res.error;
  process.exit(res.status ?? 1);
}

if (!process.env.DISPLAY && process.platform !== 'win32') {
  const res = spawnSync('xvfb-run', ['-a', process.execPath, __filename], {
    stdio: 'inherit',
    env: process.env,
  });
  process.exit(res.status ?? 1);
}

const { app } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');

const tmpDir = path.join(os.tmpdir(), `twitchbot-test-${Date.now()}`);

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(cond, label, extra) {
  if (cond) {
    passCount++;
    console.log(`  \u2713 ${label}`);
  } else {
    failCount++;
    const details = extra !== undefined ? ` — ${JSON.stringify(extra)}` : '';
    console.log(`  \u2717 ${label}${details}`);
    failures.push(label + details);
  }
}

function assertThrows(fn, label) {
  try {
    fn();
    failCount++;
    console.log(`  \u2717 ${label} — expected throw, got success`);
    failures.push(label);
  } catch (err) {
    passCount++;
    console.log(`  \u2713 ${label} (threw: ${err.message})`);
  }
}

async function main() {
  fs.mkdirSync(tmpDir, { recursive: true });
  app.setPath('userData', tmpDir);

  const { initDatabase, getDatabase, closeDatabase, DEFAULT_SETTINGS } = require('../dist-electron/services/database.js');
  const settings = require('../dist-electron/services/settings-service.js');
  const commandEngine = require('../dist-electron/services/command-engine.js');
  const usersRepo = require('../dist-electron/services/users-repo.js');
  const analytics = require('../dist-electron/services/analytics-service.js');
  const streak = require('../dist-electron/services/streak-tracker.js');

  initDatabase();
  const db = getDatabase();

  // Seed fixtures
  const now = new Date().toISOString();
  db.prepare(
    'INSERT INTO users (twitch_id, username, exp, level, messages_sent, watch_time_minutes, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('1', 'alice', 500, 3, 100, 60, now, now);
  db.prepare(
    'INSERT INTO users (twitch_id, username, exp, level, messages_sent, watch_time_minutes, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('2', 'bob', 300, 2, 50, 30, now, now);
  db.prepare(
    'INSERT INTO users (twitch_id, username, exp, level, messages_sent, watch_time_minutes, first_seen, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run('3', 'carol', 150, 1, 30, 10, now, now);

  db.prepare(
    "INSERT INTO events (type, twitch_user_id, exp_awarded, created_at) VALUES ('message', '1', 3, datetime('now', '-30 minutes'))",
  ).run();
  db.prepare(
    "INSERT INTO events (type, twitch_user_id, exp_awarded, created_at) VALUES ('message', '2', 3, datetime('now', '-2 hours'))",
  ).run();
  db.prepare(
    "INSERT INTO events (type, twitch_user_id, exp_awarded, created_at) VALUES ('follow', '3', 10, datetime('now', '-1 day'))",
  ).run();

  db.prepare(
    "INSERT INTO sessions (started_at, ended_at, peak_viewers) VALUES (datetime('now', '-2 days'), datetime('now', '-2 days', '+3 hours'), 5)",
  ).run();

  try {
    console.log('\n[settings]');
    const allDefaults = settings.getAllSettings();
    const defaultCount = Object.keys(DEFAULT_SETTINGS).length;
    assert(
      Object.keys(allDefaults).length === defaultCount,
      `get-all returns ${defaultCount} seeded defaults`,
      Object.keys(allDefaults).length,
    );
    assert(allDefaults.bot_prefix === '!', 'default bot_prefix = "!"');

    settings.updateSetting('bot_prefix', '?');
    assert(settings.getSetting('bot_prefix') === '?', 'update bot_prefix = "?" persisted');

    settings.updateSetting('levelup_announce_enabled', false);
    assert(
      settings.getSetting('levelup_announce_enabled') === '0',
      'boolean setting false -> "0"',
    );

    settings.updateSetting('exp_per_message', 5);
    assert(settings.getSetting('exp_per_message') === '5', 'numeric setting stored as string');

    assertThrows(() => settings.updateSetting('nope', '1'), 'reject unknown key');
    assertThrows(
      () => settings.updateSetting('exp_per_message', 'abc'),
      'reject non-numeric value for integer key',
    );
    assertThrows(
      () => settings.updateSetting('level_exponent', -1),
      'reject non-positive level_exponent',
    );
    assertThrows(
      () => settings.updateSetting('bot_prefix', '!!!!!'),
      'reject bot_prefix > 4 chars',
    );

    console.log('\n[commands]');
    const created = commandEngine.createCommand({
      name: 'hello',
      response: 'Hi {user}!',
      cooldown_seconds: 10,
      permissions: ['everyone'],
    });
    assert(created.id > 0, 'create returns new command with id');
    assert(created.name === 'hello', 'command name normalized');
    assert(Array.isArray(created.permissions), 'permissions parsed as array');

    assertThrows(
      () => commandEngine.createCommand({ name: 'rank', response: 'x' }),
      'reject reserved builtin name "rank"',
    );
    assertThrows(
      () => commandEngine.createCommand({ name: 'hello', response: 'dupe' }),
      'reject duplicate command name',
    );
    assertThrows(
      () => commandEngine.createCommand({ name: 'BAD NAME', response: 'x' }),
      'reject invalid chars in name',
    );

    const list1 = commandEngine.listCommands();
    assert(list1.length === 1 && list1[0].name === 'hello', 'list returns created command');

    const updated = commandEngine.updateCommand({
      id: created.id,
      cooldown_seconds: 99,
      permissions: ['moderator', 'vip'],
    });
    assert(updated.cooldown_seconds === 99, 'update cooldown');
    assert(
      updated.permissions.length === 2 && updated.permissions.includes('vip'),
      'update permissions replaces array',
    );

    commandEngine.deleteCommand(created.id);
    assert(commandEngine.listCommands().length === 0, 'delete removes command');
    assertThrows(
      () => commandEngine.deleteCommand(99999),
      'delete non-existent throws',
    );

    console.log('\n[users]');
    const defaultList = usersRepo.listUsers();
    assert(defaultList.total === 3, 'listUsers total = 3');
    assert(defaultList.users[0].username === 'alice', 'default sort by exp desc — alice first');
    assert(defaultList.users[0].rank === 1, 'alice rank = 1');
    assert(defaultList.users[2].rank === 3, 'carol rank = 3');

    const byName = usersRepo.listUsers({ sort: 'username', direction: 'asc' });
    assert(byName.users[0].username === 'alice', 'sort by username asc');
    assert(byName.users[2].username === 'carol', 'carol last alphabetically');

    const searched = usersRepo.listUsers({ search: 'bo' });
    assert(
      searched.total === 1 && searched.users[0].username === 'bob',
      'search "bo" returns only bob',
    );

    const profile = usersRepo.getUserProfile('2');
    assert(profile && profile.username === 'bob', 'profile for bob');
    assert(
      profile && profile.events.length === 1 && profile.events[0].type === 'message',
      'profile includes recent events',
    );
    assert(usersRepo.getUserProfile('999') === null, 'missing user returns null');

    const adjusted = usersRepo.adjustUserExp('3', 500, 'test boost');
    assert(
      adjusted && adjusted.exp === 650,
      'adjust +500 EXP to carol (150 + 500)',
      adjusted && adjusted.exp,
    );
    assert(adjusted && adjusted.level >= 2, 'level recomputed after boost', adjusted && adjusted.level);

    const clamped = usersRepo.adjustUserExp('3', -100000);
    assert(clamped && clamped.exp === 0, 'negative delta clamps to 0', clamped && clamped.exp);
    assert(clamped && clamped.level === 1, 'level back to 1 after drain');

    assertThrows(
      () => usersRepo.adjustUserExp('missing', 10),
      'adjust non-existent user throws',
    );
    assertThrows(() => usersRepo.adjustUserExp('1', 0), 'zero delta throws');

    const adminEvents = db
      .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'admin'")
      .get();
    assert(adminEvents.n === 2, 'two admin events logged', adminEvents);

    console.log('\n[analytics]');
    const overview = analytics.getOverview();
    assert(overview.totalUsers === 3, 'overview totalUsers = 3');
    assert(overview.totalExp === 800, 'overview totalExp = 500+300+0 = 800', overview.totalExp);
    assert(overview.totalSessions >= 1, 'overview totalSessions >= 1');
    assert(
      overview.topChatters.length > 0 && overview.topChatters[0].username === 'alice',
      'top chatter = alice',
    );

    const activity = analytics.getActivity('week');
    assert(activity.range === 'week', 'activity echoes range');
    assert(Array.isArray(activity.buckets), 'activity buckets is array');
    assert(activity.buckets.length > 0, 'activity has buckets from seeded events');
    assert(Array.isArray(activity.sessions), 'activity sessions is array');

    const activityDay = analytics.getActivity('day');
    assert(activityDay.range === 'day', 'day range works');

    console.log('\n[presence ordering]');
    // Regression guard for issue #3: streak.onChatMessage inserts into
    // viewer_sessions which has a FK on users.twitch_id. handleMessageExp
    // (via upsertUser) must run BEFORE streakOnChatMessage, otherwise a
    // brand-new chatter's first message is silently dropped.
    streak.onStreamOnline();
    const regressionSessionId = streak.getCurrentSessionId();
    assert(regressionSessionId !== null, 'regression session started');

    const newChatterMsg = {
      user: {
        id: '9999',
        login: 'newbie',
        displayName: 'newbie',
        color: null,
        roles: { broadcaster: false, moderator: false, vip: false, subscriber: false },
      },
      message: 'hello!',
      timestamp: new Date().toISOString(),
      channel: 'testchan',
    };

    // Contract: without a prior users row the insert violates the FK.
    assertThrows(
      () => streak.onChatMessage(newChatterMsg),
      'onChatMessage rejects when user row missing (contract for #3)',
    );

    // Simulate what handleMessageExp -> upsertUser does before presence now.
    const presenceIso = new Date().toISOString();
    db.prepare(
      'INSERT INTO users (twitch_id, username, first_seen, last_seen) VALUES (?, ?, ?, ?)',
    ).run('9999', 'newbie', presenceIso, presenceIso);

    streak.onChatMessage(newChatterMsg);
    const vsRow = db
      .prepare(
        'SELECT * FROM viewer_sessions WHERE session_id = ? AND twitch_user_id = ?',
      )
      .get(regressionSessionId, '9999');
    assert(!!vsRow, 'viewer_sessions row created after upsert + onChatMessage');
    assert(
      vsRow && vsRow.minutes_watched === 0,
      'viewer_sessions minutes_watched starts at 0',
    );

    streak.onStreamOffline();

    // Clean up the synthetic user so downstream counts stay deterministic.
    // ON DELETE CASCADE on viewer_sessions clears its presence row.
    db.prepare('DELETE FROM users WHERE twitch_id = ?').run('9999');

    console.log('\n[sessions]');
    const history = streak.listSessionHistory(10);
    assert(history.length >= 1, 'session history has entries');
    assert(streak.getCurrentSessionRow() === null, 'no current session in test DB');

    console.log('\n[reset]');
    const resetBob = usersRepo.resetUser('2');
    assert(resetBob.affected === 1, 'reset single affected 1');
    const bobAfter = usersRepo.getUserProfile('2');
    assert(bobAfter && bobAfter.exp === 0 && bobAfter.messages_sent === 0, 'bob stats cleared');
    assert(bobAfter && bobAfter.events.length > 0, 'bob events preserved after reset');

    const resetAll = usersRepo.resetUser(null);
    assert(resetAll.affected === 3, 'reset all affected 3');
    const totalExpAfter = analytics.getOverview().totalExp;
    assert(totalExpAfter === 0, 'total EXP is 0 after full reset');
  } finally {
    closeDatabase();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }

  console.log(`\n==== ${passCount} passed, ${failCount} failed ====`);
  if (failures.length) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  app.exit(failCount === 0 ? 0 : 1);
}

app.whenReady().then(main).catch((err) => {
  console.error('Runner error:', err);
  app.exit(2);
});
