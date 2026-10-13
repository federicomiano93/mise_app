// label-sheet.ts — the PURE half of js/catalogue/label-print.js: the label as a piece of paper, described as
// plain data, and the two measurement LOOPS that decide how big it is drawn. No DOM here: the screen builds its
// nodes from `sheetModel()` and hands the loops a function that does the measuring.
//
// WHAT WAS SPLIT, AND WHY. label-print.js builds the sheet's DOM, measures it and prints it in one file, which a
// Node test cannot reach. Mise 2 keeps the decisions here, where they can be asserted: WHICH blocks, at WHAT
// size, with WHICH words emphasised (sheetModel); WHEN the text is stepped down and where it stops (fitFont);
// HOW the preview is scaled to the room there is (fitWidthFactor). What stays in the app slice is the part that
// needs a browser: creating the elements, reading scrollHeight / clientWidth, calling window.print().
//
// ⚠️⚠️ THE PREVIEW AND THE PRINT ARE THE SAME SHEET, BUILT THE SAME WAY, AT THE SAME MILLIMETRE SIZE. Both
// are drawn from the one `sheetModel()` answer, so they cannot disagree about a size, a gap or which words
// stand out. A preview drawn by one piece of code and a print produced by another is two labels that drift
// apart, and the one that drifts is the one nobody looks at until it is stuck on food.
//
// ⚠️ AND THE MEASUREMENT IS THE GATE, NOT THE ESTIMATE. label-template-model.ts works out a starting size under
// Node, where nothing can truly measure text. In a browser the sheet is rendered and asked whether it
// overflowed, and that answer is what decides whether printing is allowed.

import { emphasised } from './label-template-model';

// How far the browser measurement is allowed to disagree with itself before it
// counts as an overflow. Sub-pixel layout rounds, and a label refused for a third
// of a pixel would be refused for ever with nothing visibly wrong.
export const OVERFLOW_TOLERANCE_PX = 1;

// The same step the model uses, so the two shrink in the same increments and a size
// that came from one is a size the other would have chosen.
export const STEP_MM = 0.05;

// ⚠️⚠️ THE WIDTH IS MEASURED MORE THAN ONCE, AND THE REASON IS A SCROLLBAR. Setting the sheet's height changes
// how tall the screen is, which is what decides whether the page needs a VERTICAL scrollbar — and that
// scrollbar takes about 16 px off the width just measured. One pass answered 235 px, the scrollbar arrived,
// the column became 219, and the sheet stayed 16 px too wide with its left edge off-screen. Three passes is far
// more than convergence needs and costs nothing.
export const PREVIEW_PASSES = 3;

// Half a pixel of slack: a sheet this close to the room there is counts as fitting it.
const PREVIEW_SLACK_PX = 0.5;

// ── The sheet ────────────────────────────────────────────────────────────────

// One word of the ingredient list as the sheet draws it. `text` is the FINAL text (already in capitals when the
// printer emphasises that way); `allergen` says whether the span carries the bold class (lab-sheet-ing--allergen).
export interface SheetPart {
  text: string;
  allergen: boolean;
}

export interface SheetBlock {
  // `lab-sheet-block lab-sheet-${role}`.
  role: string;
  // The block's own font size, as a multiple of the sheet's (`${fontEm}em`).
  fontEm: number;
  // The gap under the block, in em of its own size — 0 for the last block.
  gapEm: number;
  // A plain block is one string; the ingredient block has `parts` and this is ''.
  text: string;
  prefix: string;
  parts: SheetPart[] | null;
  // What goes between two parts and after the last one: ', ' and '.' for a block with parts, '' otherwise.
  separator: string;
  closing: string;
}

export interface SheetModel {
  widthMm: number;
  heightMm: number;
  // The sheet's padding is the label's margin.
  paddingMm: number;
  fontMm: number;
  lineHeight: number;
  blocks: SheetBlock[];
}

