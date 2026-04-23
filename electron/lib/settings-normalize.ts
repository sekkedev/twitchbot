/**
 * Settings validation/coercion. Pure — no runtime deps.
 */

export const NUMERIC_KEYS = new Set([
  'exp_per_message',
  'exp_per_minute_watched',
  'exp_per_follow',
  'exp_per_subscribe',
  'exp_per_gift_sub',
  'exp_per_10_bits',
  'exp_per_raid_viewer',
  'streak_bonus_per_stream',
  'streak_minimum_minutes',
  'message_exp_cap_per_minute',
  'global_cooldown_seconds',
]);

export const FLOAT_KEYS = new Set(['level_base', 'level_exponent']);

export const BOOLEAN_KEYS = new Set(['levelup_announce_enabled']);

/**
 * Convert a user-supplied setting value into the exact string shape stored in
 * the DB. Throws on invalid input with a human-readable message.
 */
export function normalizeSetting(key: string, value: unknown): string {
  if (BOOLEAN_KEYS.has(key)) {
    if (value === true || value === 'true' || value === 1 || value === '1') return '1';
    if (value === false || value === 'false' || value === 0 || value === '0') return '0';
    throw new Error(`${key} must be a boolean or 0/1.`);
  }
  if (NUMERIC_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(`${key} must be a non-negative integer.`);
    }
    return String(n);
  }
  if (FLOAT_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${key} must be a positive number.`);
    }
    return String(n);
  }
  if (key === 'bot_prefix') {
    const s = typeof value === 'string' ? value.trim() : String(value).trim();
    if (!s || s.length > 4) {
      throw new Error('bot_prefix must be 1–4 characters.');
    }
    return s;
  }
  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`);
  }
  return value;
}
