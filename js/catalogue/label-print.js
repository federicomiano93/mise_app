// label-print.js — the label as a piece of paper: the sheet the screen previews and
// the sheet the printer receives, built by ONE function so they cannot disagree.
//
// ⚠️⚠️ THE PREVIEW AND THE PRINT ARE THE SAME NODE, BUILT THE SAME WAY, AT THE SAME
// MILLIMETRE SIZE. That is the whole design of this file. A preview drawn by one
// piece of code and a print produced by another is two labels that drift apart, and
// the one that drifts is the one nobody looks at until it is stuck on food.
//
// ⚠️ AND THE MEASUREMENT IS THE GATE, NOT THE ESTIMATE. label-template-model.js
// works out a starting size under Node, where nothing can truly measure text. Here
// there is a browser: the sheet is rendered and asked whether it overflowed, and
// that answer is what decides whether printing is allowed. See fitSheet().
//
// ⚠️ NO INLINE STYLE STRINGS AND NO <style> BLOCK — the page CSP is `style-src
// 'self'`. Everything variable goes through el()'s `style` prop, which is the CSSOM
// and is allowed; everything fixed lives in label-print.css.

import { el } from './dom.js';
import { emphasised } from './label-template-model.js';

const HOST_ID = 'labelPrint';

// How far the browser measurement is allowed to disagree with itself before it
// counts as an overflow. Sub-pixel layout rounds, and a label refused for a third
// of a pixel would be refused for ever with nothing visibly wrong.
const OVERFLOW_TOLERANCE_PX = 1;

// The same step the model uses, so the two shrink in the same increments and a size
// that came from one is a size the other would have chosen.
const STEP_MM = 0.05;

// ── The sheet ────────────────────────────────────────────────────────────────

// A resolved label (from resolveLabel()) → one node, exactly widthMm × heightMm.
//
// `fontMm` is passed separately from `resolved.fontMm` so fitSheet() can redraw the
// same label a step smaller without rebuilding the model's answer.
export function buildSheet(resolved, fontMm = resolved.fontMm) {
  const sheet = el('div', {
    class: 'lab-sheet',
    style: {
      width: `${resolved.widthMm}mm`,
      height: `${resolved.heightMm}mm`,
      padding: `${resolved.marginMm}mm`,
      fontSize: `${fontMm}mm`,
      lineHeight: String(resolved.lineHeight),
    },
  });

  resolved.blocks.forEach((block, i) => {
    // ⚠️ THE SCALES COME FROM THE MODEL, NEVER FROM THE STYLESHEET. Two copies of
    // "the name is 1.35×" is two answers that can part, and the one that would be
    // wrong is the printed one — which is the only one that ends up on food.
    const scale = (resolved.scale && resolved.scale[block.role]) || 1;
    const node = el('p', {
      class: `lab-sheet-block lab-sheet-${block.role}`,
      style: {
        fontSize: `${scale}em`,
        marginBottom: i < resolved.blocks.length - 1 ? `${resolved.blockGapEm}em` : '0',
      },
    });

    if (block.parts) {
      // ⚠️ THE ALLERGENS ARE EMPHASISED INSIDE THE LIST, which is what the
      // regulation asks for — not only summarised on the line underneath.
      if (block.prefix) node.appendChild(document.createTextNode(block.prefix));
      block.parts.forEach((part, j) => {
        // ⚠️⚠️ THE PREVIEW SHOWS THE EMPHASIS THE PRINTER CAN ACTUALLY PRODUCE.
        // A Zebra driven by ZPL has no bold inside a wrapped paragraph, so it
        // emphasises by CAPITALS — and a preview showing bold where the paper will
        // show capitals is exactly the drift this file exists to prevent. The mode
        // comes from the venue's printer, decided once in label-template-model.js.
        const caps = resolved.emphasis === 'caps';
        node.appendChild(el('span', {
          class: (part.emphasise && !caps) ? 'lab-sheet-ing lab-sheet-ing--allergen' : 'lab-sheet-ing',
          text: part.emphasise ? emphasised(part.text, resolved.emphasis) : part.text,
        }));
        if (j < block.parts.length - 1) node.appendChild(document.createTextNode(', '));
      });
      node.appendChild(document.createTextNode('.'));
    } else {
      node.textContent = block.text;
    }

    sheet.appendChild(node);
  });

  return sheet;
}