// The fields of a resolved label (resolveLabel's ok answer) the sheet is drawn from. Anything may be inside it,
// as in the original, so everything is read the way the original reads it.
interface ResolvedLike {
  widthMm: number;
  heightMm: number;
  marginMm: number;
  fontMm: number;
  lineHeight: number;
  blockGapEm: number;
  scale?: Readonly<Record<string, number>> | null;
  emphasis?: unknown;
  blocks: readonly {
    role: string;
    text?: string | null;
    prefix?: string;
    parts?: readonly { text: string; emphasise?: unknown }[] | null;
  }[];
}

// A resolved label (from resolveLabel()) → the data the sheet is built from, exactly widthMm × heightMm.
//
// `fontMm` is passed separately from `resolved.fontMm` so fitFont() can redraw the same label a step smaller
// without rebuilding the model's answer.
export function sheetModel(resolved: ResolvedLike, fontMm: number = resolved.fontMm): SheetModel {
  const blocks: SheetBlock[] = resolved.blocks.map((block, i) => {
    // ⚠️ THE SCALES COME FROM THE MODEL, NEVER FROM THE STYLESHEET. Two copies of
    // "the name is 1.35×" is two answers that can part, and the one that would be
    // wrong is the printed one — which is the only one that ends up on food.
    const scale = (resolved.scale && resolved.scale[block.role]) || 1;
    const gapEm = i < resolved.blocks.length - 1 ? resolved.blockGapEm : 0;
    if (block.parts) {
      // ⚠️ THE ALLERGENS ARE EMPHASISED INSIDE THE LIST, which is what the
      // regulation asks for — not only summarised on the line underneath.
      //
      // ⚠️⚠️ THE PREVIEW SHOWS THE EMPHASIS THE PRINTER CAN ACTUALLY PRODUCE. A Zebra driven by ZPL has no
      // bold inside a wrapped paragraph, so it emphasises by CAPITALS — and a preview showing bold where the
      // paper will show capitals is exactly the drift this file exists to prevent. The mode comes from the
      // venue's printer, decided once in label-template-model.ts.
      const caps = resolved.emphasis === 'caps';
      return {
        role: block.role, fontEm: scale, gapEm,
        text: '', prefix: block.prefix || '',
        parts: block.parts.map(part => ({
          text: part.emphasise ? emphasised(part.text, resolved.emphasis) : part.text,
          allergen: !!part.emphasise && !caps,
        })),
        separator: ', ', closing: '.',
      };
    }
    return {
      role: block.role, fontEm: scale, gapEm,
      text: block.text == null ? '' : String(block.text), prefix: '', parts: null,
      separator: '', closing: '',
    };
  });

  return {
    widthMm: resolved.widthMm,
    heightMm: resolved.heightMm,
    paddingMm: resolved.marginMm,
    fontMm,
    lineHeight: resolved.lineHeight,
    blocks,
  };
}

// The words a block draws, as one string — the prefix, the parts joined, the closing full stop. What the sheet
// actually prints for that block, and so what a test can compare with blockText() of the model.
export function sheetBlockText(block: SheetBlock): string {
  if (!block.parts) return block.text;
  return block.prefix + block.parts.map(part => part.text).join(block.separator) + block.closing;
}

// ── Fitting the text to the paper ────────────────────────────────────────────

// Did the content spill past the paper? `overflowPx` is scrollHeight - clientHeight of the rendered sheet.
//
// ⚠️ `overflow: hidden` DOES NOT HIDE THIS FROM US — scrollHeight still reports the
// full height of the content. That is exactly why the stylesheet clips the sheet:
// the paper cannot grow, so anything that does not fit has to be detectable rather
// than merely invisible.
export function overflows(overflowPx: number): boolean {
  return overflowPx > OVERFLOW_TOLERANCE_PX;
}

export interface FitResult {
  fontMm: number;
  fits: boolean;
  // false when the sheet could not be measured at all; then `fits` is false too.
  measured: boolean;
}

