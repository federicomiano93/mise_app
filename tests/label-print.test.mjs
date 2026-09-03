// Printing a label: the roads a device has, and the sheet that goes down them.
//
// ⚠️ TWO KINDS OF TEST LIVE HERE, and the split is the project's usual one. The
// transport registry is ordinary code and is imported and called. label-print.js
// draws DOM, so it is checked by READING ITS SOURCE — the same treatment as every
// other screen file here, because a real document is a browser's job and the manual
// smoke test's.
//
// ⚠️ AND THE THIRD KIND, which is the one that would otherwise go unwatched: the
// model and the stylesheet have to agree about the paper. The sizes live in
// label-template-model.js and the @page rules live in label-print.css, and nothing
// but a test can notice when one of them gains a size the other has not.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { availableTransports, transportById, TRANSPORTS } from '../js/catalogue/print-transports.js';
import { LABEL_SIZES } from '../js/catalogue/label-template-model.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
// Comments are stripped before anything is matched: this project writes its warnings
// IN the code and names the very things that must not appear, so a scan that reads
// prose reports the documentation as the bug.
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── The roads ────────────────────────────────────────────────────────────────

test('every transport declares the whole interface, so a screen can ask any of them', () => {
  for (const road of TRANSPORTS) {
    assert.equal(typeof road.id, 'string');
    assert.ok(road.id.length, 'a transport with no id cannot be chosen or remembered');
    assert.equal(typeof road.labelKey, 'string');
    assert.equal(typeof road.available, 'function');
    assert.equal(typeof road.send, 'function');
    assert.ok(['html', 'zpl'].includes(road.renderer));
  }
});

test('⚠️ available() is a FUNCTION, never a value frozen at import', () => {
  // The same shape as photoOn in catalogue-main.js and for the same reason: what a
  // device can do has to be asked when the screen paints. A boolean here would be
  // decided once, before any venue is open, and kept for the life of the page.
  for (const road of TRANSPORTS) assert.equal(typeof road.available, 'function');
  assert.doesNotMatch(codeOf(read('js/catalogue/print-transports.js')), /available:\s*(true|false)\b/);
});

