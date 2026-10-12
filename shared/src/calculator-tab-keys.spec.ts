// Unit tests for the local-storage keys of one Calculator tab and the two decisions made about them
// (P15 — the owner cannot read code). calculator-tab-keys.ts is NEW IN MISE 2, not a port: in the current app
// the keys are string literals scattered through js/app.js and js/calc.js, so there is no function to run
// both ways. What these tests do instead is PIN THE SPELLING against the current app's own source (the keys
// are shared with it, same origin and same localStorage: both apps read each other's copy) and the decisions
// against the behaviour the current app has (item 32 of docs/parity/calculator.md: the tab state keys; item
// 57: the new-work-day sweep).
//
// A source-text check first proves it found what it looks for — a pattern that matches nothing passes any
// change.

import { describe, expect, test } from 'vitest';
import * as keys from './calculator-tab-keys';
import { workDayIndex } from './log-model';
import * as legacyLogJs from '../../js/log-model.js';
import appSource from '../../js/app.js?raw';
import calcSource from '../../js/calc.js?raw';
import settingsSource from '../../js/calculator-settings.js?raw';

const lf = (text: string): string => text.replace(/\r\n/g, '\n');
const appJs = lf(appSource);
const calcJs = lf(calcSource);
const settingsJs = lf(settingsSource);

