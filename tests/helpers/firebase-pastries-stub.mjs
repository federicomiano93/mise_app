// firebase-pastries-stub.mjs — stands in for js/pastries/firebase-pastries.js when a test executes
// the Pastries stores or the page itself (tests/helpers/load-pastries.mjs). The real module loads the
// Firebase SDK from a CDN, which node cannot, and a unit test must never reach a database.
//
// Nothing answers by itself: every watch is recorded in `control`, and the test decides when (and
// whether) each one answers — which is the whole point, since the defect it pins lived in the
// second before the first answer.

export const control = {
  days: [],            // { onChange, onError, stopped } per watchPastryDays
  dates: [],           // { date, onChange, onError, stopped } per watchPastryLogsForDate
  saves: [],           // { day, items, note } per savePastryDay
  records: [],         // ids written by confirmPastryLog
  failDaysStart: false,
  failDatesStart: false,
};

export const authReady = Promise.resolve();

export async function watchPastryDays(onChange, onError) {
  if (control.failDaysStart) throw new Error('watch refused');
  const watch = { onChange, onError, stopped: false };
  control.days.push(watch);
  return () => { watch.stopped = true; };
}

export async function savePastryDay(day, items, note = '') {
  control.saves.push({ day, items, note });
}

export async function watchPastryLogs() {
  return () => {};
}

export async function watchPastryLogsForDate(date, onChange, onError) {
  if (control.failDatesStart) throw new Error('watch refused');
  const watch = { date, onChange, onError, stopped: false };
  control.dates.push(watch);
  return () => { watch.stopped = true; };
}

export async function getPastryLog() {
  return null;
}

export async function confirmPastryLog(id, build) {
  control.records.push(id);
  return build(null);
}

export async function deletePastryLog() {}
