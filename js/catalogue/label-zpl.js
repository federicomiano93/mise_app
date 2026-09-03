// label-zpl.js — the label as ZPL II, the language a Zebra printer speaks natively.
// PURE, asserted under Node (P15), pinned character for character in the idiom of
// js/orders/order-text.js: this is a document somebody's food ends up wearing.
//
// ⚠️ WHY BOTHER, WHEN THE PRINT DIALOG ALREADY WORKS. Driven through a Windows
// driver the page is rasterised — the printer receives a picture of text. Driven by
// ZPL it receives the TEXT and sets it with its own fonts, which at 1.7 mm on a
// 203 dpi head is the difference between legible and grey. It is also the only form
// a print queue can carry to a printer with no browser attached (phase 3).
//
// ⚠️⚠️ IT IS ZEBRA'S LANGUAGE AND NOBODY ELSE'S. A Brother or a DYMO speaks its own
// raster format and would need a renderer of its own. The operating system's print
// dialog is the only road in this app that is independent of the make — which is
// worth remembering the day the printer is replaced.

import { blockText, emphasised } from './label-template-model.js';

// ── Dots ─────────────────────────────────────────────────────────────────────
//
// ⚠️ THE PRINT HEAD'S RESOLUTION IS THE WHOLE CONVERSION, AND GETTING IT WRONG IS
// SILENT. A 203 dpi label sent to a 300 dpi head comes out at two thirds of its
// size, perfectly rendered, with nothing anywhere saying so. It is a setting on the
// venue's profile and it is printed on the sticker on the back of the printer.
const DOTS_PER_MM = Object.freeze({ 203: 8, 300: 11.811 });

export function dotsPerMm(dpi) {
  return DOTS_PER_MM[dpi] || DOTS_PER_MM[203];
}

const dots = (mm, dpi) => Math.round(mm * dotsPerMm(dpi));

// ── The printer's own type ───────────────────────────────────────────────────
//
// Font 0 is Zebra's scalable typeface, the only one that can be asked for an
// arbitrary height. Its average advance is narrower than the app's screen font, so
// this constant is its own — the plan said the ZPL path would need one and it does.
//
// ⚠️ IT ERRS WIDE, ON PURPOSE. Over-estimating the width asks for more lines than
// the printer will actually use, so the label is judged taller than it is and a
// borderline one is refused rather than printed off the bottom of the paper.
const ZPL_GLYPH_EM = 0.58;

// ⚠️ THE LINE SPACING IS THE MODEL'S, not a second opinion. Two numbers for the
// same fact is two labels that disagree about how tall they are.
const LINE_HEIGHT = 1.28;

// ── Escaping ─────────────────────────────────────────────────────────────────
//
// ⚠️ THREE CHARACTERS CAN END A FIELD EARLY AND TAKE THE REST OF THE LABEL WITH
// THEM: ^ (format), ~ (control) and , (only inside ^FB). ZPL's own escape is
// _<hex> after ^FH, so ^FH is set on every field and these three are written as
// their hex codes. An ingredient called «Aroma ~ naturale» would otherwise have
// truncated the ingredient list at that word — silently, which is the one thing
// this feature may never do.
const HEX = Object.freeze({ '^': '_5E', '~': '_7E', '_': '_5F' });

export function escapeZpl(text) {
  return String(text).replace(/[\^~_]/g, ch => HEX[ch]);
}

// ── Fitting, again, and with less to go on ───────────────────────────────────
//
// ⚠️⚠️ THIS ESTIMATE HAS NO BROWSER BEHIND IT. The HTML path renders the label and
// MEASURES it; here there is nothing to measure until the paper comes out. So the
// ZPL is generated from the layout the browser already measured — same millimetres,
// same font size — and this only decides how many lines to allow each block.
//
// ⚠️ AND ^FB TRUNCATES. A field block given fewer lines than its text needs DROPS
// the remainder, on the printer, in silence — which is precisely the failure this
// whole feature exists to prevent. So the line allowance is deliberately generous:
// if the estimate is wrong the label OVERFLOWS, which somebody can see, rather than
// being cut short, which reads as a finished declaration. Overflow is the lesser
// harm and the choice is made here, once, on purpose.
const LINE_SLACK = 2;
const MAX_FB_LINES = 9999;   // ZPL's own ceiling

