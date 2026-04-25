-- TwitchBot schema. Idempotent: safe to run on every startup.

CREATE TABLE IF NOT EXISTS users (
  twitch_id             TEXT PRIMARY KEY,
  username              TEXT NOT NULL,
  exp                   INTEGER NOT NULL DEFAULT 0,
  level                 INTEGER NOT NULL DEFAULT 1,
  watch_time_minutes    INTEGER NOT NULL DEFAULT 0,
  messages_sent         INTEGER NOT NULL DEFAULT 0,
  watch_streak          INTEGER NOT NULL DEFAULT 0,
  best_watch_streak     INTEGER NOT NULL DEFAULT 0,
  last_stream_attended  INTEGER,
  first_seen            TEXT NOT NULL,
  last_seen             TEXT NOT NULL,
  FOREIGN KEY (last_stream_attended) REFERENCES sessions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_exp       ON users(exp DESC);
CREATE INDEX IF NOT EXISTS idx_users_username  ON users(username);

CREATE TABLE IF NOT EXISTS commands (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT UNIQUE NOT NULL,
  response          TEXT NOT NULL,
  cooldown_seconds  INTEGER NOT NULL DEFAULT 5,
  permissions       TEXT NOT NULL DEFAULT '["everyone"]',
  enabled           INTEGER NOT NULL DEFAULT 1,
  usage_count       INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,
  twitch_user_id  TEXT NOT NULL,
  data            TEXT,
  exp_awarded     INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_user_type ON events(twitch_user_id, type);
CREATE INDEX IF NOT EXISTS idx_events_type      ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_created   ON events(created_at);

CREATE TABLE IF NOT EXISTS sessions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at    TEXT NOT NULL,
  ended_at      TEXT,
  peak_viewers  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at DESC);

CREATE TABLE IF NOT EXISTS viewer_sessions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id       INTEGER NOT NULL,
  twitch_user_id   TEXT NOT NULL,
  joined_at        TEXT NOT NULL,
  last_active      TEXT NOT NULL,
  minutes_watched  INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (session_id)     REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (twitch_user_id) REFERENCES users(twitch_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_viewer_sessions_session ON viewer_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_viewer_sessions_user    ON viewer_sessions(twitch_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_viewer_sessions_unique
  ON viewer_sessions(session_id, twitch_user_id);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS timers (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  name              TEXT NOT NULL,
  message           TEXT NOT NULL,
  interval_seconds  INTEGER NOT NULL DEFAULT 300,
  min_chat_lines    INTEGER NOT NULL DEFAULT 0,
  enabled           INTEGER NOT NULL DEFAULT 1,
  last_fired_at     INTEGER,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS mod_warnings (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  username      TEXT NOT NULL,
  rule          TEXT NOT NULL,
  message_text  TEXT,
  action_taken  TEXT NOT NULL,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_mod_warnings_user
  ON mod_warnings(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_warnings_rule
  ON mod_warnings(rule, created_at DESC);

CREATE TABLE IF NOT EXISTS mod_permitted_users (
  user_id     TEXT PRIMARY KEY,
  username    TEXT NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
