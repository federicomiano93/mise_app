// result-place.js — where a recipe's result block sits inside its panel.
// Pure DOM, no imports: js/calc.js owns the state, this only moves one node (and is testable
// without Firebase).
//
// ⚠️ WHERE THE RESULT SITS FOLLOWS WHETHER IT IS SHOWN (4 Oct 2026). Once a dough is confirmed
// the recipe is what somebody came for, so it is the FIRST thing in the panel and the
// quantities, Edit and Reset follow it. Before that it stays after the entries (hidden anyway).
// The node is MOVED in the DOM rather than reordered with CSS `order`, so the keyboard and
// screen-reader order are the visual order (P18). A no-op when it is already in place, so a
// keystroke's recalculation never touches the DOM.
export function placeResult(block, onTop) {
  const panel = block.parentNode;
  if (!panel) return;
  const kids = [...panel.children];
  if (onTop) {
    const first = kids.find(c => !c.classList.contains('tab-cleared-note'));
    if (first && first !== block) panel.insertBefore(block, first);
  } else {
    const reset = kids.find(c => c.classList.contains('reset-btn'));
    if (reset && kids.indexOf(block) !== kids.indexOf(reset) - 1) panel.insertBefore(block, reset);
  }
}