test('⚠️ labelKey is a KEY, never a word — t() at module load freezes a language', () => {
  // The v1.57.0 defect: a phrase resolved when the module is first imported answers
  // in whatever language the app started in and keeps that answer for ever.
  const src = codeOf(read('js/catalogue/print-transports.js'));
  assert.doesNotMatch(src, /\bt\(/, 'the screen looks the key up when it paints');
  for (const road of TRANSPORTS) assert.match(road.labelKey, /^[a-z][\w.]+$/);
});

test('under Node — where there is no printer and no window — no road is offered', () => {
  // The honest answer for a device that cannot reach a printer, and the one the
  // screen turns into a sentence rather than a button that fails on tap.
  assert.deepEqual(availableTransports(), []);
});

test('a road whose available() throws is treated as absent, not as a crash', () => {
  // A screen that cannot paint is worse than a road that is missing.
  const rude = { available() { throw new Error('no'); } };
  assert.doesNotThrow(() => [rude].filter(r => { try { return r.available() === true; } catch (e) { return false; } }));
  assert.match(codeOf(read('js/catalogue/print-transports.js')), /try\s*\{[^}]*available\(\)/);
});

test('a transport can be found again by the id that was stored', () => {
  assert.equal(transportById(TRANSPORTS[0].id), TRANSPORTS[0]);
  assert.equal(transportById('carrier-pigeon'), null);
});

// ── The sheet ────────────────────────────────────────────────────────────────

test('⚠️ the print host is built on demand and removed when printing ends', () => {
  // A permanent hidden node is one more thing on every screen of this page, and —
  // worse — a stale copy of a label somebody has since edited.
  const src = codeOf(read('js/catalogue/label-print.js'));
  assert.match(src, /document\.body\.appendChild\(host\)/);
  assert.match(src, /addEventListener\('afterprint'/,
    'the node must be removed by the print lifecycle, not by the line after print()');
  assert.match(src, /removeEventListener\('afterprint'/, 'and the listener must go with it');
});

test('⚠️ the print host is not called .preview-overlay', () => {
  // That class is in BUSY_SELECTORS (js/update-gate.js): a node carrying it postpones
  // a compulsory update for as long as it exists. The same trap is already documented
  // on ingredient-picker.js.
  const src = read('js/catalogue/label-print.js');
  assert.doesNotMatch(codeOf(src), /preview-overlay/);
});

test('⚠️ nothing sets an inline style string — the page CSP is style-src self', () => {
  // An inline style="" attribute is refused outright and silently: the element simply
  // has no size, which on a label means an empty rectangle and no error anywhere.
  const src = codeOf(read('js/catalogue/label-print.js'));
  assert.doesNotMatch(src, /setAttribute\(\s*'style'/);
  assert.doesNotMatch(src, /\bstyle="/);
});

test('⚠️ the block scales come from the model, not from the stylesheet', () => {
  // Two copies of «the name is 1.35×» is two answers that can part, and the one that
  // would be wrong is the printed one.
  const src = codeOf(read('js/catalogue/label-print.js'));
  assert.match(src, /resolved\.scale\[block\.role\]/);
  assert.doesNotMatch(read('label-print.css').replace(/\/\*[\s\S]*?\*\//g, ''), /font-size:\s*1\.\d+em/,
    'the stylesheet must not restate a scale the model owns');
});

test('⚠️ the overflow check reads scrollHeight — the measurement IS the gate', () => {
  const src = codeOf(read('js/catalogue/label-print.js'));
  assert.match(src, /scrollHeight\s*-\s*\w+\.clientHeight/);
  // And it never shrinks past the floor the law sets.
  assert.match(src, />=\s*resolved\.minFontMm/);
});

// ── The paper, on screen and on the printer ──────────────────────────────────

test('⚠️ every preset size has a @page rule and a class that names it', () => {
  // A size the model offers and the stylesheet has never heard of prints on whatever
  // paper the driver happened to have loaded, with nothing saying so.
  const css = read('label-print.css');
  for (const size of LABEL_SIZES) {
    assert.ok(css.includes(`@page ${size.id}`),
      `label-print.css has no @page rule for ${size.id} (${size.widthMm} × ${size.heightMm} mm)`);
    assert.ok(css.includes(`${size.widthMm}mm ${size.heightMm}mm`),
      `the @page ${size.id} rule does not state ${size.widthMm}mm ${size.heightMm}mm`);
    assert.ok(css.includes(`.lab-print--${size.id}`),
      `nothing applies the named page ${size.id} to the sheet`);
  }
});

test('⚠️ everything but the label is hidden by ONE derived rule, not a list', () => {
  // #labelPrint is a direct child of <body>, so a header added next year is hidden
  // too. A list of class names here would go stale silently, on an output nobody
  // previews before it is already on paper.
  const css = read('label-print.css');
  assert.match(css, /body\s*>\s*\*:not\(#labelPrint\)\s*\{\s*display:\s*none\s*!important/);
});

test('⚠️ the sheet clips rather than grows, or nothing could detect an overflow', () => {
  // If the box were allowed to stretch, the browser would silently resize the paper
  // and scrollHeight would always equal clientHeight — the fit check would pass for
  // every label ever made, including the ones that do not fit.
  const css = read('label-print.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.lab-sheet\s*\{[^}]*overflow:\s*hidden/);
  assert.match(css, /\.lab-sheet\s*\{[^}]*box-sizing:\s*border-box/);
});

test('⚠️ the allergen emphasis survives a printer set to save ink', () => {
  const css = read('label-print.css');
  assert.match(css, /print-color-adjust:\s*exact/);
  assert.match(css.replace(/\/\*[\s\S]*?\*\//g, ''), /\.lab-sheet-ing--allergen\s*\{[^}]*text-decoration:\s*underline/,
    'bold alone is nearly invisible at 1.7 mm on a thermal print');
});

// ── The wiring on the screen ─────────────────────────────────────────────────

test('⚠️⚠️ the Print button obeys the MEASUREMENT, never the estimate', () => {
  // resolveLabel() guesses a starting size under Node, where nothing can measure
  // text. fitSheet() renders it and asks the browser. Wiring the button to the guess
  // would let an overflowing label print.
  const src = codeOf(read('js/catalogue/label-view.js'));
  assert.match(src, /printBtn\.disabled\s*=\s*!fitted\.measured\s*\|\|\s*!fitted\.fits/);
  assert.doesNotMatch(src, /printBtn\.disabled\s*=\s*!resolved\.fits/);
});

test('⚠️⚠️ an UNMEASURED sheet does not read as one that fits', () => {
  // The screen is built before the router appends it, and a detached node reports
  // every width as zero — which reads as fitting, for every label ever made. This
  // shipped for about an hour: the Print button went live on a measurement that had
  // never happened. fitSheet() now says whether it could measure at all, and the
  // screen asks again once it is mounted.
  const print = codeOf(read('js/catalogue/label-print.js'));
  assert.match(print, /const measured = host\.isConnected && host\.clientWidth > 0/);
  assert.match(print, /if \(!measured\) return \{[^}]*fits: false, measured: false/);

  const view = codeOf(read('js/catalogue/label-view.js'));
  assert.match(view, /return \{ root, mounted:/, 'the screen must expose a way to be measured again');

  const main = codeOf(read('js/catalogue/catalogue-main.js'));
  const swapped = main.indexOf('swap(labelView.root)');
  const mounted = main.indexOf('labelView.mounted()');
  assert.ok(swapped !== -1 && mounted !== -1, 'the router no longer mounts the label the way this test reads');
  assert.ok(swapped < mounted, 'mounted() must run AFTER swap(), or it measures a detached node again');
});

test('⚠️ the sheet is measured only after it is in the document', () => {
  // Every width and height a detached node reports is zero, and a fit check against
  // zero says «it fits» about everything.
  const src = codeOf(read('js/catalogue/label-view.js'));
  const inserted = src.indexOf('body.replaceChildren(preview');
  const measured = src.indexOf('fitSheet(preview');
  assert.ok(inserted !== -1 && measured !== -1, 'the preview is no longer built the way this test reads');
  assert.ok(inserted < measured, 'fitSheet() runs before the node is in the document — every measurement is zero');
});

test('⚠️ «no printer» and «will not fit» are different sentences', () => {
  // One is about the device and one is about the label. Telling somebody the wrong
  // one sends them to fix the wrong thing.
  const src = codeOf(read('js/catalogue/label-view.js'));
  assert.match(src, /label\.print\.noRoad/);
  assert.match(src, /label\.print\.tooBig/);
});

test('⚠️⚠️ the preview does not STRETCH the sheet — the paper keeps its own height', () => {
  // A flex container defaults to `align-items: stretch`, which overrides the exact
  // millimetres label-print.js sets on the sheet. A 25 x 20 mm label drew 25 mm wide
  // and 51 mm tall, and it looked perfect at 76 x 51 only because that happened to be
  // the height the container had anyway. Found by setting a custom size and
  // MEASURING; no amount of looking at the default size would have shown it.
  const css = read('label-print.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = css.slice(css.indexOf('.lab-preview {'), css.indexOf('}', css.indexOf('.lab-preview {')));
  assert.match(block, /display:\s*flex/, 'the preview is no longer the flex box this test is about');
  assert.match(block, /align-items:\s*flex-start/,
    'without this the container stretches the sheet and the printed paper size is not the previewed one');
});

test('⚠️ a scaled preview closes overflow on BOTH axes', () => {
  // The stylesheet only sets overflow-x, and CSS then computes overflow-y as `auto`
  // rather than `visible` — so the box grew a vertical scrollbar for a sheet whose
  // layout height is unchanged while its painted height has been scaled down, and it
  // clipped the sheet's own right edge.
  const src = codeOf(read('js/catalogue/label-print.js'));
  assert.match(src, /host\.style\.overflowY = 'hidden'/);
  assert.match(src, /host\.style\.overflowX = 'hidden'/);
});

test('⚠️ the width is measured more than once, because a scrollbar changes it', () => {
  // Setting the sheet's height decides whether the page needs a vertical scrollbar,
  // and that scrollbar takes ~16px off the width just measured. One pass answered
  // 235px, the scrollbar arrived, the column became 219, and the sheet stayed 16px
  // too wide with its left edge off-screen.
  const src = codeOf(read('js/catalogue/label-print.js'));
  assert.match(src, /for \(let pass = 0; pass < 3; pass\+\+\)/);
});
