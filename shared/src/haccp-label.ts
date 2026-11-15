// haccp-label.ts — the HACCP label for what the lab makes and keeps (creams, doughs, fillings): which fields it carries,
// what each says, and WHERE everything goes on it, in the pixels of the canvas it is drawn on. NEW IN MISE 2 (no original
// in js/), so not paired; PURE, no DOM.
//
// ⚠️ ONE ENGINE FOR EVERY IMAGE LABEL. The HACCP label is drawn exactly as the «with logo» product label is: elements
// (label-image-layout's `LayoutElement`) on a canvas four times the label, in the same three faces measured with the
// same table (label-image-fonts), reduced and cut to black and white by the same code (label-image-raster). Only the
// arrangement below is its own. Nothing of the product label is copied here.
//
// ⚠️⚠️ EVERY FIELD IS OPTIONAL, IN THREE STATES (Federico, 25 Oct 2026): off, printed, or a blank line to write on by
// hand. A printed field whose value is empty prints its blank line instead: a label is never blocked for a box nobody
// filled, and never prints a caption with nothing after it.
//
// ⚠️⚠️ TOO LONG OR TOO WIDE IS REFUSED, NEVER SHRUNK AND NEVER CUT — as the product label. The body is set at the
// product label's size (18.3 dots, an «x» of 1.25 mm), the smallest a person reads at arm's length in a cold room; a label
// with every field on does not fit a small size, and the screen says which choice to change.
//
// ⚠️ THE WORDS OF THE LABEL ARE THE COUNTRY'S (`lang` = market.outputLanguage), never the interface's: the label is read
// in the lab, whatever language the phone that printed it is set to. Words the product label already has come from
// market.labelWord (use by, storage, may contain); the rest live here, because market.ts is a byte-for-byte port of the
// current app's js/market.js and must not grow words the current app does not have.

import { dateText } from './label-template-model';
import { BODY_PX, S, TITLE_MAX, TITLE_MIN } from './label-image-layout';
import type { LabelFont, LayoutElement, Measure } from './label-image-layout';
import { labelWord } from './market';

// ── The fields and their states ──────────────────────────────────────────────

// In the order they are printed. The allergens come last because theirs is the one value that runs over several lines.
export const HACCP_FIELDS = [
  'name', 'preparedOn', 'useBy', 'lot', 'preparedBy', 'storage',
  'blastChilledOn', 'frozenOn', 'openedOn', 'quantity', 'allergens',
] as const;
export type HaccpField = (typeof HACCP_FIELDS)[number];

export const HACCP_STATES = ['off', 'print', 'blank'] as const;
export type HaccpState = (typeof HACCP_STATES)[number];

// What a venue that never opened the card gets: the four fields every HACCP label carries, everything else off.
// ⚠️ `preparedBy` IS OFF BY DEFAULT ON PURPOSE: it puts a person's first name on paper stuck to food (P13). It is printed
// only once somebody who runs the place has switched it on.
export const HACCP_DEFAULTS: Readonly<Record<HaccpField, HaccpState>> = Object.freeze({
  name: 'print',
  preparedOn: 'print',
  useBy: 'print',
  lot: 'off',
  preparedBy: 'off',
  storage: 'off',
  blastChilledOn: 'off',
  frozenOn: 'off',
  openedOn: 'off',
  quantity: 'off',
  allergens: 'print',
});

// The fields whose value is a date typed (or left as today) on the label screen.
export const HACCP_DATE_FIELDS = ['preparedOn', 'blastChilledOn', 'frozenOn', 'openedOn'] as const;
export type HaccpDateField = (typeof HACCP_DATE_FIELDS)[number];
// The fields whose value is a text typed on the label screen (storage starts from the recipe's own text).
export const HACCP_TEXT_FIELDS = ['lot', 'preparedBy', 'storage', 'quantity'] as const;
export type HaccpTextField = (typeof HACCP_TEXT_FIELDS)[number];
// The boxes' bound: a value longer than this is a mistake, not a label (the rules bound the recipe's storage at 200).
export const HACCP_TEXT_MAX = 80;

