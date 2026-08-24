// send-icon.js — THE send arrow, and the two roads it can take. One definition each,
// for every screen in the app.
//
// ⚠️⚠️ THE ARROW WAS CHOSEN, NOT DESIGNED, AND NOT BY ME. On 14 Aug 2026 three
// candidates were mounted side by side in the Orders header and screenshotted, and
// Federico picked this one — an arrow leaving a box. He rejected the paper plane that
// had shipped hours earlier in his own words: «questa non mi piace». The shape is the
// one nearly every app uses for «send this somewhere»; unlike an envelope it does not
// quietly name the email road, and unlike an arrow in a circle it cannot be mistaken
// for the Back arrow sitting at the other end of the same bar.
//
// ⚠️ WHY IT NOW LIVES IN js/ ROOT. Until 24 Aug 2026 that arrow existed in exactly ONE
// place — inline markup in orders.html — while the rest of the app sent things through
// five other glyphs: a paper plane (the rejected one, still on the Calculator's order
// modal), three copies of the filled WhatsApp brand mark, and four screens whose send
// buttons carried no icon at all. Federico, 24 Aug 2026: «usa le stesse frecce di invio
// uguali in tutta l'app». A shape that must be identical on every page cannot live in
// one feature's file, and a feature may not import from another feature's folder — so
// it sits at the root, pure and DOM-free, like js/price-model.js and js/photo-model.js.
//
// ⚠️⚠️ THE WHATSAPP BRAND MARK IS DELIBERATELY NOT HERE, AND THAT IS THE POINT. A
// «send» button that wears the WhatsApp mark names exactly ONE of the roads behind it,
// which is how somebody learns the wrong thing about what their own app does — the
// argument already written in orders.html the day the arrow was chosen. The mark is
// gone from every send button; what remains inside the chooser, where a road IS being
// named, is a plain stroked speech bubble in the app's own drawing convention.

// The three shapes of the arrow, in a 24×24 box, stroked — the app's convention.
export const SEND_PATHS = Object.freeze([
  'M12 3v12',
  'M8 7l4-4 4 4',
  'M4 15v4a2 2 0 002 2h12a2 2 0 002-2v-4',
]);

// A speech bubble: «WhatsApp — I pick the chat». Not the brand mark.
export const WHATSAPP_PATHS = Object.freeze([
  'M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7'
  + 'a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z',
]);

// An envelope: «Email — it opens the mail app».
// ⚠️ THE BODY IS A PATH, NOT A <rect rx="2">, and it draws the SAME rounded rectangle —
// the builders below emit paths only, and swapping a rounded rect for a square one
// would have changed a glyph that has been on the Orders chooser since v1.55.0.
export const EMAIL_PATHS = Object.freeze([
  'M4 4h16a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z',
  'M22 6l-10 7L2 6',
]);

// ⚠️ AUTHOR-CONTROLLED MARKUP, built from the frozen lists above and nothing else. It is
// handed to el()'s `icon:` prop, which assigns innerHTML — safe only because no part of
// this string can come from data. Never interpolate anything but the size.
// ⚠️ THE OPENING TAG STAYS ON ONE LINE, long as it is. tests/english-text.test.mjs
// forbids straight quotes around a template hole in anything the app says, and skips a
// line only when it can SEE it is markup — by `<svg`, `<path` or `xmlns` being on it.
// Wrapping the attributes onto a second line hides that from the guard and the file
// fails for prose it does not contain.
export function svgFrom(paths, size = 20) {
  const n = Number(size) > 0 ? Math.round(Number(size)) : 20;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${n}" height="${n}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">`;
  return open + paths.map(d => `<path d="${d}"/>`).join('') + '</svg>';
}

export const sendIconSvg = (size) => svgFrom(SEND_PATHS, size);

// The same shapes as an ELEMENT, for the screens whose DOM helper never parses HTML —
// the Calculator's icon factory, and the send sheet below it. Same source list, so the
// two representations cannot drift into two different arrows.
const SVG_NS = 'http://www.w3.org/2000/svg';

export function svgElement(paths, size = 20) {
  const n = Number(size) > 0 ? Math.round(Number(size)) : 20;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(n));
  svg.setAttribute('height', String(n));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
  }
  return svg;
}
