// same-data.ts — are two documents' data the same, whatever order their keys came in?
//
// TypeScript port of js/same-data.js for Mise 2; same-data.spec.ts runs every test against both.
//
// ⚠️ IT DECIDES WHETHER A PAGE RELOADS. The session answers from this phone's copy and asks the
// server behind it; a "different" here reloads the app. A comparison that called two equal
// documents different would reload on every opening — which is why it compares by value and
// never by the order keys arrived in, and why the session also brakes reloads to one every 30 s.

export function sameData(a: unknown, b: unknown): boolean {
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
}

function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const record = v as Record<string, unknown>;
    return Object.keys(record).sort().reduce<Record<string, unknown>>((o, k) => { o[k] = canon(record[k]); return o; }, {});
  }
  return v;
}