// Did the content spill past the paper?
//
// ⚠️ `overflow: hidden` DOES NOT HIDE THIS FROM US — scrollHeight still reports the
// full height of the content. That is exactly why the stylesheet clips the sheet:
// the paper cannot grow, so anything that does not fit has to be detectable rather
// than merely invisible.
export function overflows(sheet) {
  return (sheet.scrollHeight - sheet.clientHeight) > OVERFLOW_TOLERANCE_PX;
}

// Render, measure, shrink, measure again — and stop at the floor the law sets.
//
// ⚠️ THE FLOOR IS NEVER CROSSED, AND WHAT HAPPENS AT THE FLOOR IS A REFUSAL. The
// return value says `fits: false` and the caller must not print. It does NOT return
// a shortened label, because there is no such thing as a shortened allergen
// declaration — only a wrong one.
//
// ⚠️⚠️ AND IT SAYS WHETHER IT COULD MEASURE AT ALL, WHICH IS NOT THE SAME AS
// «IT FITS». A node that is not in the document reports every width and height as
// zero, and zero-against-zero reads as fitting — for every label ever made,
// including the ones that do not fit. This screen is built before the router
// appends it, so the first call genuinely IS detached; the caller must ask again
// once it is mounted, and must NOT print on the strength of an unmeasured answer.
//
// That is not hypothetical: the first version returned `fits: true` from a detached
// node and the Print button went live on a measurement that had never happened.
export function fitSheet(host, resolved) {
  let fontMm = resolved.fontMm;
  let sheet = buildSheet(resolved, fontMm);
  host.replaceChildren(sheet);

  const measured = host.isConnected && host.clientWidth > 0;
  if (!measured) return { sheet, fontMm, fits: false, measured: false };

  while (overflows(sheet) && round2(fontMm - STEP_MM) >= resolved.minFontMm) {
    fontMm = round2(fontMm - STEP_MM);
    sheet = buildSheet(resolved, fontMm);
    host.replaceChildren(sheet);
  }

  return { sheet, fontMm, fits: !overflows(sheet), measured: true };
}

