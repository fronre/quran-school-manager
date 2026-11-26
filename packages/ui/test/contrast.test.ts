import { describe, it, expect } from 'vitest';
import { tokens, usedPairs, contrast, toCssVariables } from '../src';

describe('contrast calculator', () => {
  it('matches known WCAG values', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 1);
    expect(contrast('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
  it('reproduces the measured numbers in DESIGN_SYSTEM 3.2', () => {
    expect(contrast(tokens.brass, tokens.ivory)).toBeCloseTo(2.78, 1);
    expect(contrast(tokens['brass-ink'], tokens.ivory)).toBeCloseTo(4.59, 1);
    expect(contrast(tokens['brass-lt'], tokens.deep)).toBeCloseTo(5.86, 1);
    expect(contrast(tokens.em, tokens.ivory)).toBeCloseTo(8.87, 1);
    expect(contrast(tokens.ink3, tokens.ivory)).toBeCloseTo(5.56, 1);
  });
  it('rejects malformed colours', () => { expect(() => contrast('red', '#fff')).toThrow(); });
});

describe('every used colour pair meets its minimum (build gate)', () => {
  for (const p of usedPairs) {
    it(`${p.fg} on ${p.bg} >= ${p.min} (${p.use})`, () => {
      expect(contrast(tokens[p.fg], tokens[p.bg])).toBeGreaterThanOrEqual(p.min);
    });
  }
  it('plain brass is not used as text on any light background', () => {
    expect(usedPairs.some((p) => p.fg === 'brass')).toBe(false);
    expect(contrast(tokens.brass, tokens.ivory)).toBeLessThan(4.5);
  });
});

describe('css variables', () => {
  it('emits one variable per token', () => {
    const css = toCssVariables();
    expect(css.startsWith(':root{')).toBe(true);
    for (const k of Object.keys(tokens)) expect(css).toContain(`--${k}:`);
  });
});
