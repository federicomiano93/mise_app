// retention-model.js — WHICH old records the nightly clean-up (retention.js) may delete.
//
// The owner's decision of 18 Nov 2026 (UK/EU GDPR: keep personal and technical data no longer
// than it is needed): client orders 2 years, staff order lists 13 months, fired reminders 7 days,
// finished label prints 30 days, push tokens of phones silent for 60 days. Device lines (90
// days), error reports (30 days) and usage lines (400 days) join them with the SAME periods the
// owner's manual prunes already use (scripts/read-devices.mjs, read-errors.mjs --prune,
// read-usage.mjs). Two differences, both towards keeping: an unreadable date is never deleted here
// (the scripts delete it), and usage is aged by `updatedAt` (the script reads the line's dayKey,
// which can only make a line look the same age or older).
//
// ⚠️ PURE ON PURPOSE: no Firebase import, and `now` is always handed in. Every decision that can
// delete somebody's record lives here, where the root suite (tests/retention-model.test.mjs)
// pins each boundary to the day without a database or a clock. The handler only reads, asks this
// file, deletes and logs.
//
// ⚠️ A RECORD WHOSE DATE CANNOT BE READ IS NEVER DELETED. Missing, the wrong type, malformed,
// not a finite number, or before 2020 (older than the app itself, so certainly a bug) all answer
// 'skip'. The owner's scripts treat an unreadable date as stale; this runs unattended every night,
// so it takes the opposite side: a record kept by mistake costs a few bytes, a record deleted by
// mistake is gone.
//
// ⚠️ A NEW FIRESTORE KIND under locations/{lid}/ is ONE MORE ENTRY in KINDS and one more switch in
// ENABLED, shipped off. Step 3 (the Auth accounts of people who left) is not a Firestore collection:
// it will join the same list and switch, the cap and the report-only logging, with a sweep of its
// own in the handler.

export const DAY_MS = 24 * 60 * 60 * 1000;

// Nothing in Mise is older than this. A date before it is a corrupt value, not an old record.
export const FLOOR_DAY = '2020-01-01';
export const FLOOR_MS = Date.UTC(2020, 0, 1);

// At most this many deletions per kind per night, across every venue. Reaching it stops that
// kind until the next night and logs an error: a bug in a cutoff must not be able to empty a
// collection in one run. Real volumes are far below it (a handful of venues).
export const CAP = 500;

// A Firestore batch holds at most 500 writes.
export const BATCH_SIZE = 500;

// The day calendar the owner lives in. «Two years ago today» is counted on HIS calendar, not
// UTC's: between midnight and 1am in summer they differ by a day.
export const VENUE_TIME_ZONE = 'Europe/London';

// What each kind is, field by field. `type` says how the key field is stored:
//   'day'       'YYYY-MM-DD' string (a calendar day, no time) — kept for N calendar months
//   'millis'    a number of milliseconds since 1970 (Date.now())
//   'iso'       an ISO 8601 string with a time and a zone ('2026-10-01T09:00:00.000Z')
//   'timestamp' a Firestore Timestamp (server time)
// `statuses`, when present, is the only `status` values that may be deleted at all.
export const KINDS = Object.freeze([
  Object.freeze({ kind: 'clientOrders', collection: 'client-orders', field: 'date', type: 'day', keepMonths: 24 }),
  Object.freeze({ kind: 'orderRequests', collection: 'order-requests', field: 'date', type: 'day', keepMonths: 13 }),
  // Active or cancelled alike: a reminder a week past its time can neither ring nor be cancelled.
  Object.freeze({ kind: 'pushTimers', collection: 'push-timers', field: 'fireAt', type: 'millis', keepDays: 7 }),
  // ⚠️ ONLY A FINISHED JOB. A queued or claimed one is a label somebody is still waiting for (or
  // a print agent mid-job); deleting it would make it vanish without a word, however old it is.
  Object.freeze({
    kind: 'printJobs', collection: 'print-jobs', field: 'createdAt', type: 'iso', keepDays: 30,
    statuses: Object.freeze(['done', 'failed']),
  }),
  // A phone not heard from in 60 days. Mise 2 refreshes `updatedAt` weekly while the phone is used
  // (app/src/orders/pushTokenRefresh.ts) — but only from the day this ships, and only for a phone
  // whose token records its owner. See the warning on ENABLED.fcmTokens before switching it on.
  Object.freeze({ kind: 'fcmTokens', collection: 'fcm-tokens', field: 'updatedAt', type: 'millis', keepDays: 60 }),
  Object.freeze({ kind: 'devices', collection: 'devices', field: 'lastSeen', type: 'timestamp', keepDays: 90 }),
  Object.freeze({ kind: 'errors', collection: 'errors', field: 'createdAt', type: 'timestamp', keepDays: 30 }),
  Object.freeze({ kind: 'usage', collection: 'usage', field: 'updatedAt', type: 'timestamp', keepDays: 400 }),
]);

