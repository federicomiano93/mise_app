// calculator-icons.js — the Calculator's inline SVG icons.
//
// Why this exists: the Calculator used EMOJI as icons (🗑 🕘 📅 ✎) and text arrows
// (→ ←) while Orders and the Catalogue drew clean inline SVGs. Emoji are a font,
// not artwork: they render differently on every OS (colourful and cartoonish on
// one, flat and grey on another), ignore currentColor, and cannot be sized or
// aligned to the surrounding text — which is exactly what made the app look
// improvised next to its own other screens.
//
// Built with createElementNS, NOT innerHTML: this feature's DOM helper (el) never
// parses HTML strings, and the CSP is strict. The icons inherit `currentColor`, so
// a button's own colour (including :hover and the danger red) drives them for free.
//
// Same drawing convention as the rest of the app (Orders/Catalogue): a 24×24 box,
// stroked, 2px, round caps and joins — so an icon lifted from here and one from
// there sit side by side without looking like two different sets.

import { SEND_PATHS } from './send-icon.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

// Each entry is the list of <path> shapes that make the icon.
const PATHS = {
  trash: ['M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6'],                 // matches the Catalogue's
  clock: ['M12 22a10 10 0 100-20 10 10 0 000 20z', 'M12 6v6l4 2'],
  calendar: ['M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z', 'M16 2v4M8 2v4M3 10h18'],
  pencil: ['M12 20h9', 'M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4 12.5-12.5z'],
  // ⚠️⚠️ NOT A PAPER PLANE ANY MORE, AND THAT IS THE WHOLE POINT. This entry held
  // the plane Federico rejected on 14 Aug 2026 («questa non mi piace») and NOTHING EVER
  // CALLED IT — the plane on screen was a hand-copy of the same path in calculator.html.
  // It is now the arrow he chose, read from the one place that defines it, so
  // icon('send') and every other send control in the app draw the same shape.
  send: SEND_PATHS,
  chevronRight: ['M9 18l6-6-6-6'],                                // mirrors the shared back arrow
  chevronLeft: ['M15 18l-6-6 6-6'],
};

// icon(name, size) → an <svg> element, coloured by whatever `color` the parent has.
// aria-hidden: these icons never carry meaning on their own — every button that
// uses one also has a text label or an aria-label.
export function icon(name, size = 18) {
  const shapes = PATHS[name];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.classList.add('icon');
  for (const d of (shapes || [])) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}
