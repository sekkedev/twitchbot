import { describe, expect, it } from 'vitest';
import { normalizeSetting } from './settings-normalize';

describe('normalizeSetting — boolean keys', () => {
  const key = 'levelup_announce_enabled';

  it('accepts true-like values and returns "1"', () => {
    expect(normalizeSetting(key, true)).toBe('1');
    expect(normalizeSetting(key, 'true')).toBe('1');
    expect(normalizeSetting(key, 1)).toBe('1');
    expect(normalizeSetting(key, '1')).toBe('1');
  });

  it('accepts false-like values and returns "0"', () => {
    expect(normalizeSetting(key, false)).toBe('0');
    expect(normalizeSetting(key, 'false')).toBe('0');
    expect(normalizeSetting(key, 0)).toBe('0');
    expect(normalizeSetting(key, '0')).toBe('0');
  });

  it('rejects ambiguous values', () => {
    expect(() => normalizeSetting(key, 'yes')).toThrow();
    expect(() => normalizeSetting(key, 2)).toThrow();
    expect(() => normalizeSetting(key, null)).toThrow();
  });
});

describe('normalizeSetting - moderation keys', () => {
  it('stores moderation booleans as true/false strings', () => {
    expect(normalizeSetting('mod_links_enabled', true)).toBe('true');
    expect(normalizeSetting('mod_links_enabled', '1')).toBe('true');
    expect(normalizeSetting('mod_links_enabled', false)).toBe('false');
    expect(normalizeSetting('mod_links_enabled', '0')).toBe('false');
  });

  it('validates moderation numeric thresholds', () => {
    expect(normalizeSetting('mod_caps_max_percent', 70)).toBe('70');
    expect(() => normalizeSetting('mod_caps_max_percent', -1)).toThrow();
    expect(() => normalizeSetting('mod_caps_max_percent', 1.5)).toThrow();
  });

  it('validates the first escalation action', () => {
    expect(normalizeSetting('mod_escalation_1', 'delete')).toBe('delete');
    expect(normalizeSetting('mod_escalation_1', 'warn')).toBe('warn');
    expect(() => normalizeSetting('mod_escalation_1', 'timeout')).toThrow();
  });
});

describe('normalizeSetting — integer keys', () => {
  const key = 'exp_per_message';

  it('accepts non-negative integers', () => {
    expect(normalizeSetting(key, 0)).toBe('0');
    expect(normalizeSetting(key, 3)).toBe('3');
    expect(normalizeSetting(key, '42')).toBe('42');
  });

  it('rejects floats, negatives, NaN, and non-numerics', () => {
    expect(() => normalizeSetting(key, -1)).toThrow();
    expect(() => normalizeSetting(key, 1.5)).toThrow();
    expect(() => normalizeSetting(key, 'abc')).toThrow();
    expect(() => normalizeSetting(key, NaN)).toThrow();
    expect(() => normalizeSetting(key, Infinity)).toThrow();
  });
});

describe('normalizeSetting — float keys', () => {
  const key = 'level_exponent';

  it('accepts positive numbers including floats', () => {
    expect(normalizeSetting(key, 1.5)).toBe('1.5');
    expect(normalizeSetting(key, 100)).toBe('100');
    expect(normalizeSetting(key, '2.25')).toBe('2.25');
  });

  it('rejects zero, negatives, and non-finite', () => {
    expect(() => normalizeSetting(key, 0)).toThrow();
    expect(() => normalizeSetting(key, -0.5)).toThrow();
    expect(() => normalizeSetting(key, 'nope')).toThrow();
    expect(() => normalizeSetting(key, NaN)).toThrow();
  });
});

describe('normalizeSetting — bot_prefix', () => {
  it('accepts 1–4 character strings', () => {
    expect(normalizeSetting('bot_prefix', '!')).toBe('!');
    expect(normalizeSetting('bot_prefix', '>>')).toBe('>>');
    expect(normalizeSetting('bot_prefix', '::>>')).toBe('::>>');
  });

  it('trims whitespace', () => {
    expect(normalizeSetting('bot_prefix', '  !  ')).toBe('!');
  });

  it('rejects empty / too long', () => {
    expect(() => normalizeSetting('bot_prefix', '')).toThrow();
    expect(() => normalizeSetting('bot_prefix', '     ')).toThrow();
    expect(() => normalizeSetting('bot_prefix', 'prefix')).toThrow();
  });
});

describe('normalizeSetting — moderation tier keys', () => {
  const key = 'mod_links_start_tier';

  it('accepts integers 1..4', () => {
    expect(normalizeSetting(key, 1)).toBe('1');
    expect(normalizeSetting(key, '3')).toBe('3');
    expect(normalizeSetting(key, 4)).toBe('4');
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(() => normalizeSetting(key, 0)).toThrow();
    expect(() => normalizeSetting(key, 5)).toThrow();
    expect(() => normalizeSetting(key, 2.5)).toThrow();
    expect(() => normalizeSetting(key, 'high')).toThrow();
  });
});

describe('normalizeSetting — blocked words', () => {
  const key = 'mod_blocked_words';

  it('accepts a string array and round-trips through JSON', () => {
    expect(normalizeSetting(key, ['Spam', 'badword'])).toBe(
      JSON.stringify(['spam', 'badword']),
    );
  });

  it('lowercases, trims, and dedupes', () => {
    expect(normalizeSetting(key, ['  Hello  ', 'hello', 'WORLD'])).toBe(
      JSON.stringify(['hello', 'world']),
    );
  });

  it('parses an incoming JSON string', () => {
    expect(normalizeSetting(key, '["foo","bar"]')).toBe(
      JSON.stringify(['foo', 'bar']),
    );
  });

  it('returns "[]" for empty input', () => {
    expect(normalizeSetting(key, [])).toBe('[]');
    expect(normalizeSetting(key, '')).toBe('[]');
  });

  it('rejects non-array shapes', () => {
    expect(() => normalizeSetting(key, 'not json')).toThrow();
    expect(() => normalizeSetting(key, { foo: 'bar' })).toThrow();
    expect(() => normalizeSetting(key, 42)).toThrow();
  });
});

describe('normalizeSetting — generic string keys', () => {
  it('passes strings through unchanged', () => {
    expect(normalizeSetting('levelup_announcement', '{user} hit {level}!')).toBe(
      '{user} hit {level}!',
    );
  });

  it('rejects non-string values for generic string keys', () => {
    expect(() => normalizeSetting('levelup_announcement', 42)).toThrow();
    expect(() => normalizeSetting('levelup_announcement', true)).toThrow();
  });
});
