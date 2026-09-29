// sticky-offset.js — tells the stylesheet how tall the sticky tab head is.
//
// The flat «Ingredients» list carries its own sticky Order / Stock header, and it has
// to stick BELOW `.order-box-head` (the sticky tabs), not underneath it. That head is
// not a fixed height: it is taller on a tablet (tap-min tabs), and it grows or shrinks
// when the view switch is shown or hidden. So the height is measured, once, here, and
// handed to CSS as `--order-head-h` on <body>; orders.css reads
// `top: var(--order-head-h, 0px)`.

export function trackStickyHead(head, root = document.body) {
  if (!head) return null;
  const write = () => root.style.setProperty('--order-head-h', `${head.offsetHeight}px`);
  write();
  if (typeof ResizeObserver !== 'function') return null;
  const observer = new ResizeObserver(write);
  observer.observe(head);
  return observer;
}
