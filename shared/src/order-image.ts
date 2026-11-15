// order-image.ts — the order message as a PICTURE: what is drawn where. TypeScript PARTIAL port of js/orders/order-image.js
// for Mise 2 (step 3f-3, sending). Pure: no canvas, no DOM. order-image.spec.ts runs every test against BOTH files and
// compares the names, constants and shapes of what is ported (a partial port is not paired in parity.spec.ts).
//
// LEFT OUT, because they need a browser and belong to the app (app/src/orders/orderImage.ts):
//   - `FONT_FAMILY` — the picture is drawn in the app's own font (decision F of 3f-3: Geist, the one font Mise 2 bundles;
//     the current app draws in Manrope, which Mise 2 does not carry);
//   - `renderOrderImage` (the canvas), `probeFile`, `canSharePhotos` and `sharePhoto` (the File and the share sheet).
//
// The picture shows the EXACT text buildOrderMessage produced: nothing added, nothing removed. The layout is a pure function
// over a measure callback, so it is tested without a canvas.

import { labelWord } from './market';

// The same value as the current app's --text token (a canvas cannot read a var()); the current app's
// tests/order-image.test.mjs pins it to tokens.css. Ink on white is what a supplier zooms into.
export const INK = '#1F2416';
export const PAPER = '#FFFFFF';

export const IMAGE_WIDTH = 1080;
export const IMAGE_PADDING = 64;
export const FONT_SIZE = 40;
export const LINE_HEIGHT = 1.45;

export interface Run { text: string; bold: boolean }

export interface OrderLayout {
  readonly lines: Run[][];
  readonly width: number;
  readonly height: number;
  readonly step: number;
}

// «*Bold* and plain» → [{ text, bold }]. WhatsApp bold needs the asterisks to hug the text;
// a lone asterisk (a supplier named «A*B») stays a literal character.
export function parseBold(line: string): Run[] {
  const out: Run[] = [];
  const re = /\*([^*\s](?:[^*]*[^*\s])?)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false });
    out.push({ text: m[1] ?? '', bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out;
}

// Split runs into words and the spaces between them, keeping every character.
function tokens(segments: readonly Run[]): Run[] {
  const out: Run[] = [];
  segments.forEach(seg => {
    (seg.text.match(/\s+|\S+/g) || []).forEach(piece => out.push({ text: piece, bold: seg.bold }));
  });
  return out;
}

// Lay the message out. `measure(text, bold)` → width in px. Every character of every source line survives except the bold
// asterisks and the spaces a wrap swallows at a line break; a single word wider than the page is cut by character rather
// than dropped.
export function layoutOrder(text: unknown, measure: (text: string, bold: boolean) => number, {
  width = IMAGE_WIDTH, padding = IMAGE_PADDING, fontSize = FONT_SIZE, lineHeight = LINE_HEIGHT,
}: { width?: number; padding?: number; fontSize?: number; lineHeight?: number } = {}): OrderLayout {
  const room = width - padding * 2;
  const lines: Run[][] = [];

  String(text || '').split('\n').forEach(source => {
    const words = tokens(parseBold(source));
    if (!words.length) { lines.push([]); return; }

    let row: Run[] = [];
    let rowWidth = 0;
    const flush = () => {
      // Same-weight pieces are merged, so the trailing space sits inside the last piece.
      const tail = row[row.length - 1];
      if (tail) tail.text = tail.text.trimEnd();
      while (row.length && !row[row.length - 1]?.text) row.pop();
      lines.push(row);
      row = [];
      rowWidth = 0;
    };
    const push = (piece: Run) => {
      const last = row[row.length - 1];
      if (last && last.bold === piece.bold) last.text += piece.text;
      else row.push({ ...piece });
    };

    words.forEach(word => {
      const w = measure(word.text, word.bold);
      const space = /^\s+$/.test(word.text);
      if (rowWidth + w <= room) { push(word); rowWidth += w; return; }
      if (space) { if (row.length) flush(); return; }   // the wrap swallows the space
      if (row.length) flush();
      if (w <= room) { push(word); rowWidth = w; return; }
      // One word wider than the page: break it by character, nothing lost.
      let chunk = '';
      for (const ch of word.text) {
        if (chunk && measure(chunk + ch, word.bold) > room) {
          push({ text: chunk, bold: word.bold });
          flush();
          chunk = '';
        }
        chunk += ch;
      }
      push({ text: chunk, bold: word.bold });
      rowWidth = measure(chunk, word.bold);
    });
    flush();
  });

  const step = Math.round(fontSize * lineHeight);
  return { lines, width, height: padding * 2 + lines.length * step, step };
}

// The text a layout shows, line by line — what tests compare with the message.
export function plainLines(layout: { readonly lines: readonly (readonly Run[])[] }): string[] {
  return layout.lines.map(row => row.map(s => s.text).join(''));
}

// The order word of the venue's output language («order» / «ordine») plus the date: no supplier, no venue, nothing a
// forwarded file should leak.
export function imageFileName(date: Date = new Date(), language: unknown = null): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  // The dictionary holds the file word already lower case (case is never the code's to change).
  const word = String(labelWord('orderFileWord', language))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${word}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.png`;
}
