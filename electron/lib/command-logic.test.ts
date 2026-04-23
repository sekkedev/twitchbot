import { describe, expect, it } from 'vitest';
import {
  canExecute,
  interpolate,
  normalizeCommandName,
  safeParsePermissions,
  validateCommandName,
  type UserRoles,
} from './command-logic';

const EVERYONE: UserRoles = {
  broadcaster: false,
  moderator: false,
  vip: false,
  subscriber: false,
};

const makeRoles = (overrides: Partial<UserRoles> = {}): UserRoles => ({
  ...EVERYONE,
  ...overrides,
});

describe('canExecute', () => {
  it('broadcaster always passes regardless of permissions', () => {
    expect(canExecute([], makeRoles({ broadcaster: true }))).toBe(true);
    expect(canExecute(['vip'], makeRoles({ broadcaster: true }))).toBe(true);
  });

  it('"everyone" short-circuits all other checks', () => {
    expect(canExecute(['everyone'], EVERYONE)).toBe(true);
    expect(canExecute(['everyone', 'moderator'], EVERYONE)).toBe(true);
  });

  it('denies a regular viewer when the command requires a role', () => {
    expect(canExecute(['moderator'], EVERYONE)).toBe(false);
    expect(canExecute(['vip', 'subscriber'], EVERYONE)).toBe(false);
  });

  it('permission is a set, not a hierarchy — vip does not imply sub', () => {
    expect(canExecute(['subscriber'], makeRoles({ vip: true }))).toBe(false);
    expect(canExecute(['vip'], makeRoles({ subscriber: true }))).toBe(false);
  });

  it('matches any listed role the user has', () => {
    expect(canExecute(['vip', 'moderator'], makeRoles({ vip: true }))).toBe(true);
    expect(canExecute(['vip', 'moderator'], makeRoles({ moderator: true }))).toBe(true);
  });

  it('follower check requires explicit follower=true', () => {
    expect(canExecute(['follower'], EVERYONE)).toBe(false);
    expect(canExecute(['follower'], makeRoles({ follower: true }))).toBe(true);
  });
});

describe('interpolate', () => {
  it('substitutes single variables', () => {
    expect(interpolate('Hello {user}', { user: 'Alice' })).toBe('Hello Alice');
  });

  it('coerces non-string values', () => {
    expect(interpolate('Level {level}', { level: 5 })).toBe('Level 5');
  });

  it('leaves unknown variables in place so misspellings are visible', () => {
    expect(interpolate('Hi {name}!', { user: 'Alice' })).toBe('Hi {name}!');
  });

  it('replaces multiple occurrences of the same variable', () => {
    expect(interpolate('{user} == {user}', { user: 'Alice' })).toBe('Alice == Alice');
  });

  it('is not fooled by values that look like placeholder text', () => {
    expect(interpolate('{user}', { user: '{exp}' })).toBe('{exp}');
  });

  it('ignores inherited object properties', () => {
    const vars = Object.create({ user: 'shouldNotLeak' }) as Record<string, string>;
    expect(interpolate('{user}', vars)).toBe('{user}');
  });
});

describe('safeParsePermissions', () => {
  it('parses a valid JSON array', () => {
    expect(safeParsePermissions('["everyone"]')).toEqual(['everyone']);
    expect(safeParsePermissions('["vip","moderator"]')).toEqual(['vip', 'moderator']);
  });

  it('falls back to ["everyone"] on invalid JSON', () => {
    expect(safeParsePermissions('not json')).toEqual(['everyone']);
    expect(safeParsePermissions('')).toEqual(['everyone']);
  });

  it('falls back to ["everyone"] when JSON is not an array', () => {
    expect(safeParsePermissions('"vip"')).toEqual(['everyone']);
    expect(safeParsePermissions('{"role":"vip"}')).toEqual(['everyone']);
  });

  it('filters non-string values from the array', () => {
    expect(safeParsePermissions('["vip", 42, null, "moderator"]')).toEqual([
      'vip',
      'moderator',
    ]);
  });
});

describe('normalizeCommandName', () => {
  it('trims whitespace + lowercases', () => {
    expect(normalizeCommandName('  HELLO  ')).toBe('hello');
  });

  it('strips leading prefix characters', () => {
    expect(normalizeCommandName('!hello')).toBe('hello');
    expect(normalizeCommandName('/hello')).toBe('hello');
    expect(normalizeCommandName('!!/hello')).toBe('hello');
  });

  it('preserves allowed chars', () => {
    expect(normalizeCommandName('hello-world_2')).toBe('hello-world_2');
  });
});

describe('validateCommandName', () => {
  it('accepts well-formed names', () => {
    expect(validateCommandName('hello').valid).toBe(true);
    expect(validateCommandName('a').valid).toBe(true);
    expect(validateCommandName('a'.repeat(40)).valid).toBe(true);
    expect(validateCommandName('hello_world-42').valid).toBe(true);
  });

  it('rejects empty names', () => {
    expect(validateCommandName('').valid).toBe(false);
  });

  it('rejects names longer than 40 chars', () => {
    expect(validateCommandName('a'.repeat(41)).valid).toBe(false);
  });

  it('rejects whitespace and invalid characters', () => {
    expect(validateCommandName('hello world').valid).toBe(false);
    expect(validateCommandName('hello!').valid).toBe(false);
    expect(validateCommandName('hello.').valid).toBe(false);
    expect(validateCommandName('Hello').valid).toBe(false);
  });

  it('attaches a reason string on failure', () => {
    const result = validateCommandName('bad name');
    expect(result.valid).toBe(false);
    expect(result.reason).toBeTypeOf('string');
    expect(result.reason).toMatch(/1–40 characters/);
  });
});
