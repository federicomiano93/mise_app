// A Calculator tab linked to a Catalogue recipe keeps its link through the config
// normaliser, which runs on every save, on the live stream and on the cached copy.
// Until 4 Oct 2026 it rebuilt each recipe from a fixed key list without `catalogueId`,
// so a link was lost the moment it was saved.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../js/calculator-config.js';

const recipe = (extra = {}) => ({
  id: 'r1', name: 'Focaccia', logic: 'total',
  ingredients: [{ key: 'flour', label: 'Flour', grams: 500 }],
  ...extra,
});

test('a linked recipe keeps catalogueId and leaveningRid', () => {
  const cfg = normalizeConfig({ clients: [], recipes: [recipe({ catalogueId: 'cat42', leaveningRid: 'row7' })] });
  assert.equal(cfg.recipes[0].catalogueId, 'cat42');
  assert.equal(cfg.recipes[0].leaveningRid, 'row7');
});

test('a link with no leavening row keeps the link, leaveningRid null', () => {
  const cfg = normalizeConfig({ clients: [], recipes: [recipe({ catalogueId: 'cat42' })] });
  assert.equal(cfg.recipes[0].catalogueId, 'cat42');
  assert.equal(cfg.recipes[0].leaveningRid, null);
});

test('it survives a second pass (save → stream → cache)', () => {
  const once = normalizeConfig({ clients: [], recipes: [recipe({ catalogueId: 'cat42', leaveningRid: 'row7' })] });
  const twice = normalizeConfig(JSON.parse(JSON.stringify(once)));
  assert.equal(twice.recipes[0].catalogueId, 'cat42');
  assert.equal(twice.recipes[0].leaveningRid, 'row7');
});

test('an unlinked recipe carries no link keys at all', () => {
  for (const extra of [{}, { catalogueId: '' }, { catalogueId: '   ' }, { catalogueId: null }]) {
    const r = normalizeConfig({ clients: [], recipes: [recipe(extra)] }).recipes[0];
    assert.ok(!('catalogueId' in r), JSON.stringify(extra));
    assert.ok(!('leaveningRid' in r), JSON.stringify(extra));
  }
});
