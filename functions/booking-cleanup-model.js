// booking-cleanup-model.js — the 30-day deletion of customer bookings (18 Nov 2026), the part that can be tested.
//
// ⚠️ PERSONAL DATA (UK/EU GDPR). A booking holds a customer's name, phone and, for a delivery, address. The owner's decision:
// it is deleted 30 days after its day («cancellati 30 giorni dopo il ritiro», the line printed on the customer's slip). This is
// what keeps that promise: once a day, every booking of every venue whose `date` is MORE than 30 days in the past is deleted.
//
// ⚠️ It holds no Firebase import on purpose, like recipe-photo-model.js: the shell (functions/index.js, deleteOldBookings) is
// loaded only where firebase-functions is installed, and what cannot be loaded cannot be tested. The shell hands in two
// functions — read a page of old bookings, delete a page — and this file decides the rest.
//
// ⚠️ NOTHING PERSONAL IS EVER LOGGED OR RETURNED: only the cut-off day and counts.

// The owner's retention, in days after the booking's own day.
export const KEEP_DAYS = 30;

// A Firestore batch takes at most 500 writes; a page well under it.
export const BATCH_SIZE = 400;

// The most pages one run deletes. 50 × 400 = 20 000 bookings a day is far past any real venue; a run that hits it says so
// (`more: true`) and the next day's run carries on, so a bad day can never run the function out of time.
export const MAX_ROUNDS = 50;

// The venues are in Italy and the UK; the day is read in Rome. An hour's difference for a UK venue cannot move a booking across
// the line by more than that hour, a day after the 30 days are already over.
export const TIME_ZONE = 'Europe/Rome';

const DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// Today's date in the venues' zone, as YYYY-MM-DD.
export function todayIn(now, timeZone = TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = type => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

// The first day that is KEPT: a booking dated before it is more than KEEP_DAYS days in the past. Plain calendar arithmetic
// on the date (UTC noon, so no clock change can move it).
export function cutoffDate(now, keepDays = KEEP_DAYS, timeZone = TIME_ZONE) {
  const today = todayIn(now, timeZone);
  const [y, m, d] = today.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12));
  day.setUTCDate(day.getUTCDate() - keepDays);
  return day.toISOString().slice(0, 10);
}

// Only a booking of a venue is ever deleted: `locations/{lid}/bookings/{id}`. A collection-group query would also find a
// `bookings` collection anywhere else in the database, should one ever be made; this keeps the function to its own.
export function isVenueBooking(path) {
  return typeof path === 'string' && /^locations\/[^/]+\/bookings\/[^/]+$/.test(path);
}

// Deletes, page by page, every venue booking dated before the cut-off.
//
//   store.oldBookings(cutoff, limit) → a page of { path, date } (date < cutoff), at most `limit`
//   store.deleteAll(items)          → deletes that page, in one batch
//
// Returns { cutoff, deleted, rounds, more, skipped } — counts only.
export async function deleteOldBookings(store, { now = new Date(), batchSize = BATCH_SIZE, maxRounds = MAX_ROUNDS } = {}) {
  const cutoff = cutoffDate(now);
  let deleted = 0;
  let skipped = 0;
  let rounds = 0;
  let more = false;
  for (;;) {
    if (rounds >= maxRounds) {
      more = true;
      break;
    }
    const page = await store.oldBookings(cutoff, batchSize);
    if (!Array.isArray(page) || page.length === 0) break;
    rounds += 1;
    // ⚠️ Asked again here, not trusted from the query: a wrong query must never delete a booking that is still inside its 30 days.
    const doomed = page.filter(item => isVenueBooking(item?.path) && typeof item.date === 'string' && DAY_RE.test(item.date) && item.date < cutoff);
    skipped += page.length - doomed.length;
    if (doomed.length > 0) {
      await store.deleteAll(doomed);
      deleted += doomed.length;
    }
    // A short page is the last one. A page with nothing to delete would come back the same next time: stop rather than loop.
    if (page.length < batchSize || doomed.length === 0) break;
  }
  return { cutoff, deleted, rounds, more, skipped };
}
