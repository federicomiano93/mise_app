// The lab's clock, worked out from ONE stored instant — the start — and never from a counter that ticks.
//
// ⚠️ A COUNTING INTERVAL IS NOT THE SOURCE OF TRUTH: a tablet whose screen turns off, a tab put in the background (browsers slow or
// stop its timers) and a reload would each lose seconds. The screen redraws on a timer only to REPAINT; every figure it paints is
// `now - startedAt`, so it is right the moment the page wakes up.

// Milliseconds since the start. A start in the future (the phone's clock was set back) counts as zero, never as a negative clock.
export function elapsedMs(startedAt: number | null, now: number): number {
  if (startedAt === null || !Number.isFinite(startedAt) || !Number.isFinite(now)) return 0;
  return Math.max(0, now - startedAt);
}

// «H:MM:SS», hours without a leading zero (a batch rarely lasts a day, and a clock that outgrows two digits still reads).
export function formatClock(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// The labour time «from the timer»: whole minutes, rounded to the nearest, never less than one (a batch is never 0 minutes of work).
export function timerMinutes(ms: number): number {
  const minutes = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : 0;
  return Math.max(1, minutes);
}