export function linesNeeded(text, fontMm, widthMm) {
  const charMm = fontMm * ZPL_GLYPH_EM;
  const perLine = Math.max(1, Math.floor(widthMm / charMm));
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;

  let lines = 1;
  let used = 0;
  for (const word of words) {
    if (word.length > perLine) {
      const rows = Math.ceil(word.length / perLine);
      lines += (used > 0 ? 1 : 0) + rows - 1;
      used = word.length % perLine || perLine;
      continue;
    }
    const need = used === 0 ? word.length : used + 1 + word.length;
    if (need <= perLine) { used = need; } else { lines++; used = word.length; }
  }
  return lines;
}

// ── The label ────────────────────────────────────────────────────────────────
//
// A resolved label (from resolveLabel()) → one ZPL job as a string.
//
//   ^XA … ^XZ
//
// ⚠️ ^CI28 IS NOT OPTIONAL. Without it the printer reads the bytes as its own
// legacy code page: «Può contenere» prints as «PuÃ² contenere» and every Italian
// accent on the label is wrong. It is the first command in the job for that reason.
export function toZpl(resolved, { copies = 1 } = {}) {
  if (!resolved || !resolved.ok) return '';

  const dpi = resolved.dpi || 203;
  const emphasis = resolved.emphasis || 'caps';
  const innerW = Math.max(1, resolved.widthMm - resolved.marginMm * 2);

  const out = [
    '^XA',
    '^CI28',                                        // UTF-8
    `^PW${dots(resolved.widthMm, dpi)}`,            // print width
    `^LL${dots(resolved.heightMm, dpi)}`,           // label length
    '^LH0,0',                                       // no extra home offset
    '^LT0',
  ];

  let yMm = resolved.marginMm;

  resolved.blocks.forEach((block, i) => {
    const fontMm = resolved.fontMm * ((resolved.scale && resolved.scale[block.role]) || 1);
    const text = blockText(block, emphasis);
    const lines = linesNeeded(text, fontMm, innerW);
    const lineMm = fontMm * LINE_HEIGHT;

    const h = dots(fontMm, dpi);
    // Zebra's font 0 takes a height and a width; asking for the same number gives
    // the typeface its natural proportions.
    out.push(`^FO${dots(resolved.marginMm, dpi)},${dots(yMm, dpi)}`);
    out.push(`^A0N,${h},${h}`);
    // ^FB<width>,<maxLines>,<addedLineSpace>,<justify>,<hangIndent>
    out.push(`^FB${dots(innerW, dpi)},${Math.min(MAX_FB_LINES, lines + LINE_SLACK)},0,L,0`);
    out.push('^FH');
    out.push(`^FD${escapeZpl(text)}^FS`);

    yMm += lines * lineMm;
    if (i < resolved.blocks.length - 1) yMm += fontMm * (resolved.blockGapEm || 0);
  });

  // ⚠️ ONE LABEL PER JOB UNLESS SOMEBODY ASKED FOR MORE. A ^PQ nobody chose is a
  // roll of stickers nobody wanted.
  if (copies > 1) out.push(`^PQ${Math.min(Math.max(1, Math.floor(copies)), 999)}`);
  out.push('^XZ');

  return out.join('\n') + '\n';
}

// What the ZPL will occupy, in millimetres, by the same estimate the job is built
// from. The screen uses it to say whether the paper is big enough BEFORE anything
// is sent — the printer cannot be asked.
export function zplHeightMm(resolved) {
  if (!resolved || !resolved.ok) return 0;
  const emphasis = resolved.emphasis || 'caps';
  const innerW = Math.max(1, resolved.widthMm - resolved.marginMm * 2);
  let total = 0;
  resolved.blocks.forEach((block, i) => {
    const fontMm = resolved.fontMm * ((resolved.scale && resolved.scale[block.role]) || 1);
    total += linesNeeded(blockText(block, emphasis), fontMm, innerW) * fontMm * LINE_HEIGHT;
    if (i < resolved.blocks.length - 1) total += fontMm * (resolved.blockGapEm || 0);
  });
  return Math.round(total * 100) / 100;
}

// ⚠️ THE SAME ANSWER SHAPE AS THE BROWSER'S, so the screen can treat both roads
// alike: it fits, or it does not and nothing is sent.
export function zplFits(resolved) {
  if (!resolved || !resolved.ok) return false;
  return zplHeightMm(resolved) <= (resolved.heightMm - resolved.marginMm * 2) + 0.01;
}

// The emphasised form of one word, exported so a test can pin that the ZPL and the
// screen agree about what «emphasised» means rather than each deciding for itself.
export { emphasised };
