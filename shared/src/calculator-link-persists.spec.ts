// A Calculator tab linked to a Catalogue recipe keeps its link through the config normaliser (P15), run
// against BOTH implementations: the TypeScript port in shared/ and js/calculator-config.js. Ported from
// tests/calculator-link-persists.test.mjs (all 4 of its tests).
//
// The normaliser runs on every save, on the live stream and on the cached copy. Until 4 Oct 2026 it rebuilt
// each recipe from a fixed key list without `catalogueId`, so a link was lost the moment it was saved.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-config';
import * as legacyJs from '../../js/calculator-config.js';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const normalizeConfig = (raw: unknown): Loose => m.normalizeConfig(raw);

  const recipe = (extra: Loose = {}): Loose => ({
    id: 'r1', name: 'Focaccia', logic: 'total',
    ingredients: [{ key: 'flour', label: 'Flour', grams: 500 }],
    ...extra,
  });

  test('a linked recipe keeps catalogueId and leaveningRid', () => {
    const cfg = normalizeConfig({ clients: [], recipes: [recipe({ catalogueId: 'cat42', leaveningRid: 'row7' })] });
    expect(cfg.recipes[0].catalogueId).toBe('cat42');
    expect(cfg.recipes[0].leaveningRid).toBe('row7');
  });

  test('a link with no leavening row keeps the link, leaveningRid null', () => {
    const cfg = normalizeConfig({ clients: [], recipes: [recipe({ catalogueId: 'cat42' })] });
    expect(cfg.recipes[0].catalogueId).toBe('cat42');
    expect(cfg.recipes[0].leaveningRid).toBe(null);
  });

  test('it survives a second pass (save → stream → cache)', () => {
    const once = normalizeConfig({ clients: [], recipes: [recipe({ catalogueId: 'cat42', leaveningRid: 'row7' })] });
    const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.recipes[0].catalogueId).toBe('cat42');
    expect(twice.recipes[0].leaveningRid).toBe('row7');
  });

  test('an unlinked recipe carries no link keys at all', () => {
    for (const extra of [{}, { catalogueId: '' }, { catalogueId: '   ' }, { catalogueId: null }]) {
      const r = normalizeConfig({ clients: [], recipes: [recipe(extra)] }).recipes[0];
      expect(!('catalogueId' in r), JSON.stringify(extra)).toBeTruthy();
      expect(!('leaveningRid' in r), JSON.stringify(extra)).toBeTruthy();
    }
  });
});
