// label-image-layout.ts — WHERE everything goes on the owner's product label with the logo (the «with logo» model), in the
// pixels of the canvas it is drawn on. NEW IN MISE 2: a port of `genera()` in the owner's label script
// (`genera_etichetta.py`, outside the repository) and of §4 of its specification.
// label-image-layout.spec.ts compares it with the script itself through the golden file its harness recorded.
//
// THE CANVAS IS FOUR TIMES THE LABEL (640 × 480 dots → 2560 × 1920 pixels) and every position below is in canvas
// pixels, worked out exactly as the script does — positions in dots multiplied by 4, font sizes `round(size × 4)` —
// so the lines break where they break today and the title shrinks to the same size.
//
// ⚠️ TEXT MEASUREMENT IS HANDED IN (`Measure`). The app measures with the label's own fonts the way Pillow measures
// them (label-image-fonts.ts); the specs measure with the widths the script itself reported.
//
// ⚠️⚠️ TOO LONG IS REFUSED, NEVER SHRUNK, NEVER CUT. The ingredients are printed at 18.3 px of DejaVu Sans, an «x» 1.25
// mm high once printed: the legal minimum is 1.2 mm (Reg. EU 1169/2011). Below the limit at y 398 the label says
// «does not fit» (`tooLong`) and the screen will not print it: shorten the text, or put the title on one line.
//
// ⚠️ THE WORDS OF THE LABEL ARE THE VENUE'S. The two header lines are the label profile's `businessName` and
// `businessAddress`, the title and the ingredients the recipe's; nothing about a business is written here. The one
// word this file adds, «PRODOTTO IL:», is handed in already in the language of the venue's COUNTRY
// (`producedOnWord(lang)` below): this file never knows the interface language.

import { runsOf } from './label-text-check';
import type { TextRun } from './label-text-check';

export const S = 4;
export const CANVAS_W = 640 * S;
export const CANVAS_H = 480 * S;

// The three faces: DejaVu Sans for the small text, its bold for the allergens and «PRODOTTO IL:», Liberation Sans Bold
// (Arial Bold's equivalent) for the title.
export type LabelFont = 'regular' | 'bold' | 'title';

// The width of `text` in canvas pixels, set in `font` at `px` pixels.
export type Measure = (text: string, font: LabelFont, px: number) => number;

// The sizes, as the script computes them: `round(size × 4)`.
export const BODY_PX = 73; // 18.3 px → «x» 10 dots = 1.25 mm
export const SMALL_BOLD_PX = 56; // 14 px, «PRODOTTO IL:»
export const TITLE_MAX = 32;
export const TITLE_MIN = 20;
export const TITLE_LINE = 34; // dots between two title lines
export const LINE_HEIGHT = 25; // dots between two lines of ingredients
export const TEXT_LIMIT_Y = 398; // the ingredients end above this (room for «PRODOTTO IL»)
export const LOGO_W = 330 * S; // 41 mm

export type LayoutElement =
  // The logo, drawn at its stored size (it is stored already reduced to LOGO_W wide).
  | { readonly kind: 'image'; readonly x: number; readonly y: number; readonly w: number; readonly h: number }
  // Text whose TOP OF THE ASCENDER is at y (Pillow's default anchor), starting at x.
  | { readonly kind: 'text'; readonly x: number; readonly y: number; readonly text: string; readonly font: LabelFont; readonly px: number }
  // A filled rectangle, both corners INCLUDED (Pillow's rectangle).
  | { readonly kind: 'rect'; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };

export interface LogoLabelInput {
  // The title as typed: `|` starts a new line.
  readonly title: string;
  // The ingredients as typed, allergens in capitals.
  readonly ingredients: string;
  // The two header lines (profile `businessName`, `businessAddress`); an empty one is left out of the drawing but
  // keeps its place, as the script's fixed positions do.
  readonly header: readonly [string, string];
  // The stored logo's size in canvas pixels (LOGO_W wide).
  readonly logo: { readonly width: number; readonly height: number };
  // «PRODOTTO IL:» in the label's language.
  readonly producedOn: string;
}

export interface LogoLabelLayout {
  readonly elements: readonly LayoutElement[];
  readonly titleLines: readonly string[];
  readonly titleSize: number;
  // In dots, like the script's own numbers.
  readonly logoBottom: number;
  readonly lineY: number;
  readonly titleY: number;
  readonly ingredientsY: number;
  readonly lines: readonly (readonly string[])[];
  readonly endY: number;
  // The ingredients go past y 398: refuse.
  readonly tooLong: boolean;
  // Text that would run off the label sideways, which the script drew cut: a header line wider than the label, a title
  // still wider than 596 dots at the smallest size, a single word of the ingredients wider than its 590. Refuse.
  readonly tooWide: readonly ('header' | 'title' | 'word')[];
  // A width that could not be measured (a character the fonts do not hold): refuse, never guess.
  readonly unmeasurable: boolean;
  // Any of the three: the label must not be printed.
  readonly refused: boolean;
}

// The words of the ingredients, as the script reads them: split on any white space.
export function ingredientWords(text: string): string[] {
  return text.split(/\s+/u).filter(w => w !== '');
}