// ── The sizes ────────────────────────────────────────────────────────────────
//
// ⚠️ A CLOSED SET OF SIZES, NOT TWO MILLIMETRE BOXES. The print dialog takes the page size from a STATIC stylesheet (the
// page's CSP forbids style built at run time), so every size is one small page file in the app; and the lab printer is
// not chosen yet — step 2b adds its size if it is none of these. All landscape, width × height.
export const HACCP_SIZES = ['40x30', '50x30', '60x40', '62x29', '80x60'] as const;
export type HaccpSize = (typeof HACCP_SIZES)[number];
export const HACCP_DEFAULT_SIZE: HaccpSize = '60x40';

// 203 dpi: 8 dots to the millimetre, as the product label.
export const DOTS_PER_MM = 8;

export function haccpSizeMm(size: HaccpSize): { readonly width: number; readonly height: number } {
  const [w, h] = size.split('x').map(Number) as [number, number];
  return { width: w, height: h };
}

export function haccpSizeDots(size: HaccpSize): { readonly width: number; readonly height: number } {
  const mm = haccpSizeMm(size);
  return { width: mm.width * DOTS_PER_MM, height: mm.height * DOTS_PER_MM };
}

// ── The settings, as config/labels holds them ────────────────────────────────

export interface HaccpSettings {
  readonly fields: Readonly<Record<HaccpField, HaccpState>>;
  readonly size: HaccpSize;
  // The one category the HACCP list shows, as stored; null = every recipe. Whether the word is still on the venue's list
  // is `haccpListCategory`'s question.
  readonly category: string | null;
}

// ⚠️ EVERY KEY IS READ ON ITS OWN, AND ANYTHING THE APP DOES NOT KNOW IS THE DEFAULT: a field id from a later build is
// ignored, a state nobody has heard of is that field's default (never «off»: the allergens must not vanish from the label
// because of a typo in a document), a size not in the set is the default size.
export function haccpSettingsOf(labelConfig: unknown): HaccpSettings {
  const held = labelConfig && typeof labelConfig === 'object' ? labelConfig as Record<string, unknown> : {};
  const stored = held.haccpFields && typeof held.haccpFields === 'object' && !Array.isArray(held.haccpFields)
    ? held.haccpFields as Record<string, unknown>
    : {};
  const fields = {} as Record<HaccpField, HaccpState>;
  for (const field of HACCP_FIELDS) {
    const value = stored[field];
    fields[field] = (HACCP_STATES as readonly unknown[]).includes(value) ? value as HaccpState : HACCP_DEFAULTS[field];
  }
  const size = (HACCP_SIZES as readonly unknown[]).includes(held.haccpSize) ? held.haccpSize as HaccpSize : HACCP_DEFAULT_SIZE;
  const category = typeof held.haccpCategory === 'string' && held.haccpCategory.trim() !== '' ? held.haccpCategory : null;
  return { fields, size, category };
}

// The category the HACCP list is narrowed to, or null for every recipe. A word taken off the venue's list reads as «every
// recipe» — as a removed category reads as «no category» on a recipe (recipe-shelf) — so deleting a category can never
// leave the lab with an empty HACCP list it cannot explain.
export function haccpListCategory(settings: HaccpSettings, venueCategories: readonly string[]): string | null {
  return settings.category !== null && venueCategories.includes(settings.category) ? settings.category : null;
}

// ── The words of the label ───────────────────────────────────────────────────

const WORDS: Readonly<Record<'en' | 'it', Readonly<Record<string, string>>>> = Object.freeze({
  en: Object.freeze({
    name: 'Product',
    preparedOn: 'Prepared on',
    lot: 'Lot',
    preparedBy: 'Prepared by',
    blastChilledOn: 'Blast-chilled on',
    frozenOn: 'Frozen on',
    openedOn: 'Opened on',
    quantity: 'Quantity',
    allergens: 'Allergens',
  }),
  it: Object.freeze({
    name: 'Prodotto',
    preparedOn: 'Preparato il',
    lot: 'Lotto',
    preparedBy: 'Preparato da',
    blastChilledOn: 'Abbattuto il',
    frozenOn: 'Congelato il',
    openedOn: 'Aperto il',
    quantity: 'Quantità',
    allergens: 'Allergeni',
  }),
});