// ⚠️⚠️ THE SWITCH. Every kind ships OFF: the function still runs every night, queries and logs
// `{ kind, wouldDelete, skipped }`, and deletes nothing. The owner reads the first week of those
// lines in production, then switches kinds on one by one with a one-line PR here (plus its pin
// in tests/retention-model.test.mjs, which fails until it is changed on purpose).
export const ENABLED = Object.freeze({
  clientOrders: false,
  orderRequests: false,
  pushTimers: false,
  printJobs: false,
  // ⚠️⚠️ NOT BEFORE 60 DAYS OF THE TOKEN REFRESH IN PRODUCTION. Until this branch, nothing wrote
  // `updatedAt` after the tap that turned notifications on (js/push.js rememberToken; a timer
  // re-writes it only when the stored owner differs), so on day one the report counts phones used
  // every day as «would delete». Switched on early, they lose their order alerts while their switch
  // still says «on». A phone with no `push-token-uid` (registered before 23 Sep 2026 and never
  // since) is never refreshed at all: read its count in the report before switching this on.
  fcmTokens: false,
  devices: false,
  errors: false,
  usage: false,
});

const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
// The shape Date.prototype.toISOString() writes, plus an explicit offset: nothing looser.
const ISO_SHAPE = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/;

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// A real calendar day written as 'YYYY-MM-DD', or null. The regex alone would let '2026-02-30'
// and '2026-13-01' through, and Date.parse quietly rolls the first over into March.
export function parseDay(value) {
  if (typeof value !== 'string') return null;
  const m = DAY_SHAPE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
}

// Milliseconds of a strict ISO 8601 string, or null.
export function parseIso(value) {
  if (typeof value !== 'string') return null;
  const m = ISO_SHAPE.exec(value);
  if (!m || !parseDay(m[1])) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

// Milliseconds of a Firestore Timestamp, or null. Recognised by its shape, so this file needs no
// Firebase import: the Admin SDK's Timestamp has toMillis(), and nothing else stored here does.
export function timestampMillis(value) {
  if (!value || typeof value !== 'object' || typeof value.toMillis !== 'function') return null;
  const ms = value.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

// Today on the owner's calendar, as 'YYYY-MM-DD'.
export function londonDay(now) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// The same day `months` calendar months earlier. A day the earlier month does not have becomes
// that month's last day (29 Feb two years back is 28 Feb), so the cutoff never rolls FORWARD
// into the next month and deletes a day early.
export function monthsBefore(day, months) {
  const d = parseDay(day);
  if (!d) throw new Error('monthsBefore needs a YYYY-MM-DD day');
  const index = d.year * 12 + (d.month - 1) - months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return `${pad(year, 4)}-${pad(month)}-${pad(Math.min(d.day, daysInMonth(year, month)))}`;
}

// The value the handler's query compares against (`field < cutoff`), in the field's own type —
// a range filter only matches values of the SAME type, so a number cutoff never returns a string.
// For 'timestamp' it is milliseconds; the handler turns it into a Timestamp.
export function cutoffFor(spec, now) {
  if (!Number.isFinite(now)) throw new Error('cutoffFor needs a finite now');
  if (spec.type === 'day') return monthsBefore(londonDay(now), spec.keepMonths);
  const ms = now - spec.keepDays * DAY_MS;
  return spec.type === 'iso' ? new Date(ms).toISOString() : ms;
}

// The verdict for ONE document: 'delete', 'keep' or 'skip' (its date cannot be trusted).
// The query already returned only documents below the cutoff; this checks again from scratch,
// so a query that ever returned too much (a wrong operator, an offset string comparing oddly)
// still deletes nothing it should not.
export function decide(spec, data, now) {
  if (!data || typeof data !== 'object') return 'skip';
  const value = data[spec.field];
  const cutoff = cutoffFor(spec, now);

  let old;
  if (spec.type === 'day') {
    if (!parseDay(value) || value < FLOOR_DAY) return 'skip';
    old = value < cutoff;
  } else {
    let ms = null;
    if (spec.type === 'millis') ms = typeof value === 'number' && Number.isFinite(value) ? value : null;
    else if (spec.type === 'iso') ms = parseIso(value);
    else if (spec.type === 'timestamp') ms = timestampMillis(value);
    if (ms === null || ms < FLOOR_MS) return 'skip';
    old = ms < (spec.type === 'iso' ? Date.parse(cutoff) : cutoff);
  }
  if (!old) return 'keep';
  if (spec.statuses && !spec.statuses.includes(data.status)) return 'keep';
  return 'delete';
}

// Splits a list into batches no bigger than Firestore allows.
export function chunks(list, size = BATCH_SIZE) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
