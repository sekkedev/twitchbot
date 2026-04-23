import Database from 'better-sqlite3';
import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

export const DEFAULT_SETTINGS: Record<string, string> = {
  bot_prefix: '!',
  exp_per_message: '3',
  exp_per_minute_watched: '1',
  exp_per_follow: '10',
  exp_per_subscribe: '50',
  exp_per_gift_sub: '30',
  exp_per_10_bits: '1',
  exp_per_raid_viewer: '2',
  streak_bonus_per_stream: '5',
  streak_minimum_minutes: '10',
  level_base: '100',
  level_exponent: '1.5',
  message_exp_cap_per_minute: '30',
  levelup_announcement: '{user} just reached level {level}!',
  levelup_announce_enabled: '1',
  global_cooldown_seconds: '2',
};

let db: DB | null = null;

export function getDatabase(): DB {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.');
  return db;
}

export function initDatabase(): DB {
  if (db) return db;

  const userDataDir = app.getPath('userData');
  if (!fs.existsSync(userDataDir)) fs.mkdirSync(userDataDir, { recursive: true });

  const dbPath = path.join(userDataDir, 'twitchbot.db');
  db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');

  applySchema(db);
  seedSettings(db);

  console.log(`[db] opened at ${dbPath}`);
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

function applySchema(handle: DB): void {
  const schemaPath = resolveSchemaPath();
  const sql = fs.readFileSync(schemaPath, 'utf8');
  handle.exec(sql);
}

function resolveSchemaPath(): string {
  const candidates = [
    path.join(__dirname, '..', 'electron', 'db', 'schema.sql'),
    path.join(app.getAppPath(), 'electron', 'db', 'schema.sql'),
    path.join(process.cwd(), 'electron', 'db', 'schema.sql'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `schema.sql not found. Searched:\n  ${candidates.join('\n  ')}`,
  );
}

function seedSettings(handle: DB): void {
  const insert = handle.prepare(
    'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
  );
  const tx = handle.transaction((entries: [string, string][]) => {
    for (const [key, value] of entries) insert.run(key, value);
  });
  tx(Object.entries(DEFAULT_SETTINGS));
}
