import { broadcast } from '../ipc/broadcast';
import { normalizeSetting } from '../lib/settings-normalize';
import { DEFAULT_SETTINGS, getDatabase } from './database';

export function getAllSettings(): Record<string, string> {
  const rows = getDatabase()
    .prepare('SELECT key, value FROM settings')
    .all() as { key: string; value: string }[];
  const out: Record<string, string> = {};
  for (const row of rows) out[row.key] = row.value;
  return out;
}

export function getSetting(key: string, fallback?: string): string | undefined {
  const row = getDatabase()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

const KNOWN_KEYS = new Set(Object.keys(DEFAULT_SETTINGS));
const KNOWN_PREFIXES = ['mod_', 'discord_webhook_'] as const;

function isKnownSettingKey(key: string): boolean {
  return KNOWN_KEYS.has(key) || KNOWN_PREFIXES.some((prefix) => key.startsWith(prefix));
}

export function updateSetting(key: string, value: unknown): void {
  if (!isKnownSettingKey(key)) {
    throw new Error(`Unknown setting key: ${key}`);
  }
  const stored = normalizeSetting(key, value);

  getDatabase()
    .prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run(key, stored);

  broadcast('settings:updated', { key, value: stored });
}
