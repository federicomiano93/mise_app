// order-image.js — the order message as a PICTURE, shared through the phone's own share sheet.
//
// ⚠️⚠️ THIS IS THE ONE PLACE navigator.share() AND A File LIVE. Until 7 Oct 2026 the owner's
// rule was «one mechanism, wa.me, everywhere» (js/send-sheet.js, js/share.js). He reversed it
// for the ORDER IMAGE ONLY: a supplier who receives a picture can open it and zoom, which a
// WhatsApp text bubble does not allow. tests/one-send-arrow.test.mjs allows exactly this file.
// There is still no blob: URL and no download anywhere — a File handed to navigator.share()
// needs neither, so the CSP (`default-src 'self'`) is untouched; canvas and the self-hosted
// fonts need nothing from it either.
//
// The picture shows the EXACT text buildOrderMessage produced: nothing added, nothing removed.
// The layout is a pure function over a measure callback, so it is tested without a canvas.

import { labelWord } from '../market.js';

// Same value as --text in tokens.css (a canvas cannot read a var()); tests/order-image.test.mjs
// pins the two together.
export const INK = '#1F2416';
export const PAPER = '#FFFFFF';
export const FONT_FAMILY = "'Manrope', sans-serif";

export const IMAGE_WIDTH = 1080;
export const IMAGE_PADDING = 64;
export const FONT_SIZE = 40;
export const LINE_HEIGHT = 1.45;

// «*Bold* and plain» → [{ text, bold }]. WhatsApp bold needs the asterisks to hug the text;
// a lone asterisk (a supplier named «A*B») stays a literal character.
export function parseBold(line) {
  const out = [];
  const re = /\*([^*\s](?:[^*]*[^*\s])?)\*/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ text: line.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last), bold: false });
  return out;
}

// Split runs into words and the spaces between them, keeping every character.
function tokens(segments) {
  const out = [];
  segments.forEach(seg => {
    (seg.text.match(/\s+|\S+/g) || []).forEach(piece => out.push({ text: piece, bold: seg.bold }));
  });
  return out;
}

// Lay the message out. `measure(text, bold)` → width in px. Returns
// { lines: [[{ text, bold }]], width, height, step }. Every character of every source line
// survives except the bold asterisks and the spaces a wrap swallows at a line break; a single
// word wider than the page is cut by character rather than dropped.
export function layoutOrder(text, measure, {
  width = IMAGE_WIDTH, padding = IMAGE_PADDING, fontSize = FONT_SIZE, lineHeight = LINE_HEIGHT,
} = {}) {
  const room = width - padding * 2;
  const lines = [];

  String(text || '').split('\n').forEach(source => {
    const words = tokens(parseBold(source));
    if (!words.length) { lines.push([]); return; }

    let row = [];
    let rowWidth = 0;
    const flush = () => {
      // Same-weight pieces are merged, so the trailing space sits inside the last piece.
      if (row.length) row[row.length - 1].text = row[row.length - 1].text.trimEnd();
      while (row.length && !row[row.length - 1].text) row.pop();
      lines.push(row);
      row = [];
      rowWidth = 0;
    };
    const push = piece => {
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
export function plainLines(layout) {
  return layout.lines.map(row => row.map(s => s.text).join(''));
}

// The order word of the venue's output language («order» / «ordine») plus the date: no
// supplier, no venue, nothing a forwarded file should leak.
export function imageFileName(date = new Date(), language = null) {
  const pad = n => String(n).padStart(2, '0');
  // The dictionary holds the file word already lower case (case is never the code's to change).
  const word = String(labelWord('orderFileWord', language))
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${word}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.png`;
}

// Draw it. Browser only. Fonts are awaited first, or the canvas silently draws in a fallback.
export async function renderOrderImage(text, { date = new Date(), language = null } = {}) {
  await Promise.all([
    document.fonts.load(`400 ${FONT_SIZE}px Manrope`, text),
    document.fonts.load(`800 ${FONT_SIZE}px Manrope`, text),
  ]);
  const font = bold => `${bold ? 800 : 400} ${FONT_SIZE}px ${FONT_FAMILY}`;

  const probe = document.createElement('canvas').getContext('2d');
  const measure = (s, bold) => { probe.font = font(bold); return probe.measureText(s).width; };
  const layout = layoutOrder(text, measure);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = INK;
  ctx.textBaseline = 'alphabetic';

  layout.lines.forEach((row, i) => {
    let x = IMAGE_PADDING;
    const baseline = IMAGE_PADDING + i * layout.step + Math.round(FONT_SIZE * 1.05);
    row.forEach(seg => {
      ctx.font = font(seg.bold);
      ctx.fillText(seg.text, x, baseline);
      x += ctx.measureText(seg.text).width;
    });
  });

  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas gave no picture');
  return new File([blob], imageFileName(date, language), { type: 'image/png' });
}

// A tiny real PNG (1×1) used only to ask the browser «can you share a png file?».
export function probeFile() {
  const bytes = Uint8Array.from(atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg=='),
    c => c.charCodeAt(0));
  return new File([bytes], 'probe.png', { type: 'image/png' });
}

export function canSharePhotos(nav = typeof navigator === 'undefined' ? null : navigator,
                               makeProbe = probeFile) {
  try {
    return !!(nav && typeof nav.canShare === 'function' && typeof nav.share === 'function'
      && nav.canShare({ files: [makeProbe()] }));
  } catch { return false; }
}

// 'shared' (the promise resolved), 'cancelled' (the person closed the sheet — nothing marked,
// nothing said) or 'failed' (anything else — the caller falls back to text).
export async function sharePhoto(file, nav = navigator) {
  try {
    await nav.share({ files: [file] });
    return 'shared';
  } catch (err) {
    return err && err.name === 'AbortError' ? 'cancelled' : 'failed';
  }
}
