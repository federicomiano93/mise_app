import { describe, expect, it } from 'vitest';
import type { CakeLineCost } from '@mise/shared/cake-model';
import { STEP_KEYS, STEP_PARTS, filterByName, matchSpans, partFigures, partKey, startStep, stepNumber } from './cakeStepsModel';

describe('the order of the steps', () => {
  it('runs base, soak, filling, coating, decoration, then the cost', () => {
    expect([...STEP_PARTS]).toEqual(['base', 'soak', 'filling', 'coating', 'decoration']);
    expect([...STEP_KEYS]).toEqual(['base', 'soak', 'filling', 'coating', 'decoration', 'cost']);
    expect(stepNumber('base')).toBe(1);
    expect(stepNumber('decoration')).toBe(5);
    expect(stepNumber('cost')).toBe(6);
  });

  it('opens the first step on a new cake and none on a saved one', () => {
    expect(startStep(false)).toBe('base');
    expect(startStep(true)).toBeNull();
  });
});

const cost = (tier: number, part: CakeLineCost['line']['part'], grams: number, materials: number | null, missing = false): CakeLineCost => ({
  line: { tier, part, productId: `${part}${String(grams)}`, grams: missing ? 0 : grams, missing, manual: !missing, share: null, ruleG: null, diameterCm: 20 },
  name: part,
  materials,
  labour: null,
  reason: null,
});

describe('what a part holds, for its callout', () => {
  it('adds up the grams and the cost of every card of a part of a tier', () => {
    const map = partFigures([cost(0, 'base', 300, 0.6), cost(0, 'base', 200, 0.4), cost(0, 'soak', 90, 0.3), cost(1, 'base', 100, 0.2)]);
    expect(map.get(partKey(0, 'base'))).toEqual({ grams: 500, materials: 1, missingGrams: false });
    expect(map.get(partKey(0, 'soak'))).toEqual({ grams: 90, materials: 0.3, missingGrams: false });
    expect(map.get(partKey(1, 'base'))?.grams).toBe(100);
    expect(map.has(partKey(0, 'coating'))).toBe(false);
  });

  it('a card with no price makes the part’s cost unknown, never a lower number', () => {
    const map = partFigures([cost(0, 'base', 300, 0.6), cost(0, 'base', 200, null)]);
    expect(map.get(partKey(0, 'base'))?.materials).toBeNull();
    expect(partFigures([cost(0, 'base', 200, null), cost(0, 'base', 300, 0.6)]).get(partKey(0, 'base'))?.materials).toBeNull();
  });

  it('remembers that grams are still to be typed', () => {
    const map = partFigures([cost(0, 'base', 0, 0, true), cost(0, 'base', 100, 0.2)]);
    expect(map.get(partKey(0, 'base'))?.missingGrams).toBe(true);
  });
});

describe('searching a name', () => {
  it('marks the typed letters, ignoring capitals and accents', () => {
    expect(matchSpans('Crema pasticcera', 'past')).toEqual([
      { text: 'Crema ', match: false }, { text: 'past', match: true }, { text: 'iccera', match: false },
    ]);
    expect(matchSpans('Bagna al caffè', 'CAFFE')).toEqual([{ text: 'Bagna al ', match: false }, { text: 'caffè', match: true }]);
    expect(matchSpans('Ganache', 'gan')).toEqual([{ text: 'Gan', match: true }, { text: 'ache', match: false }]);
  });

  it('marks nothing for an empty search or letters the name does not hold', () => {
    expect(matchSpans('Ganache', '')).toEqual([{ text: 'Ganache', match: false }]);
    expect(matchSpans('Ganache', '  ')).toEqual([{ text: 'Ganache', match: false }]);
    expect(matchSpans('Ganache', 'zz')).toEqual([{ text: 'Ganache', match: false }]);
  });

  it('keeps the name whole when it is joined back', () => {
    for (const [name, query] of [['Pan di Spagna', 'di s'], ['Crème brûlée', 'brul'], ['Æ', 'a']] as const) {
      expect(matchSpans(name, query).map(span => span.text).join('')).toBe(name);
    }
  });

  it('keeps the options whose name holds the letters, in their order; all of them for an empty search', () => {
    const options = [{ name: 'Pan di Spagna' }, { name: 'Panna montata' }, { name: 'Ganache' }];
    expect(filterByName(options, 'pan').map(option => option.name)).toEqual(['Pan di Spagna', 'Panna montata']);
    expect(filterByName(options, 'ÉE')).toEqual([]);
    expect(filterByName(options, '')).toEqual(options);
  });
});
