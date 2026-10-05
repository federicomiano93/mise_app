// py-compat.js — the few places where JavaScript and the Python script (invoice-import/) disagree, written
// once so the ports read the same as the originals. Pure.

// Python's `\b`, `\w` and `\W` know accented letters («è» is a word character); JavaScript's `\b` does not,
// even with the `u` flag. These two stand for `\b` in front of a word / after a word. Every `\b` in the
// Python patterns sits next to a word character on one side, so the pair covers them all.
export const WORD = '[\\p{L}\\p{N}_]';
export const B_START = `(?<!${WORD})`;
export const B_END = `(?!${WORD})`;

// re.escape() for a literal inside a `u`-flag pattern.
export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

// str.strip(chars)
export function stripChars(text, chars) {
  let start = 0;
  let end = text.length;
  while (start < end && chars.includes(text[start])) start += 1;
  while (end > start && chars.includes(text[end - 1])) end -= 1;
  return text.slice(start, end);
}

// float(s) for the shapes an invoice holds: a decimal with an optional exponent. Python also accepts
// «inf», «nan» and «1_000»; none can be a real quantity or price, so those are None (null) here.
const PY_FLOAT_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function pyFloat(text) {
  const s = String(text ?? '').trim();
  if (!PY_FLOAT_RE.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Python 3.12+ sum() of floats: Neumaier compensated summation, so the same list gives the same last digit.
export function pySum(values) {
  let result = 0;
  let c = 0;
  for (const x of values) {
    const t = result + x;
    if (Math.abs(result) >= Math.abs(x)) c += (result - t) + x;
    else c += (x - t) + result;
    result = t;
  }
  if (c !== 0 && Number.isFinite(c)) result += c;
  return result;
}

// Decimal(repr(x)).quantize(10**-places, ROUND_HALF_UP) -> float. Rounds the SHORTEST decimal that reads back
// as x (what repr gives), ties away from zero, never the binary value — which is what toFixed would round.
export function roundHalfUp(x, places) {
  if (!Number.isFinite(x)) return x;
  const negative = x < 0 || Object.is(x, -0);
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(Math.abs(x)));
  const intPart = m[1];
  const frac = m[2] || '';
  const exponent = m[3] ? Number(m[3]) : 0;
  const digits = BigInt(intPart + frac);
  const shift = places - (frac.length - exponent);
  let q;
  if (shift >= 0) {
    q = digits * 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    q = digits / divisor;
    if ((digits % divisor) * 2n >= divisor) q += 1n;
  }
  const value = Number(`${q}e-${places}`);
  return negative ? -value : value;
}
