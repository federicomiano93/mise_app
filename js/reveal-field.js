// reveal-field.js — bring a field that failed validation into view and put the cursor in it.
//
// P20: «block, jump to and highlight the empty one». With Save in the green header (not at
// the bottom of the form) the person taps Save from the top of a long form, so the field
// that is wrong can be far off screen. Highlighting alone would then look like «nothing
// happened». This scrolls the nearest scrolling ancestor (whichever screen's scroller it
// is — scrollIntoView finds it) to centre the field, then focuses it WITHOUT letting the
// browser scroll again. Centred, so it can never sit under an edge. Smooth, unless the
// person asked for reduced motion.

export function revealField(node) {
  if (!node) return;
  let reduce = false;
  try { reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { /* default: animate */ }
  try {
    node.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  } catch (e) { /* scrolling is best-effort */ }
  try { node.focus({ preventScroll: true }); } catch (e) { /* focus is best-effort */ }
}
