// guard.js — keeps one screen's bug from breaking the data underneath it.
//
// A store calls the screen's refresh function from inside its live Firestore listener
// and, for a local-first save, BEFORE the network write. A throw from that refresh used
// to escape into the store: the listener callback died half-way, and a save could stop
// before it ever reached the database (catalogue-store.js upsertLocal runs ahead of
// saveRecipeDoc). The screen is drawn from the data, never the other way round — so a
// refresh that fails is reported and the store carries on.
//
// The report is console.error: js/error-report.js records every one, so the failure is
// counted instead of vanishing. Imports nothing, so any module can use it.

// Returns fn wrapped so a throw is logged as «<label> failed:» and answered with
// undefined. Anything that is not a function gives null — the shape the stores already
// test for with `if (notify)`.
export function guarded(label, fn) {
  if (typeof fn !== 'function') return null;
  return function guardedCall(...args) {
    try {
      return fn.apply(this, args);
    } catch (err) {
      console.error(`${label} failed:`, err);
      return undefined;
    }
  };
}
