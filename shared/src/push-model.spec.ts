// The scheduling decisions, which the app and the server BOTH read — run against BOTH
// implementations: the TypeScript port in shared/ and the js/ file the live app uses today.
// Ported from tests/push-model.test.mjs; the two must stay equal until the switch to Mise 2.
//
// The one that matters most is `isStillDue`: it is the only thing standing between
// the owner and a phone that buzzes for a step finished ten minutes ago — and an
// alarm that goes off for nothing is the fastest way to get notifications turned
// off for good, taking the useful ones with it.

import { describe, expect, test } from 'vitest';
import * as ported from './push-model';
import * as legacyJs from '../../js/push-model.js';

const legacy = legacyJs as unknown as typeof ported;

const NOW = 1_700_000_000_000;

const due = (over: Record<string, unknown> = {}) => ({ active: true, fireAt: NOW, ...over });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── Scheduling ────────────────────────────────────────────────────────────────

  test('an alarm far enough ahead is scheduled', () => {
    expect(m.isSchedulable(NOW + 20 * 60 * 1000, NOW)).toBe(true);
    expect(m.isSchedulable(NOW + m.MIN_AHEAD_MS, NOW)).toBe(true);
    expect(m.isSchedulable(NOW + m.MAX_AHEAD_MS, NOW)).toBe(true);
  });

  test('a timer too short to beat the delivery is NOT scheduled', () => {
    // Enqueueing and delivering take seconds between them, so a push for a
    // 10-second timer would arrive after the app's own alarm had already sounded.
    expect(m.isSchedulable(NOW + 10 * 1000, NOW)).toBe(false);
    expect(m.isSchedulable(NOW + m.MIN_AHEAD_MS - 1, NOW)).toBe(false);
  });

  test('an alarm in the past, or absurdly far ahead, is refused', () => {
    expect(m.isSchedulable(NOW - 1000, NOW)).toBe(false);
    expect(m.isSchedulable(NOW, NOW)).toBe(false);
    expect(m.isSchedulable(NOW + m.MAX_AHEAD_MS + 1, NOW)).toBe(false);
  });

  test('junk never schedules anything', () => {
    for (const bad of [null, undefined, NaN, 'soon', {}, Infinity, -Infinity]) {
      expect(m.isSchedulable(bad, NOW), `${String(bad)} was schedulable`).toBe(false);
    }
    expect(m.isSchedulable(NOW + 60000, 'x')).toBe(false);
  });

  test('the document written is exactly what the server needs, and is trimmed', () => {
    const doc = m.buildTimerDoc({
      uid: '  u1  ', token: ' tok ', fireAt: NOW + 60000,
      title: '  Croissant  ', body: '  Add the butter  ', nowMs: NOW,
    });
    expect(doc).toStrictEqual({
      uid: 'u1', token: 'tok', fireAt: NOW + 60000,
      title: 'Croissant', body: 'Add the butter',
      active: true, createdAt: NOW,
    });
  });

  test('a document built from junk holds zeros and blanks, never NaN', () => {
    const doc = m.buildTimerDoc({});
    expect(doc.fireAt).toBe(0);
    expect(doc.createdAt).toBe(0);
    expect(doc.title).toBe('');
    expect(Number.isNaN(doc.fireAt)).toBe(false);
    expect(m.isValidTimerDoc(doc, NOW)).toBe(false);
  });

  test('long text is cut rather than sent whole', () => {
    const doc = m.buildTimerDoc({ title: 'x'.repeat(300), body: 'y'.repeat(400), nowMs: NOW });
    expect(doc.title.length).toBe(m.MAX_TITLE);
    expect(doc.body.length).toBe(m.MAX_BODY);
  });

  test('a timer with nowhere to send it, or nothing to say, is not valid', () => {
    const base = { uid: 'u1', token: 'tok', fireAt: NOW + 60000, title: 'Croissant', nowMs: NOW };
    expect(m.isValidTimerDoc(m.buildTimerDoc(base), NOW)).toBe(true);
    expect(m.isValidTimerDoc(m.buildTimerDoc({ ...base, token: '' }), NOW)).toBe(false);
    expect(m.isValidTimerDoc(m.buildTimerDoc({ ...base, uid: '' }), NOW)).toBe(false);
    expect(m.isValidTimerDoc(m.buildTimerDoc({ ...base, title: '   ' }), NOW)).toBe(false);
    expect(m.isValidTimerDoc(null, NOW)).toBe(false);
  });

  // ── The check that stops a phone buzzing for nothing ──────────────────────────

  test('an alarm due right now, still wanted, is sent', () => {
    expect(m.isStillDue(due(), NOW)).toBe(true);
  });

  test('A CANCELLED ALARM IS NEVER SENT', () => {
    // Somebody tapped Done, Skip, or left the mix. This single flag is the whole
    // cancellation mechanism, and it is read an instant before sending precisely
    // because deleting a queued job can fail quietly and this cannot.
    expect(m.isStillDue(due({ active: false }), NOW)).toBe(false);
    expect(m.isStillDue(due({ active: undefined }), NOW)).toBe(false);
    expect(m.isStillDue(due({ active: 'true' }), NOW), 'only a real boolean counts').toBe(false);
  });

  test('AN ALARM THAT IS VERY LATE IS DROPPED, not sent', () => {
    // "Add the butter" an hour after the dough was finished is worse than silence.
    expect(m.isStillDue(due(), NOW + m.MAX_LATE_MS)).toBe(true);
    expect(m.isStillDue(due(), NOW + m.MAX_LATE_MS + 1)).toBe(false);
    expect(m.isStillDue(due(), NOW + 60 * 60 * 1000)).toBe(false);
  });

  test('an alarm that fires EARLY is not sent either', () => {
    // A queue retry or a clock skew. Ringing before the dough is ready is its own
    // kind of wrong, and silently accepting it would hide the real problem.
    expect(m.isStillDue(due(), NOW - 1)).toBe(false);
    expect(m.isStillDue(due(), NOW - 60000)).toBe(false);
  });

  test('a missing or junk timer is never sent', () => {
    expect(m.isStillDue(null, NOW)).toBe(false);
    expect(m.isStillDue(undefined, NOW)).toBe(false);
    expect(m.isStillDue({}, NOW)).toBe(false);
    expect(m.isStillDue(due({ fireAt: 'x' }), NOW)).toBe(false);
  });

  test('every skip says WHY, so a quiet phone is never a mystery', () => {
    expect(m.skipReason(due(), NOW), 'a valid send has no reason').toBe('');
    expect(m.skipReason(null, NOW)).toMatch(/no such timer/);
    expect(m.skipReason(due({ active: false }), NOW)).toMatch(/cancelled/);
    expect(m.skipReason(due(), NOW - 5000)).toMatch(/5s early/);
    expect(m.skipReason(due(), NOW + 30 * 60 * 1000)).toMatch(/30 minutes late/);
  });

  // ── What the phone shows ──────────────────────────────────────────────────────

  test('a notification is never blank and never says undefined', () => {
    // It is read on a lock screen with no context around it.
    expect(m.timerNotification({ title: 'Croissant', body: 'Add the butter' }))
      .toStrictEqual({ title: 'Croissant', body: 'Add the butter' });
    const empty = m.timerNotification({});
    expect(empty.title.length > 0 && empty.body.length > 0).toBeTruthy();
    expect(/undefined|null|NaN/.test(empty.title + empty.body)).toBe(false);
    const junk = m.timerNotification(null);
    expect(/undefined|null|NaN/.test(junk.title + junk.body)).toBe(false);
  });

  test('an order notification names who it is from', () => {
    // Fake names: this repo is public, so no real client appears in a test.
    const n = m.orderNotification({ clientName: 'Bar Centrale', date: '2026-08-12' });
    expect(n.title).toMatch(/Bar Centrale/);
    expect(n.body).toMatch(/2026-08-12/);
  });

  test('…and still says something useful when the name is missing', () => {
    const n = m.orderNotification({});
    expect(n.title.length > 0 && n.body.length > 0).toBeTruthy();
    expect(/undefined|null/.test(n.title + n.body)).toBe(false);
    expect(/undefined|null/.test(m.orderNotification(null).title)).toBe(false);
  });

  test('a tap lands on the screen that answers the notification', () => {
    expect(m.targetPage('timer')).toMatch(/catalogue/);
    expect(m.targetPage('order')).toMatch(/calculator/);
    expect(m.targetPage('orderRequest')).toMatch(/orders/);
    expect(m.targetPage('nonsense'), 'an unknown kind still opens somewhere').toMatch(/catalogue/);
  });

  test('one notification per thing, so a re-delivery replaces rather than stacks', () => {
    expect(m.notificationTag('timer', 'abc')).toBe('timer-abc');
    expect(m.notificationTag('order', '2026-08-12_c1')).toBe('order-2026-08-12_c1');
    expect(m.notificationTag('nonsense', 'abc')).toBe('timer-abc');
    expect(m.notificationTag('timer', '')).toBe('timer-x');
    expect(m.notificationTag('timer', null)).toBe('timer-x');
  });

  test('the kinds are a closed list', () => {
    expect([...m.PUSH_KINDS]).toStrictEqual(['timer', 'order', 'orderRequest']);
  });

  // ── An order list somebody sent ──────────────────────────────────────────────

  test('the list notification names WHO is waiting, and how much there is', () => {
    const n = m.orderRequestNotification({ fromName: 'Marco Rossi', quantities: { a: 1, b: 2 } });
    expect(n.title).toMatch(/Marco Rossi/);
    expect(n.body).toMatch(/2/);
  });

  test('a list with no name still says something a person can act on', () => {
    const n = m.orderRequestNotification({ quantities: { a: 1 } });
    expect(/undefined|null/.test(n.title + n.body)).toBe(false);
    expect(n.title.length > 0 && n.body.length > 0).toBeTruthy();
    const junk = m.orderRequestNotification(null);
    expect(/undefined|null/.test(junk.title + junk.body)).toBe(false);
    expect(junk.body.length > 0).toBeTruthy();
  });

  // ⚠️ THE ONE THIS FILE EXISTS FOR SINCE THE APP SPEAKS TWO LANGUAGES. A
  // notification is written when nobody is looking at the app, so the page that
  // knows the language cannot build it — the server has to, and until this release
  // every notification was English in both languages.
  test('the notifications are written in the venue’s language', () => {
    const it = m.orderRequestNotification({ fromName: 'Marco', quantities: { a: 1, b: 2 } }, 'it');
    const en = m.orderRequestNotification({ fromName: 'Marco', quantities: { a: 1, b: 2 } }, 'en');
    expect(it.title).not.toBe(en.title);
    expect(it.body).toMatch(/articoli/);
    expect(en.body).toMatch(/items/);

    expect(m.orderNotification({ clientName: 'Bar Centrale', date: '2026-08-12' }, 'it').title).toMatch(/Nuovo ordine/);
    expect(m.timerNotification({}, 'it').body).toMatch(/Tempo scaduto/);
  });

  test('Italian gets a real singular, not "1 articoli"', () => {
    expect(m.orderRequestNotification({ fromName: 'M', quantities: { a: 1 } }, 'it').body).toMatch(/1 articolo da ordinare/);
    expect(m.orderRequestNotification({ fromName: 'M', quantities: { a: 1 } }, 'en').body).toMatch(/1 item/);
  });

  // ⚠️ A LANGUAGE NOBODY RECOGNISES MUST NOT PRODUCE A BLANK LOCK SCREEN. A venue
  // that has never chosen one, or one a future version writes, still gets words.
  test('an unknown language falls back to English rather than to nothing', () => {
    const n = m.orderRequestNotification({ fromName: 'Marco', quantities: { a: 1 } }, 'zz');
    expect(n.body).toMatch(/item/);
    expect(m.timerNotification({}, undefined).body.length > 0).toBeTruthy();
  });
});
