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