// A field's caption on the label, in the label's language (English for a language this file does not know).
export function haccpCaption(field: HaccpField, lang: unknown): string {
  if (field === 'useBy') return labelWord('useBy', lang);
  if (field === 'storage') return labelWord('storage', lang);
  const table = lang === 'it' ? WORDS.it : WORDS.en;
  return table[field] ?? (WORDS.en[field] as string);
}

// ── What the label says ──────────────────────────────────────────────────────

// The values of one print, as the label screen holds them. Dates are local days (null = none); texts as typed.
export interface HaccpValues {
  readonly name: string;
  readonly preparedOn: Date | null;
  readonly useBy: Date | null;
  readonly lot: string;
  readonly preparedBy: string;
  readonly storage: string;
  readonly blastChilledOn: Date | null;
  readonly frozenOn: Date | null;
  readonly openedOn: Date | null;
  readonly quantity: string;
  // The allergens and the traces, already NAMED in the label's language (market.allergenName). `allergens` null = the
  // recipe is not fully declared: the screen refuses the label before it gets here when the field is printed.
  readonly allergens: readonly string[] | null;
  readonly mayContain: readonly string[];
}

// One row of the label: a caption and its value, or a blank line to write on (`value` null).
export interface HaccpRow {
  readonly field: HaccpField;
  readonly caption: string;
  readonly value: string | null;
  // The allergens are printed in bold capitals, as on the product label.
  readonly bold: boolean;
}

export interface HaccpContent {
  // The recipe's name, large at the top; null when the name is off or a blank line.
  readonly title: string | null;
  readonly rows: readonly HaccpRow[];
}

const clean = (text: string): string => text.normalize('NFC').replace(/\s+/gu, ' ').trim();

export function haccpContent(
  fields: Readonly<Record<HaccpField, HaccpState>>, values: HaccpValues, lang: unknown,
): HaccpContent {
  let title: string | null = null;
  const rows: HaccpRow[] = [];
  const row = (field: HaccpField, value: string | null, bold = false, caption = haccpCaption(field, lang)) => {
    rows.push({ field, caption, value: value === null || value === '' ? null : value, bold });
  };
  const date = (d: Date | null): string | null => (d === null ? null : dateText(d, lang) || null);

  for (const field of HACCP_FIELDS) {
    const state = fields[field];
    if (state === 'off') continue;
    if (state === 'blank') {
      row(field, null);
      continue;
    }
    switch (field) {
      case 'name': {
        // An empty name cannot be a title: it falls back to the blank line, like every printed field left empty.
        const name = clean(values.name);
        if (name === '') row(field, null);
        else title = name;
        break;
      }
      case 'preparedOn':
      case 'useBy':
      case 'blastChilledOn':
      case 'frozenOn':
      case 'openedOn':
        row(field, date(values[field]));
        break;
      case 'lot':
      case 'preparedBy':
      case 'storage':
      case 'quantity':
        row(field, clean(values[field]));
        break;
      case 'allergens': {
        if (values.allergens === null) {
          row(field, null);
          break;
        }
        const upper = (list: readonly string[]) => list.map(name => clean(name).toLocaleUpperCase(lang === 'it' ? 'it' : 'en'));
        row(field, values.allergens.length === 0 ? labelWord('noneOfThe14', lang) : upper(values.allergens).join(', '), true);
        if (values.mayContain.length > 0) {
          row(field, upper(values.mayContain).join(', '), true, labelWord('mayContain', lang));
        }
        break;
      }
    }
  }
  return { title, rows };
}

// The lot as most labs write it: the day it was made, as digits, day first (26/10/2026 → 261026).
export function lotFromDate(date: Date | null): string {
  if (date === null || Number.isNaN(date.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getDate())}${two(date.getMonth() + 1)}${two(date.getFullYear() % 100)}`;
}

// A day typed in a date box (YYYY-MM-DD) as that day at local midnight, or null; and back.
export function dateFromInput(text: unknown): Date | null {
  if (typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(y, m - 1, d);
  // 2026-02-31 would roll over into March: not a day anybody typed.
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

export function inputFromDate(date: Date | null): string {
  if (date === null || Number.isNaN(date.getTime())) return '';
  const two = (n: number) => String(n).padStart(2, '0');
  return `${String(date.getFullYear()).padStart(4, '0')}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
}

