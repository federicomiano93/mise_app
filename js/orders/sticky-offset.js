// sticky-offset.js — tells the stylesheet how tall the sticky tab head is.
//
// The flat «Ingredients» list carries its own sticky Order / Stock header, and it has
// to stick BELOW `.order-box-head` (the sticky tabs), not underneath it. That head is
// not a fixed height: it is taller on a tablet (tap-min tabs), and it grows or shrinks
// when the view switch is shown or hidden. So the height is measured, once, here, and
// handed to CSS as `--order-head-h` on <body>; orders.css reads
// `top: var(--order-head-h, 0px)`.
//
// The «per ingrediente» view pins a second bar under the tabs (the search row and the
// filter pills, `.ing-sticky-head`); its height is measured the same way into
// `--order-search-h`, and the Order / Stock header sticks under BOTH. Never a pixel guess:
// the bar changes height with the screen size and when the filter pills are hidden.

export function trackStickyHead(head, root = document.body, property = '--order-head-h') {
  if (!head) return null;
  const write = () => root.style.setProperty(property, `${head.offsetHeight}px`);
  write();
  if (typeof ResizeObserver !== 'function') return null;
  const observer = new ResizeObserver(write);
  observer.observe(head);
  return observer;
}

// A pinned header that is REBUILT on every repaint (the Order / Stock header of the flat
// list is drawn again with each snapshot), so one observer is re-pointed at whichever node
// is current. `watch(null)` and `stop()` both leave the variable at 0 — no list, no offset.
export function trackSwappableHead(property, root = document.body) {
  let observer = null;
  const reset = () => root.style.setProperty(property, '0px');
  return {
    watch(node) {
      observer?.disconnect();
      observer = null;
      if (!node) { reset(); return; }
      const write = () => root.style.setProperty(property, `${node.offsetHeight}px`);
      write();
      if (typeof ResizeObserver !== 'function') return;
      observer = new ResizeObserver(write);
      observer.observe(node);
    },
    stop() {
      observer?.disconnect();
      observer = null;
      reset();
    },
  };
}
