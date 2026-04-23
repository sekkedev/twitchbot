const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');

const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'twitchbot', 'twitchbot.db');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

const show = (label, rows) => {
  console.log(`\n=== ${label} ===`);
  if (!rows.length) console.log('(empty)');
  else console.table(rows);
};

show('sessions', db.prepare('SELECT * FROM sessions ORDER BY id DESC').all());
show('viewer_sessions', db.prepare('SELECT * FROM viewer_sessions ORDER BY id DESC').all());
show(
  'users',
  db
    .prepare(
      `SELECT twitch_id, username, exp, level, watch_time_minutes, messages_sent,
              watch_streak, best_watch_streak, last_stream_attended FROM users`,
    )
    .all(),
);
show(
  'streak settings',
  db
    .prepare(
      `SELECT key, value FROM settings
       WHERE key IN ('streak_minimum_minutes','exp_per_minute_watched','streak_bonus_per_stream')`,
    )
    .all(),
);
show('recent events', db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 10').all());

db.close();
process.exit(0);