// ── Making a 76 mm sheet visible on a 74 mm screen ───────────────────────────
//
// ⚠️⚠️ FOUND BY LOOKING, AFTER EVERY MEASUREMENT HAD PASSED. A 76 mm sheet is
// 287 CSS px and a phone's content column is about 281: the sheet overflowed its
// box, and with `justify-content: center` an overflowing flex child spills equally
// on BOTH sides — so the left edge went off-screen and no amount of scrolling could
// bring it back. The label read «ne semplice / redienti: / ntiene:». Every fit check
// was green, because the sheet's own contents fitted the sheet perfectly.
//
// So the sheet keeps its true millimetres and is SCALED DOWN to whatever room there
// is. Scaling, not shrinking: the paper is still 76 × 51 mm, and the print is
// unaffected — printSheet() builds its own copy and never sees this.
//
// ⚠️ AND IT IS MEASURED FIRST, SCALED SECOND. fitSheet() must run on the untouched
// sheet, or the fit answer would be about a picture of a label rather than a label.
// (scrollHeight and clientHeight are layout values and ignore transforms, so this
// would probably survive being called in the wrong order — «probably» is not a
// property to build a food label on.)
//
// Returns the factor applied: 1 when the sheet fitted as it was, which is what lets
// the screen say «actual size» only when it is telling the truth.
export function fitPreviewWidth(host, sheet) {
  // ⚠️⚠️ THE OVERFLOW IS STOPPED BEFORE THE ROOM IS MEASURED, and getting this
  // backwards cost a round of «why is it still too wide». A sheet wider than its box
  // widens the page's own scrollable area, which widens the box — so asking
  // clientWidth WHILE overflowing answers with room that only exists because of the
  // overflow. Measured that way a 287 px sheet in a 219 px column reported 235, and
  // scaling to 235 left it 16 px too wide with the left edge still off-screen.
  sheet.style.transform = '';
  host.style.height = '';
  host.style.overflowX = 'hidden';
  // ⚠️ BOTH AXES. The stylesheet only sets overflow-x, and CSS then computes
  // overflow-y as `auto` rather than `visible` — so the host grew a vertical
  // scrollbar for a sheet whose LAYOUT box is still full height while its painted
  // one has been scaled down. It clipped the sheet's own right edge.
  host.style.overflowY = 'hidden';

  const natural = sheet.offsetWidth;      // layout width, unaffected by any transform
  if (!natural || !host.clientWidth) { host.style.overflowX = ''; return 1; }

  // ⚠️⚠️ MEASURED MORE THAN ONCE, AND THE REASON IS A SCROLLBAR. Setting the sheet's
  // height changes how tall the screen is, which is what decides whether the page
  // needs a VERTICAL scrollbar — and that scrollbar takes about 16 px off the width
  // this function just measured. One pass answered 235 px, the scrollbar arrived,
  // the column became 219, and the sheet stayed 16 px too wide with its left edge
  // off-screen. Three passes is far more than convergence needs and costs nothing.
  let factor = 1;
  for (let pass = 0; pass < 3; pass++) {
    const available = host.clientWidth;
    if (!available || natural * factor <= available + 0.5) break;
    factor = available / natural;
    // ⚠️ top CENTRE, not top left. The sheet's layout box is centred in the host, so
    // scaling it towards its own centre keeps it centred; scaling towards a top-left
    // corner that is already off-screen to the left would move it further off.
    sheet.style.transformOrigin = 'top center';
    sheet.style.transform = `scale(${factor})`;
    // The layout box has not changed size, only its painting — so without this the
    // host would keep a gap under a sheet that no longer reaches the bottom of it.
    host.style.height = `${Math.ceil(sheet.offsetHeight * factor)}px`;
  }

  if (factor === 1) { host.style.overflowX = ''; host.style.overflowY = ''; host.style.height = ''; }
  return factor;
}

// ── The printing ─────────────────────────────────────────────────────────────

// Put the sheet on paper.
//
// ⚠️ BUILT ON DEMAND AND REMOVED AFTERWARDS. A permanent hidden node would be one
// more thing on every screen of this page for a button most people press rarely,
// and — worse — a stale copy of a label somebody has since edited.
//
// ⚠️ IT IS NOT CALLED `.preview-overlay`. That class is in BUSY_SELECTORS
// (js/update-gate.js), so a node carrying it postpones a compulsory update for as
// long as it exists. The same trap is documented on ingredient-picker.js.
//
// ⚠️ AND IT IS A DIRECT CHILD OF <body>, which is what lets label-print.css hide
// everything else with a single `body > *:not(#labelPrint)` rule instead of a list
// of selectors that goes stale the next time this page gains a header.
export function printSheet(resolved, { sizeId = null, fontMm = null } = {}) {
  const old = document.getElementById(HOST_ID);
  if (old) old.remove();

  const host = el('div', {
    // ⚠️ A PRESET SIZE NAMES A @page RULE THAT ALREADY EXISTS in the stylesheet, so
    // nothing has to build CSS at runtime. A custom size falls through to the
    // unnamed `@page { size: auto }`, where the driver's own paper decides — which
    // is what the driver has to be set to anyway. Deliberately no insertRule():
    // a static stylesheet is one fewer thing that can be wrong on the one output
    // nobody sees until it is already printed.
    class: sizeId ? `lab-print lab-print--${sizeId}` : 'lab-print',
    id: HOST_ID,
  }, [buildSheet(resolved, fontMm || resolved.fontMm)]);

  document.body.appendChild(host);

  const cleanUp = () => {
    const node = document.getElementById(HOST_ID);
    if (node) node.remove();
    window.removeEventListener('afterprint', cleanUp);
  };
  // ⚠️ THE LISTENER, NOT A LINE AFTER print(). window.print() blocks in some
  // browsers and returns immediately in others; removing the node on the next line
  // races the print dialog and can print a blank page.
  window.addEventListener('afterprint', cleanUp);
  window.print();
  return { ok: true };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
