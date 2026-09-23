// same-data.js — are two documents' data the same, whatever order their keys came in?
// PURE, zero imports, asserted under Node (tests/session-from-cache.test.mjs).
//
// ⚠️ IT DECIDES WHETHER A PAGE RELOADS. js/firebase.js answers the session from this
// phone's copy and asks the server behind it; a "different" here reloads the page. So
// a comparison that called two equal documents different would reload on every
// opening — which is why it compares by value and never by the order keys arrived in,
// and why firebase.js also brakes reloads to one every 30 seconds.

export function sameData(a, b) {
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
}

function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.keys(v).sort().reduce((o, k) => { o[k] = canon(v[k]); return o; }, {});
  }
  return v;
}
