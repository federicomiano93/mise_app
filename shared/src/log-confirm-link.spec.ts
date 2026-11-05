// Unit tests for the Confirm/Edit link model (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/log-model.js, which the live app uses today. Ported from tests/log-confirm-link.test.mjs
// (all 11 of its tests); the two must stay equal until the switch to Mise 2.
//
// The rule that a calculator tab confirms into the SAME log until Reset drops the link, and that a re-confirm
// can move the log to a different Today/Tomorrow. Pure functions only — the lock and the storage live in the
// screen (see calculator-tab-keys.ts for the keys).

import { describe, expect, test } from 'vitest';
import * as ported from './log-model';
import * as legacyJs from '../../js/log-model.js';

const legacy = legacyJs as unknown as typeof ported;

type Loose = any;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { confirmTarget, setForDay, createLog, addVersion, latestVersion } = m as unknown as Record<string, Loose>;


  function version(kind: string): Loose {
    return { calculatedBy: '', at: { date: '2026-06-24', time: '10:00' }, kind, items: [], occasional: [], sheet: null, text: '' };
  }

  // ── confirmTarget: create vs update ───────────────────────────────────────────
  test('confirmTarget: no linked log → create', () => {
    expect(confirmTarget({ linkedId: null, linkedExists: false })).toBe('create');
  });

  test('confirmTarget: linked log that exists → update', () => {
    expect(confirmTarget({ linkedId: 'log-1', linkedExists: true })).toBe('update');
  });

  test('confirmTarget: linked id but the log was deleted → create (safe fallback)', () => {
    expect(confirmTarget({ linkedId: 'log-1', linkedExists: false })).toBe('create');
  });

  test('confirmTarget: empty id never counts as a link', () => {
    expect(confirmTarget({ linkedId: '', linkedExists: true })).toBe('create');
  });

  // ── setForDay: a re-confirm can move the log to a different day ────────────────
  test('setForDay: changes today → tomorrow without touching history', () => {
    const log = createLog({ id: 'log-1', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1 });
    const moved = setForDay(log, 'tomorrow');
    expect(moved.forDay).toBe('tomorrow');
    expect(moved.versions.length).toBe(1); // history untouched
  });

  test('setForDay: an invalid day keeps the existing one', () => {
    const log = createLog({ id: 'log-1', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1 });
    expect(setForDay(log, 'someday').forDay).toBe('today');
  });

  test('setForDay: returns a NEW object, never mutates the input', () => {
    const log = createLog({ id: 'log-1', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1 });
    const moved = setForDay(log, 'tomorrow');
    expect(log.forDay).toBe('today'); // original unchanged
    expect(moved).not.toBe(log);
  });

  // ── origin: only manual logs are editable from the Log screen ──────────────────
  test('createLog: a manual log is tagged origin=manual', () => {
    const log = createLog({ id: 'log-1', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1, origin: 'manual' });
    expect(log.origin).toBe('manual');
  });

  test('createLog: a calculator log is tagged origin=calculator', () => {
    const log = createLog({ id: 'log-1', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1, origin: 'calculator' });
    expect(log.origin).toBe('calculator');
  });

  test('createLog: a missing or unknown origin defaults to calculator (not editable in the Log screen)', () => {
    const noOrigin = createLog({ id: 'a', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1 });
    const badOrigin = createLog({ id: 'b', dough: 'Focaccia', forDay: 'today', version: version('create'), createdAtMs: 1, origin: 'whatever' });
    expect(noOrigin.origin).toBe('calculator');
    expect(badOrigin.origin).toBe('calculator');
  });

  // ── The full re-confirm flow: update appends an 'edit' version + can move the day ──
  test('re-confirm: append an edit version then move the day, history preserved', () => {
    let log = createLog({ id: 'log-1', dough: 'Brioche', forDay: 'today', version: version('create'), createdAtMs: 1 });
    log = addVersion(log, version('edit'));
    log = setForDay(log, 'tomorrow');
    expect(log.versions.length).toBe(2);
    expect(latestVersion(log).kind).toBe('edit');
    expect(log.forDay).toBe('tomorrow');
    expect(log.versions[0].kind).toBe('create'); // the original create is still there
  });
});