// What the screen hands in: draw the sheet at this font size and answer how many pixels it overflows by, or
// `null` when it cannot be measured (the node is not in the document, or has no width).
export type MeasureOverflow = (fontMm: number) => number | null;

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
// including the ones that do not fit. The first call genuinely IS detached on a screen built before the
// router appends it; the caller must ask again once it is mounted, and must NOT print on the strength of an
// unmeasured answer. That is not hypothetical: the first version returned `fits: true` from a detached node
// and the Print button went live on a measurement that had never happened. So `measure` answers `null` (or
// anything that is not a number) for «could not measure», and the answer is then `{ fits: false, measured:
// false }` — never fits, whatever the font.
export function fitFont(resolved: { fontMm: number; minFontMm: number }, measure: MeasureOverflow): FitResult {
  let fontMm = resolved.fontMm;
  let overflow = measure(fontMm);
  if (!isMeasure(overflow)) return { fontMm, fits: false, measured: false };

  while (overflows(overflow) && round2(fontMm - STEP_MM) >= resolved.minFontMm) {
    fontMm = round2(fontMm - STEP_MM);
    overflow = measure(fontMm);
    // The node was measurable a moment ago; one that stops being so has not been measured at this size.
    if (!isMeasure(overflow)) return { fontMm, fits: false, measured: false };
  }

  return { fontMm, fits: !overflows(overflow), measured: true };
}

function isMeasure(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// ── Making a 76 mm sheet visible on a 74 mm screen ───────────────────────────
//
// ⚠️⚠️ FOUND BY LOOKING, AFTER EVERY MEASUREMENT HAD PASSED. A 76 mm sheet is
// 287 CSS px and a phone's content column is about 281: the sheet overflowed its
// box, and with `justify-content: center` an overflowing flex child spills equally
// on BOTH sides — so the left edge went off-screen and no amount of scrolling could
// bring it back. The label read «ne semplice / redienti: / ntiene:». Every fit
// check was green, because the sheet's own contents fitted the sheet perfectly.
//
// So the sheet keeps its true millimetres and is SCALED DOWN to whatever room there
// is. Scaling, not shrinking: the paper is still 76 × 51 mm, and the print is
// unaffected — it builds its own copy and never sees this.
//
// ⚠️ AND IT IS MEASURED FIRST, SCALED SECOND. fitFont() must run on the untouched
// sheet, or the fit answer would be about a picture of a label rather than a label.
//
// `natural` is the sheet's layout width (offsetWidth, unaffected by any transform); `available()` reads the
// room the preview box has RIGHT NOW (clientWidth) — it is called again on every pass, because scaling the
// sheet can change it; `apply(factor)` puts the factor on the sheet (transform, and the host's height).
//
// ⚠️⚠️ THE OVERFLOW IS STOPPED BEFORE THE ROOM IS MEASURED (the caller's job, before `natural` is read), and
// getting this backwards cost a round of «why is it still too wide». A sheet wider than its box widens the
// page's own scrollable area, which widens the box — so asking clientWidth WHILE overflowing answers with room
// that only exists because of the overflow. Measured that way a 287 px sheet in a 219 px column reported 235,
// and scaling to 235 left it 16 px too wide with the left edge still off-screen.
//
// Returns the factor applied: 1 when the sheet fitted as it was, which is what lets the screen say «actual
// size» only when it is telling the truth.
export function fitWidthFactor(natural: number, available: () => number, apply: (factor: number) => void): number {
  if (!natural || !available()) return 1;

  let factor = 1;
  for (let pass = 0; pass < PREVIEW_PASSES; pass++) {
    const room = available();
    if (!room || natural * factor <= room + PREVIEW_SLACK_PX) break;
    factor = room / natural;
    apply(factor);
  }
  return factor;
}

// The host keeps the height of a sheet that has been scaled down: the layout box has not changed size, only
// its painting — so without this the host would keep a gap under a sheet that no longer reaches the bottom.
export function scaledHostHeightPx(sheetOffsetHeight: number, factor: number): number {
  return Math.ceil(sheetOffsetHeight * factor);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