export function layoutLogoLabel(input: LogoLabelInput, rawMeasure: Measure): LogoLabelLayout {
  const elements: LayoutElement[] = [];
  let unmeasurable = false;
  const measure: Measure = (t, font, px) => {
    const w = rawMeasure(t, font, px);
    if (!Number.isFinite(w)) unmeasurable = true;
    return w;
  };
  const tooWide = new Set<'header' | 'title' | 'word'>();
  // Text pasted with its accents as separate marks (NFD) is brought to the composed form the fonts hold.
  const nfc = (t: string) => t.normalize('NFC');
  const text = (x: number, yDots: number, t: string, font: LabelFont, px: number) => {
    if (t !== '') elements.push({ kind: 'text', x, y: yDots * S, text: t, font, px });
  };
  const centred = (yDots: number, t: string, font: LabelFont, px: number) => {
    const w = measure(t, font, px);
    text((CANVAS_W - w) / 2, yDots, t, font, px);
    return w;
  };

  // The logo: 330 dots wide, centred, 10 dots from the top.
  const lw = input.logo.width;
  const lh = input.logo.height;
  elements.push({ kind: 'image', x: Math.floor((CANVAS_W - lw) / 2), y: 10 * S, w: lw, h: lh });
  const logoBottom = 10 + Math.floor(lh / S);

  // The header.
  for (const [i, dy] of [[0, 6], [1, 28]] as const) {
    if (centred(logoBottom + dy, nfc(input.header[i]).trim(), 'regular', BODY_PX) > CANVAS_W) tooWide.add('header');
  }

  // The rule, 4 dots (0.5 mm), from x 22 to x 618.
  const lineY = logoBottom + 57;
  elements.push({ kind: 'rect', x0: 22 * S, y0: lineY * S, x1: 618 * S, y1: (lineY + 4) * S });

  // The title: 32 px, one size smaller at a time while its widest line is wider than 596 dots, never under 20.
  const titleLines = nfc(input.title).split('|').map(r => r.trim());
  const widest = (px: number) => Math.max(...titleLines.map(r => measure(r, 'title', px)));
  let size = TITLE_MAX;
  while (size > TITLE_MIN && widest(size * S) > 596 * S) size -= 1;
  if (widest(size * S) > 596 * S) tooWide.add('title');
  const extraTitle = (titleLines.length - 1) * TITLE_LINE;

  // The ingredients, word by word, onto lines at most 590 dots wide.
  const space = measure(' ', 'regular', BODY_PX);
  const runWidth = (r: TextRun) => measure(r.text, r.bold ? 'bold' : 'regular', BODY_PX);
  const widthOf = (w: string) => runsOf(w).reduce((sum, r) => sum + runWidth(r), 0);
  const maxW = 590 * S;
  const lines: string[][] = [];
  let cur: string[] = [];
  let curW = 0;
  for (const w of ingredientWords(nfc(input.ingredients))) {
    const ww = widthOf(w);
    if (ww > maxW) tooWide.add('word');
    const add = cur.length === 0 ? ww : space + ww;
    // A word wider than a whole line starts its own line, never after an empty one (the script pushed an empty one).
    if (curW + add <= maxW || cur.length === 0) {
      cur.push(w);
      curW += add;
    } else {
      lines.push(cur);
      cur = [w];
      curW = ww;
    }
  }
  lines.push(cur);

  // The space left above y 398 is shared out: up to 20 dots between title and ingredients (a quarter of it), the rest
  // half above the title and half below the ingredients. With a long list it is about nothing and the layout is the
  // basic one (title 18 dots under the rule, ingredients 44 dots under the title).
  const minimumEnd = lineY + 62 + extraTitle + lines.length * LINE_HEIGHT;
  const free = Math.max(0, TEXT_LIMIT_Y - minimumEnd);
  const gapMiddle = Math.min(free / 4, 20);
  const gapAbove = (free - gapMiddle) / 2;
  const titleY = lineY + 18 + gapAbove;
  titleLines.forEach((r, i) => { centred(titleY + i * TITLE_LINE, r, 'title', size * S); });

  const ingredientsY = titleY + 44 + extraTitle + gapMiddle;
  let y = ingredientsY;
  for (const ln of lines) {
    let x = 25 * S;
    ln.forEach((w, i) => {
      if (i > 0) x += space;
      for (const r of runsOf(w)) {
        text(x, y, r.text, r.bold ? 'bold' : 'regular', BODY_PX);
        x += runWidth(r);
      }
    });
    y += LINE_HEIGHT;
  }
  const tooLong = y > TEXT_LIMIT_Y;

  // «PRODOTTO IL:» and the line to write the date on.
  text(27 * S, 430, input.producedOn, 'bold', SMALL_BOLD_PX);
  elements.push({ kind: 'rect', x0: 160 * S, y0: 444 * S, x1: 350 * S, y1: 446 * S });

  const wide = [...tooWide].sort();
  return {
    elements, titleLines, titleSize: size, logoBottom, lineY, titleY, ingredientsY, lines, endY: y, tooLong,
    tooWide: wide, unmeasurable, refused: tooLong || wide.length > 0 || unmeasurable,
  };
}

// ── The one word this label adds ─────────────────────────────────────────────
//
// «PRODOTTO IL:» — where the date of production is written by hand. A LABEL word: the language is the venue's
// COUNTRY's (market.outputLanguage), handed in as `lang`. Kept here and not in market.ts, which is a byte-for-byte
// port of the current app's js/market.js and must not grow words the current app does not have.
const PRODUCED_ON: Readonly<Record<string, string>> = Object.freeze({ en: 'PRODUCED ON:', it: 'PRODOTTO IL:' });

export function producedOnWord(lang: unknown): string {
  return PRODUCED_ON[String(lang)] ?? (PRODUCED_ON.en as string);
}