// The first name the roster holds for a person (locations/{lid}/members/{uid}.firstName), or '' — only the first word, so
// a double name typed into one box does not run along the label.
export function firstNameOf(member: unknown): string {
  if (!member || typeof member !== 'object') return '';
  const first = (member as Record<string, unknown>).firstName;
  if (typeof first !== 'string') return '';
  return clean(first).split(' ')[0]?.slice(0, HACCP_TEXT_MAX) ?? '';
}

// ── Where everything goes ────────────────────────────────────────────────────
//
// In DOTS unless said otherwise (x positions and widths are canvas pixels, S × dots, as the product label's layout).

export const HACCP_MARGIN = 16; // 2 mm all round
export const ROW = 25; // a line of text, as the product label's ingredients
export const BLANK_ROW = 40; // a line to write on: 5 mm, room for a pen
const BLANK_TEXT_DROP = BLANK_ROW - ROW; // the caption sits at the bottom of its tall row, beside the line
// ⚠️ THE SHORTEST LINE SOMEBODY CAN WRITE ON: 22 mm, room for a date (26/10/2026) or a short name by hand. A long caption on a
// narrow label left a few millimetres beside it; below this the line goes under the caption, the whole label's width.
export const MIN_WRITE = 176;
const BODY_ASCENT = 17; // DejaVu Sans at the body size, top of the ascender to the baseline (label-image-metrics: 68 px)
const RULE = 2; // the rule under the name, and the line to write on
const TITLE_GAP = 6; // between the name's last line and the rule, and between the rule and the first row

export interface HaccpLayout {
  readonly elements: readonly LayoutElement[];
  // The canvas, in canvas pixels (S × the label's dots).
  readonly width: number;
  readonly height: number;
  readonly titleLines: readonly string[];
  readonly titleSize: number;
  // Where the last row ends, in dots.
  readonly endY: number;
  // The rows run past the bottom margin: refuse.
  readonly tooLong: boolean;
  // Text that would run off the label sideways: the name still too wide on two lines at the smallest size, a caption or
  // a single word wider than the label. Refuse.
  readonly tooWide: readonly ('title' | 'caption' | 'word')[];
  // A width that could not be measured (a character the fonts do not hold): refuse, never guess.
  readonly unmeasurable: boolean;
  // Every field is off (or there is nothing at all to print): refuse — an empty label is not a label.
  readonly empty: boolean;
  readonly refused: boolean;
}

// The name on one line at the largest size that fits; failing that, on two lines split where the wider half is
// narrowest, at the largest size that fits. Never smaller than the product label's smallest title.
function fitTitle(title: string, innerW: number, measure: Measure): { lines: string[]; size: number; fits: boolean } {
  const width = (t: string, size: number) => measure(t, 'title', size * S);
  for (let size = TITLE_MAX; size >= TITLE_MIN; size--) {
    if (width(title, size) <= innerW) return { lines: [title], size, fits: true };
  }
  const words = title.split(' ');
  if (words.length > 1) {
    for (let size = TITLE_MAX; size >= TITLE_MIN; size--) {
      let best: { lines: string[]; widest: number } | null = null;
      for (let i = 1; i < words.length; i++) {
        const lines = [words.slice(0, i).join(' '), words.slice(i).join(' ')];
        const widest = Math.max(...lines.map(l => width(l, size)));
        if (widest <= innerW && (best === null || widest < best.widest)) best = { lines, widest };
      }
      if (best !== null) return { lines: best.lines, size, fits: true };
    }
  }
  return { lines: [title], size: TITLE_MIN, fits: false };
}

