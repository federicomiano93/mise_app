// memo.js — remember the LAST answer of a pure function, keyed by its arguments. PURE.
//
// The Orders page asks for the same derived lists (the supplier lens, the cards grouped by
// supplier, the supplier list) many times for ONE keystroke, and every ask used to rebuild
// them from scratch. This answers a repeat ask with the SAME object — so callers must treat
// the result as read-only — for as long as every argument is the same reference/value.
//
// ⚠️ THE KEY IS THE INPUTS THEMSELVES, never a flag somebody has to remember to set: a
// change that forgets to say «I changed something» would leave a stale list on a screen
// that drives real orders. Arguments are compared with ===, so an input that is mutated in
// place must be passed as a value that changes with it (a signature string, a counter).
export function memoLast(compute) {
  let lastArgs = null;
  let lastValue;
  return (...args) => {
    if (lastArgs && lastArgs.length === args.length && args.every((a, i) => a === lastArgs[i])) {
      return lastValue;
    }
    lastValue = compute(...args);
    lastArgs = args;
    return lastValue;
  };
}
