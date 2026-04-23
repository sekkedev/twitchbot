import { describe, expect, it } from 'vitest';
import { computeLevel, expForNextLevel, levelProgress } from './leveling';

const BASE = 100;
const EXPONENT = 1.5;

describe('expForNextLevel', () => {
  it('matches the spec formula: floor(base * level^exponent)', () => {
    expect(expForNextLevel(1, 100, 1.5)).toBe(100);
    expect(expForNextLevel(2, 100, 1.5)).toBe(282);
    expect(expForNextLevel(5, 100, 1.5)).toBe(1118);
    expect(expForNextLevel(10, 100, 1.5)).toBe(3162);
  });

  it('handles different bases + exponents', () => {
    expect(expForNextLevel(5, 50, 2)).toBe(1250);
    expect(expForNextLevel(3, 200, 1)).toBe(600);
    expect(expForNextLevel(1, 1, 1)).toBe(1);
  });
});

describe('computeLevel', () => {
  it('level 1 when total EXP is 0 or below', () => {
    expect(computeLevel(0, BASE, EXPONENT)).toBe(1);
    expect(computeLevel(-500, BASE, EXPONENT)).toBe(1);
    expect(computeLevel(99, BASE, EXPONENT)).toBe(1);
  });

  it('crosses the level 1 > 2 threshold at 100 EXP', () => {
    expect(computeLevel(100, BASE, EXPONENT)).toBe(2);
    expect(computeLevel(150, BASE, EXPONENT)).toBe(2);
    expect(computeLevel(381, BASE, EXPONENT)).toBe(2); // still in lvl 2 range
  });

  it('crosses level 2 > 3 at cumulative 100 + 282 = 382', () => {
    expect(computeLevel(382, BASE, EXPONENT)).toBe(3);
    expect(computeLevel(500, BASE, EXPONENT)).toBe(3);
  });

  it('produces monotonically non-decreasing levels as EXP grows', () => {
    let last = 1;
    for (let exp = 0; exp <= 100_000; exp += 500) {
      const lvl = computeLevel(exp, BASE, EXPONENT);
      expect(lvl).toBeGreaterThanOrEqual(last);
      last = lvl;
    }
  });

  it('caps at the safety bound for absurd totals', () => {
    const lvl = computeLevel(Number.MAX_SAFE_INTEGER, 1, 1);
    expect(lvl).toBeLessThanOrEqual(1000);
    expect(lvl).toBeGreaterThan(900);
  });
});

describe('levelProgress', () => {
  it('returns 0 progress at the start of a fresh level', () => {
    // Reach level 2 exactly at 100 EXP — 0 progress into level 2.
    const p = levelProgress(100, BASE, EXPONENT);
    expect(p.level).toBe(2);
    expect(p.currentLevelStart).toBe(100);
    expect(p.progress).toBe(0);
  });

  it('reports progress fraction within the current band', () => {
    // Halfway through the 100 EXP band of level 1 (50 EXP total)
    const p = levelProgress(50, BASE, EXPONENT);
    expect(p.level).toBe(1);
    expect(p.currentLevelStart).toBe(0);
    expect(p.nextLevelAt).toBe(100);
    expect(p.progress).toBeCloseTo(0.5);
  });
});