export function layoutHaccpLabel(content: HaccpContent, size: HaccpSize, rawMeasure: Measure): HaccpLayout {
  const dots = haccpSizeDots(size);
  const W = dots.width * S;
  const elements: LayoutElement[] = [];
  let unmeasurable = false;
  const measure: Measure = (t, font, px) => {
    const w = rawMeasure(t, font, px);
    if (!Number.isFinite(w)) unmeasurable = true;
    return w;
  };
  const tooWide = new Set<'title' | 'caption' | 'word'>();
  const left = HACCP_MARGIN * S;
  const innerW = (dots.width - 2 * HACCP_MARGIN) * S;
  const text = (x: number, yDots: number, t: string, font: LabelFont, px: number) => {
    if (t !== '') elements.push({ kind: 'text', x, y: yDots * S, text: t, font, px });
  };
  // A filled band `h` dots tall from x0 to x1 (canvas pixels, x1 excluded), its top at yDots: Pillow's rectangle
  // includes both corners, so the last pixel is one before the next band.
  const band = (x0: number, x1: number, yDots: number, h: number) => {
    elements.push({ kind: 'rect', x0, y0: yDots * S, x1: x1 - 1, y1: (yDots + h) * S - 1 });
  };

  let y = HACCP_MARGIN;
  let titleLines: string[] = [];
  let titleSize = 0;
  if (content.title !== null) {
    const fit = fitTitle(content.title, innerW, measure);
    if (!fit.fits) tooWide.add('title');
    titleLines = fit.lines;
    titleSize = fit.size;
    // The product label's own spacing: 34 dots between two lines of a 32-dot title, in proportion below it.
    const advance = Math.round((fit.size * 34) / 32);
    for (const line of fit.lines) {
      text((W - measure(line, 'title', fit.size * S)) / 2, y, line, 'title', fit.size * S);
      y += advance;
    }
    if (content.rows.length > 0) {
      band(left, W - left, y + TITLE_GAP - RULE, RULE);
      y += TITLE_GAP + TITLE_GAP;
    }
  }

  const space = measure(' ', 'regular', BODY_PX);
  for (const row of content.rows) {
    const caption = `${row.caption}:`;
    const captionW = measure(caption, 'bold', BODY_PX);
    if (captionW > innerW) tooWide.add('caption');
    if (row.value === null) {
      // The caption at the bottom of a tall row, and the line to write on from after it to the right margin, just under
      // the caption's baseline — or, with less than MIN_WRITE left beside the caption, the caption on a row of its own and
      // the line on the next, from margin to margin.
      const lineStart = left + captionW + space;
      if (W - left - lineStart >= MIN_WRITE * S) {
        const top = y + BLANK_TEXT_DROP;
        text(left, top, caption, 'bold', BODY_PX);
        band(lineStart, W - left, top + BODY_ASCENT + 2, RULE);
      } else {
        text(left, y, caption, 'bold', BODY_PX);
        y += ROW;
        band(left, W - left, y + BLANK_TEXT_DROP + BODY_ASCENT + 2, RULE);
      }
      y += BLANK_ROW;
      continue;
    }
    // The caption, then the value word by word: on after the caption while it fits, then on lines of its own from the
    // left margin.
    text(left, y, caption, 'bold', BODY_PX);
    const font: LabelFont = row.bold ? 'bold' : 'regular';
    let x = left + captionW;
    for (const word of row.value.split(' ').filter(w => w !== '')) {
      const ww = measure(word, font, BODY_PX);
      if (ww > innerW) tooWide.add('word');
      if (x + space + ww > W - left && x > left) {
        y += ROW;
        x = left;
        text(x, y, word, font, BODY_PX);
        x += ww;
      } else {
        text(x + space * (x > left ? 1 : 0), y, word, font, BODY_PX);
        x += space * (x > left ? 1 : 0) + ww;
      }
    }
    y += ROW;
  }

  const empty = content.title === null && content.rows.length === 0;
  const tooLong = y > dots.height - HACCP_MARGIN;
  const wide = [...tooWide].sort();
  return {
    elements, width: W, height: dots.height * S, titleLines, titleSize, endY: y, tooLong, tooWide: wide, unmeasurable, empty,
    refused: empty || tooLong || wide.length > 0 || unmeasurable,
  };
}
