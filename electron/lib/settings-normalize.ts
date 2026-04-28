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

export const MOD_BOOLEAN_KEYS = new Set([
  'mod_links_enabled',
  'mod_links_subs_exempt',
  'mod_caps_enabled',
  'mod_emote_enabled',
  'mod_repeat_enabled',
  'mod_symbols_enabled',
  'mod_vips_exempt',
  'mod_blocked_words_enabled',
  'mod_first_message_screening',
  'mod_discord_webhook_enabled',
]);

export const MOD_NUMERIC_KEYS = new Set([
  'mod_links_permit_seconds',
  'mod_caps_min_length',
  'mod_caps_max_percent',
  'mod_emote_max_count',
  'mod_repeat_max_count',
  'mod_repeat_window_seconds',
  'mod_symbols_min_length',
  'mod_symbols_max_percent',
  'mod_escalation_2_timeout',
  'mod_escalation_3_timeout',
  'mod_escalation_4_timeout',
]);

// Per-rule escalation start tier — integer 1..4 inclusive.
export const MOD_TIER_KEYS = new Set([
  'mod_links_start_tier',
  'mod_caps_start_tier',
  'mod_emote_start_tier',
  'mod_repeat_start_tier',
  'mod_symbols_start_tier',
  'mod_blocked_words_start_tier',
  'mod_first_message_start_tier',
]);

/**
 * Convert a user-supplied setting value into the exact string shape stored in
 * the DB. Throws on invalid input with a human-readable message.
 */
export function normalizeSetting(key: string, value: unknown): string {
  if (MOD_BOOLEAN_KEYS.has(key)) {
    if (value === true || value === 'true' || value === 1 || value === '1') return 'true';
    if (value === false || value === 'false' || value === 0 || value === '0') return 'false';
    throw new Error(`${key} must be a boolean.`);
  }
  if (MOD_NUMERIC_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(`${key} must be a non-negative integer.`);
    }
    return String(n);
  }
  if (key === 'mod_escalation_1') {
    const s = typeof value === 'string' ? value.trim() : String(value).trim();
    if (!['delete', 'warn'].includes(s)) {
      throw new Error('mod_escalation_1 must be delete or warn.');
    }
    return s;
  }
  if (MOD_TIER_KEYS.has(key)) {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      throw new Error(`${key} must be an integer between 1 and 4.`);
    }
    return String(n);
  }
  if (key === 'mod_blocked_words') {
    return normalizeBlockedWords(value);
  }
  if (key === 'mod_discord_webhook_key') {
    if (typeof value !== 'string') {
      throw new Error('mod_discord_webhook_key must be a string.');
    }
    return value.trim();
  }
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

/**
 * Accept either a JSON-string array or a real string[]. Trims, drops empties,
 * lowercases, and dedupes. Returns the canonical JSON-stringified array so
 * downstream code can JSON.parse without surprises.
 */
function normalizeBlockedWords(value: unknown): string {
  let raw: unknown = value;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '[]';
    try {
      raw = JSON.parse(trimmed);
    } catch {
      throw new Error('mod_blocked_words must be a JSON array of strings.');
    }
  }
  if (!Array.isArray(raw)) {
    throw new Error('mod_blocked_words must be an array of strings.');
  }
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const word = item.trim().toLowerCase();
    if (!word || seen.has(word)) continue;
    seen.add(word);
    cleaned.push(word);
  }
  return JSON.stringify(cleaned);
}
