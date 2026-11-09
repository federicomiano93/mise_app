import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '@mise/shared/calculator-config';
import {
  applyDivisor, applyExtra, applyLog, changedKeys, divisorOpening, divisorProducts, extraOpening, logChanged, logOpening,
  sameTicks,
} from './settingsModel';
import { configOf } from '../testing/renderCalculator';

const config = (over: Record<string, unknown> = {}) => normalizeConfig(configOf(over));

describe('changedKeys', () => {
  it('names the keys whose value differs, and none when nothing does', () => {
    expect(changedKeys({ a: true, b: false }, { a: true, b: true })).toEqual(['b']);
    expect(changedKeys({ a: true }, { a: true })).toEqual([]);
  });
});

describe('Extra dough', () => {
  it('opens with one answer per recipe, on unless a literal false', () => {
    expect(extraOpening(config({ extraDough: { brioche: false } }))).toEqual({ focaccia: true, brioche: false, sourdough: true });
  });

  it('writes only the keys that changed, over the LATEST map', () => {
    const opening = { focaccia: true, brioche: true, sourdough: true };
    const latest = config({ extraDough: { sourdough: false } });
    const next = applyExtra(latest, opening, { focaccia: true, brioche: false, sourdough: true });
    expect(next.extraDough).toEqual({ focaccia: true, brioche: false, sourdough: false });
    expect(next.recipes).toBe(latest.recipes);
  });
});

describe('Divisor', () => {
  it('lists each product once, in the order of the tab, and leaves the paused out', () => {
    expect(divisorProducts(config(), 'focaccia').map(product => product.id)).toEqual(['tray', 'slab', 'cheese']);
    expect(divisorProducts(config(), 'sourdough')).toEqual([]);
  });

  it('opens with the ids ticked, as text', () => {
    expect(divisorOpening(config({ divisorIncluded: { focaccia: ['slab'] } }), 'focaccia')).toEqual(['slab']);
    expect(divisorOpening(config(), 'focaccia')).toEqual([]);
  });

  it('does not count the order of the ticks as a change', () => {
    expect(sameTicks(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameTicks(['a'], ['a', 'b'])).toBe(false);
    expect(sameTicks([], [])).toBe(true);
  });

  it('writes the one recipe list and leaves the others', () => {
    const latest = config({ divisorIncluded: { brioche: ['roll'] } });
    expect(applyDivisor(latest, 'focaccia', ['tray']).divisorIncluded)
      .toEqual({ focaccia: ['tray'], brioche: ['roll'], sourdough: [] });
  });
});

describe('Dough history', () => {
  it('opens with the answer of the venue for every recipe', () => {
    expect(logOpening(config({ logVisibility: { brioche: false }, logRetentionByDough: { focaccia: 48 } }))).toEqual({
      visibility: { focaccia: true, brioche: false, sourdough: true },
      retention: { focaccia: 48, brioche: 24, sourdough: 24 },
    });
  });

  it('is changed only when a value differs from the opening one', () => {
    const opening = logOpening(config());
    expect(logChanged(opening, opening)).toBe(false);
    expect(logChanged(opening, { ...opening, retention: { ...opening.retention, focaccia: 48 } })).toBe(true);
    expect(logChanged(opening, { ...opening, visibility: { ...opening.visibility, brioche: false } })).toBe(true);
  });

  it('writes only what changed, over the LATEST maps', () => {
    const opening = logOpening(config());
    const latest = config({ logVisibility: { sourdough: false }, logRetentionByDough: { brioche: 48 } });
    const next = applyLog(latest, opening, {
      visibility: { ...opening.visibility, focaccia: false },
      retention: { ...opening.retention, focaccia: 48 },
    });
    expect(next.logVisibility).toEqual({ focaccia: false, brioche: true, sourdough: false });
    expect(next.logRetentionByDough).toEqual({ focaccia: 48, brioche: 48, sourdough: 24 });
  });
});