// The body of a top-level function of a source file, from its signature to the closing brace in column 0.
function bodyOf(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `${signature} is in the source`).toBeGreaterThan(-1);
  const end = source.indexOf('\n}\n', start);
  expect(end, `${signature} ends`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('the key spelling is the current app\'s', () => {
  test('each key is the literal prefix plus the id, as in js/app.js and js/calc.js', () => {
    expect(keys.qtyKey('c1::p1')).toBe('qty-c1::p1');
    expect(keys.paramKey('focaccia')).toBe('param-focaccia');
    expect(keys.totalKey('focaccia')).toBe('total-focaccia');
    expect(keys.traysKey('focaccia')).toBe('trays-focaccia');
    expect(keys.extraKey('focaccia')).toBe('extra-focaccia');
    expect(keys.extraUnitKey('focaccia')).toBe('extra-unit-focaccia');
    expect(keys.touchedKey('focaccia')).toBe('touched-focaccia');
    expect(keys.revealedKey('focaccia')).toBe('revealed-focaccia');
    expect(keys.lockKey('focaccia')).toBe('lock-focaccia');
  });

  test('the current app reads and writes exactly these prefixes', () => {
    const used: Record<string, [string, RegExp]> = {
      qty: ['js/app.js', /localStorage\.setItem\('qty-' \+ id, e\.value\)/],
      param: ['js/app.js', /localStorage\.setItem\('param-' \+ recipeId, e\.value\)/],
      total: ['js/app.js', /localStorage\.setItem\('total-' \+ id, totalInput\.value\)/],
      trays: ['js/app.js', /localStorage\.setItem\('trays-' \+ id, traysInput\.value\)/],
      extra: ['js/app.js', /localStorage\.setItem\('extra-' \+ id, extra\.value\)/],
      extraUnit: ['js/app.js', /localStorage\.setItem\('extra-unit-' \+ id, extraUnit\.value\)/],
      touched: ['js/app.js', /localStorage\.setItem\('touched-' \+ recipeId, String\(Date\.now\(\)\)\)/],
      revealed: ['js/calc.js', /localStorage\.setItem\('revealed-' \+ id, '1'\)/],
      lock: ['js/calc.js', /localStorage\.setItem\('lock-' \+ id, JSON\.stringify\(lockState\[id\]\)\)/],
    };
    const sources: Record<string, string> = { 'js/app.js': appJs, 'js/calc.js': calcJs };
    for (const [name, [file, pattern]] of Object.entries(used)) {
      expect(pattern.test(sources[file] as string), `${name} in ${file}`).toBe(true);
    }
  });

  test('a quantity key is the product box\'s own id, which is what the Clients editor also removes', () => {
    expect(/localStorage\.removeItem\('qty-' \+ pairId\(client\.id, product\.id\)\)/.test(settingsJs)).toBe(true);
    expect(keys.qtyKey('c1::p1')).toBe('qty-' + 'c1::p1');
  });
});

describe('tabKeysToForget is the list the current app forgets', () => {
  test('it names the same keys as forgetTabStorage (every removeItem and the two clear helpers)', () => {
    const body = bodyOf(appJs, 'function forgetTabStorage(recipeId)');
    // The five plain removals, then clearRevealed / clearLock / clearQty, which remove `revealed-`, `lock-` and
    // every `qty-<id>`.
    const plain = [...body.matchAll(/localStorage\.removeItem\('([a-z-]+)' \+ recipeId\)/g)].map(m => m[1]);
    expect(plain).toStrictEqual(['param-', 'total-', 'trays-', 'extra-', 'extra-unit-', 'touched-']);
    expect(body).toContain('clearRevealed(recipeId)');
    expect(body).toContain('clearLock(recipeId)');
    expect(body).toContain('clearQty(recipeId)');
    expect(calcJs).toContain("localStorage.removeItem('revealed-' + id)");
    expect(calcJs).toContain("localStorage.removeItem('lock-' + id)");

    const forgotten = keys.tabKeysToForget('rid', ['q1', 'q2']);
    expect([...forgotten].sort()).toStrictEqual([
      'extra-rid', 'extra-unit-rid', 'lock-rid', 'param-rid', 'qty-q1', 'qty-q2', 'revealed-rid', 'total-rid', 'touched-rid', 'trays-rid',
    ]);
  });

  test('the lock goes too, so tomorrow\'s Confirm cannot rewrite yesterday\'s log', () => {
    expect(keys.tabKeysToForget('rid', [])).toContain('lock-rid');
  });

  test('a tab with no products still forgets everything else, with no duplicate', () => {
    const list = keys.tabKeysToForget('rid', []);
    expect(list).toHaveLength(8);
    expect(new Set(list).size).toBe(list.length);
  });
});

describe('isStaleTab: item 57, the new-work-day sweep', () => {
  // Local time, so nothing depends on where the suite runs.
  const at = (day: number, hour: number, minute = 0): number => new Date(2026, 9, day, hour, minute).getTime();

  test('a stamp from an earlier work day is stale', () => {
    expect(keys.isStaleTab(String(at(10, 15)), at(11, 15))).toBe(true);
    expect(keys.isStaleTab(String(at(1, 9)), at(11, 9))).toBe(true);
  });

  test('a stamp from the same work day is not', () => {
    expect(keys.isStaleTab(String(at(11, 9)), at(11, 15))).toBe(false);
    expect(keys.isStaleTab(String(at(11, 9)), at(11, 9))).toBe(false);
  });

  test('the day rolls over at 4am: 23:30 revisited at 00:30 is the same night\'s work', () => {
    expect(keys.isStaleTab(String(at(10, 23, 30)), at(11, 0, 30))).toBe(false);
    expect(keys.isStaleTab(String(at(10, 23, 30)), at(11, 3, 59))).toBe(false);
    expect(keys.isStaleTab(String(at(10, 23, 30)), at(11, 4, 0))).toBe(true);
  });

  test('a missing, zero, negative or non-numeric stamp is never stale (the tab was not used)', () => {
    for (const stamp of [null, undefined, '', '0', 0, '-5', -5, 'abc', NaN, Infinity, '1e999', {}, []]) {
      expect(keys.isStaleTab(stamp, at(11, 15)), String(stamp)).toBe(false);
    }
  });

  test('it agrees with the current app\'s own decision in expireStaleTabs, for a spread of moments', () => {
    const legacyIndex = (legacyLogJs as unknown as { workDayIndex: (ms: number) => number }).workDayIndex;
    // js/app.js: Number(stamp) finite and > 0, then `workDayIndex(stamp) === workDayIndex(Date.now())` keeps it.
    const decide = (stamp: unknown, now: number): boolean => {
      const ms = Number(stamp);
      if (!Number.isFinite(ms) || ms <= 0) return false;
      return legacyIndex(ms) !== legacyIndex(now);
    };
    const moments: number[] = [];
    for (let day = 9; day <= 12; day++) for (const [h, m] of [[0, 0], [3, 59], [4, 0], [12, 0], [23, 59]] as const) moments.push(at(day, h, m));
    for (const stamp of moments) {
      for (const now of moments) expect(keys.isStaleTab(String(stamp), now), `${new Date(stamp).toISOString()} -> ${new Date(now).toISOString()}`).toBe(decide(String(stamp), now));
    }
    expect(workDayIndex(at(11, 12))).toBe(legacyIndex(at(11, 12)));
  });

  test('the sweep in js/app.js reads the touched- key, skips a missing stamp and compares work days', () => {
    const body = bodyOf(appJs, 'function expireStaleTabs(recipeIds, { withFields })');
    expect(body).toContain("Number(localStorage.getItem('touched-' + id))");
    expect(body).toContain('!Number.isFinite(stamp) || stamp <= 0');
    expect(body).toContain('workDayIndex(stamp) === today');
  });
});

describe('staleTabIds', () => {
  const at = (day: number, hour: number): number => new Date(2026, 9, day, hour).getTime();

  test('returns the ids whose touched- stamp is from an earlier work day, in the order given', () => {
    const store: Record<string, string> = {
      'touched-a': String(at(10, 15)), 'touched-b': String(at(11, 9)), 'touched-d': 'junk', 'touched-e': String(at(8, 9)),
    };
    const read = (key: string): string | null => store[key] ?? null;
    expect(keys.staleTabIds(['e', 'a', 'b', 'c', 'd'], read, at(11, 15))).toStrictEqual(['e', 'a']);
  });

  test('reads each tab\'s stamp through touchedKey, nothing else', () => {
    const asked: string[] = [];
    keys.staleTabIds(['x', 'y'], key => { asked.push(key); return null; }, Date.now());
    expect(asked).toStrictEqual(['touched-x', 'touched-y']);
  });

  test('no tabs, no stale tabs', () => {
    expect(keys.staleTabIds([], () => null, Date.now())).toStrictEqual([]);
  });
});

describe('the lock value: item 32, the shape js/calc.js stores', () => {
  test('serializeLock writes the same text as js/calc.js (locked, then logId, null when none)', () => {
    expect(keys.serializeLock(true, 'log-1')).toBe(JSON.stringify({ locked: true, logId: 'log-1' }));
    expect(keys.serializeLock(false)).toBe('{"locked":false,"logId":null}');
    expect(keys.serializeLock(1, '')).toBe('{"locked":true,"logId":null}');
    expect(calcJs).toContain('lockState[id] = { locked: !!locked, logId: logId || null }');
  });

  test('parseLock reads what the current app wrote', () => {
    expect(keys.parseLock('{"locked":true,"logId":"log-1"}')).toStrictEqual({ locked: true, logId: 'log-1' });
    expect(keys.parseLock('{"locked":false,"logId":null}')).toStrictEqual({ locked: false, logId: null });
    expect(keys.parseLock('{"locked":1}')).toStrictEqual({ locked: true, logId: null });
  });

  test('a missing or unreadable lock is null, never a throw (a corrupt value must not stop the page)', () => {
    for (const raw of [null, undefined, '', 'not json', '{', 5, {}, [], false]) {
      expect(keys.parseLock(raw), String(raw)).toBeNull();
    }
  });

  test('a stored JSON that is not an object is read as an unlocked, unlinked tab, as js/calc.js reads it', () => {
    // js/calc.js: `const v = JSON.parse(raw); lockState[id] = { locked: !!v.locked, logId: v.logId || null }` — a
    // number or an array has no `locked`, so the tab is unlocked. `null` throws there and is caught: no state.
    expect(keys.parseLock('5')).toStrictEqual({ locked: false, logId: null });
    expect(keys.parseLock('[]')).toStrictEqual({ locked: false, logId: null });
    expect(keys.parseLock('null')).toBeNull();
  });

  test('a round trip keeps the lock', () => {
    expect(keys.parseLock(keys.serializeLock(true, 'abc'))).toStrictEqual({ locked: true, logId: 'abc' });
    expect(keys.parseLock(keys.serializeLock(false, null))).toStrictEqual({ locked: false, logId: null });
  });
});
