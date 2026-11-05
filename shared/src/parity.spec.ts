// The fourteen TypeScript models and the js/ files the live app runs today must stay the SAME
// thing, until the switch to Mise 2 retires the js/ ones. The behaviour specs next to each model
// run every test against both; this file checks what a behaviour test cannot see — that the two
// export the same names, the same constants, the same frozen-ness and the same function shapes.
//
// membership.ts, location-id.ts and pastries-model.ts are NOT paired here: they are partial ports
// (the pure half of js/roles.js and js/location.js; and everything in js/pastries/pastries-model.js
// except weekdayLabel and weekdayShortLabel, which look a word up in the interface dictionary that
// in Mise 2 belongs to the app), so the js/ files export more by design; their specs run every
// test against both files instead (pastries-model.spec.ts also compares the names, constants,
// frozen-ness and function shapes of everything it does port).
//
// ⚠️ IT IS WHAT CATCHES A FIX MADE TO js/ AND FORGOTTEN HERE. A constant changed in one file
// (a new allergen, a new push kind, a new card) is invisible to every behavioural test that does
// not happen to read it; here it is a red line naming the export.

import { describe, expect, test } from 'vitest';
import * as joinCode from './join-code';
import * as pushModel from './push-model';
import * as homeCards from './home-cards';
import * as awayModel from './away-model';
import * as allergenModel from './allergen-model';
import * as sections from './sections';
import * as firebaseTarget from './firebase-target';
import * as localData from './local-data';
import * as sameData from './same-data';
import * as errorModel from './error-model';
import * as deviceModel from './device-model';
import * as usageModel from './usage-model';
import * as pastriesLogModel from './pastries-log-model';
import * as pastriesLock from './pastries-lock';
import * as legacyJoinCode from '../../js/join-code.js';
import * as legacyPushModel from '../../js/push-model.js';
import * as legacyHomeCards from '../../js/home-cards.js';
import * as legacyAwayModel from '../../js/away-model.js';
import * as legacyAllergenModel from '../../js/allergen-model.js';
import * as legacySections from '../../js/sections.js';
import * as legacyFirebaseTarget from '../../js/firebase-target.js';
import * as legacyLocalData from '../../js/local-data.js';
import * as legacySameData from '../../js/same-data.js';
import * as legacyErrorModel from '../../js/error-model.js';
import * as legacyDeviceModel from '../../js/device-model.js';
import * as legacyUsageModel from '../../js/usage-model.js';
import * as legacyPastriesLogModel from '../../js/pastries/pastries-log-model.js';
import * as legacyPastriesLock from '../../js/pastries/pastries-lock.js';

const PAIRS: readonly (readonly [string, object, object])[] = [
  ['join-code', joinCode, legacyJoinCode],
  ['push-model', pushModel, legacyPushModel],
  ['home-cards', homeCards, legacyHomeCards],
  ['away-model', awayModel, legacyAwayModel],
  ['allergen-model', allergenModel, legacyAllergenModel],
  ['sections', sections, legacySections],
  ['firebase-target', firebaseTarget, legacyFirebaseTarget],
  ['local-data', localData, legacyLocalData],
  ['same-data', sameData, legacySameData],
  ['error-model', errorModel, legacyErrorModel],
  ['device-model', deviceModel, legacyDeviceModel],
  ['usage-model', usageModel, legacyUsageModel],
  ['pastries-log-model', pastriesLogModel, legacyPastriesLogModel],
  ['pastries-lock', pastriesLock, legacyPastriesLock],
];

const exportsOf = (module: object): Record<string, unknown> => module as Record<string, unknown>;

// Whether a value, and everything inside it, is frozen — as a tree, so that a card frozen in one
// file and loose in the other is a difference even when the list around it is frozen in both.
type FrozenTree = null | { frozen: boolean; children: Record<string, FrozenTree> };

function frozenTree(value: unknown, seen: WeakSet<object> = new WeakSet()): FrozenTree {
  if (typeof value !== 'object' || value === null) return null;
  if (seen.has(value)) return { frozen: Object.isFrozen(value), children: {} };
  seen.add(value);
  const children: Record<string, FrozenTree> = {};
  for (const [key, inner] of Object.entries(value)) children[key] = frozenTree(inner, seen);
  return { frozen: Object.isFrozen(value), children };
}

describe.each(PAIRS)('parity: %s', (_name, tsModule, jsModule) => {
  const ts = exportsOf(tsModule);
  const js = exportsOf(jsModule);
  const names = Object.keys(js).sort();

  test('exports exactly the same names', () => {
    expect(Object.keys(ts).sort()).toStrictEqual(names);
  });

  test('every export is a function in both or a value in both', () => {
    for (const name of names) {
      expect(typeof ts[name], name).toBe(typeof js[name]);
    }
  });

  test('every non-function export is strictly equal', () => {
    for (const name of names) {
      if (typeof js[name] === 'function') continue;
      expect(ts[name], name).toStrictEqual(js[name]);
    }
  });

  test('frozen-ness matches for every object and array export, all the way down', () => {
    for (const name of names) {
      if (typeof js[name] !== 'object' || js[name] === null) continue;
      expect(Object.isFrozen(ts[name]), name).toBe(Object.isFrozen(js[name]));
      expect(frozenTree(ts[name]), name).toStrictEqual(frozenTree(js[name]));
    }
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of names) {
      const mine = ts[name];
      const theirs = js[name];
      if (typeof mine !== 'function' || typeof theirs !== 'function') continue;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});

test('all fourteen models are compared', () => {
  expect(PAIRS.map(([name]) => name)).toStrictEqual(
    ['join-code', 'push-model', 'home-cards', 'away-model', 'allergen-model', 'sections', 'firebase-target', 'local-data', 'same-data',
      'error-model', 'device-model', 'usage-model', 'pastries-log-model', 'pastries-lock']);
});
