// tablet.js — «is this a tablet?» for Pastries, and a way to hear when that changes (a
// rotation, a resized window). Used for one thing only: the day strip tells assistive
// technology whether it is a row (phone) or a column (tablet), so Up/Down and Left/Right
// are announced as what they do. The layout itself is CSS alone.
//
// A deliberate, tiny COPY of the pattern in js/orders/tablet-layout.js: a feature never
// imports from another feature's folder, and this is all Pastries needs of it.
//
// ⚠️ ONE QUERY, THE SAME TEXT tokens.css and orders.css carry —
// tests/pastries-tablet.test.mjs fails the moment this copy drifts.
// Built from two halves for the reason given in tablet-layout.js: written whole it reads
// as English prose to tests/nothing-stays-english.test.mjs.
const MIN_WIDTH = '(min-width: 900px)';
const MIN_HEIGHT = '(min-height: 600px)';
export const TABLET_QUERY = `${MIN_WIDTH} and ${MIN_HEIGHT}`;

export function isTabletNow() {
  return window.matchMedia(TABLET_QUERY).matches;
}

// `onChange(isTablet)` on every crossing of the width. NOT called once immediately: the
// caller paints its first state itself with isTabletNow().
export function watchTablet(onChange) {
  const mq = window.matchMedia(TABLET_QUERY);
  const apply = () => onChange(mq.matches);
  // Safari < 14 only has the older addListener form.
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else mq.addListener(apply);
}
