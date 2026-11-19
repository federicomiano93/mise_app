// receiptPrinter.ts — a booking slip straight to the Epson FP-81 II RT on the shop's network (bookings step 3, 18 Nov 2026).
//
// The owner's choice: the tablet prints directly, with no computer in between. The printer is a fiscal one (RT), and a slip is
// NOT a receipt: it is sent as a NON-FISCAL document through Epson's own XML protocol for its fiscal printers (Fiscal ePOS-Print,
// the `fpmate.cgi` endpoint the printer serves on the network): beginNonFiscal → one printNormal per line → endNonFiscal, which
// also cuts the paper. Nothing fiscal is ever sent: no sale, no payment, no closing.
//
// ⚠️ OVER HTTPS, BECAUSE THE PAGE IS: a secure page may not call a plain http address (mixed content), so the device reaches
// https://<address>/cgi-bin/fpmate.cgi, the printer's own certificate accepted once on that device (the printer screen opens it).
// The page's policy names the address (csp-plugin.ts). WHETHER THIS MODEL ANSWERS THERE IS STEP 0 — the test page below.
//
// ⚠️ NOTHING PERSONAL LEAVES THE SHOP: the slip goes from the device to the printer on the same network; nothing is queued in
// the database and nothing is logged but the error's kind.

import { PRINTER_HOST_KEY, PRINTER_PLAIN_KEY, isPrinterHost } from './printerHost';

// A line of a slip, as the app composes it (slipText.ts): its words and how they stand out.
// 'big' is double size (bookings rebuild step 4): the customer's name, the lab slip's note, «Da pagare» — half as many characters
// a line (BIG_COLUMNS).
export type SlipStyle = 'normal' | 'bold' | 'big';
export type SlipLine = { readonly text: string; readonly style: SlipStyle };

// Characters per line on 80 mm paper at the normal font. 42 is under what the FP-81 II RT prints on 80 mm, so a line is never
// cut by the printer; the app wraps longer text itself (wrapLines).
export const COLUMNS = 42;

// A double-size line holds half as many characters.
export const BIG_COLUMNS = Math.floor(COLUMNS / 2);

// Epson's font numbers for printNormal: 1 is the normal font, 2 the bold one, 4 the double-size one.
// ⚠️ UNVERIFIED ON THE REAL FP-81 II RT (bookings rebuild step 4): 4 is Epson's double height and width in its fiscal XML as far as
// the documentation goes; whether it is also bold on this model is for the owner's test print. ⚠️ So is reverse print (white on
// black), which is why the lab slip's note is double size here instead of the highlight the browser's slip draws: a style the
// printer does not know could make it refuse the whole document. A big line is wrapped at BIG_COLUMNS, which is safe even if 4
// turns out to be double height only.
const FONT: Readonly<Record<SlipStyle, string>> = { normal: '1', bold: '2', big: '4' };

// How long the device waits for the printer before saying it did not answer.
export const PRINT_TIMEOUT_MS = 15_000;

// ── This device's setting ────────────────────────────────────────────────────

export type PrinterSetting = { readonly host: string; readonly plain: boolean };

// The printer this device prints to, or null. ⚠️ Every read and write is guarded: storage can be blocked or missing (a private
// window), and that is «no printer», never a broken screen.
export function readPrinterSetting(storage: Pick<Storage, 'getItem'> | null = safeStorage()): PrinterSetting | null {
  try {
    const host = storage?.getItem(PRINTER_HOST_KEY) ?? '';
    if (!isPrinterHost(host)) return null;
    return { host, plain: storage?.getItem(PRINTER_PLAIN_KEY) === '1' };
  } catch {
    return null;
  }
}

export function writePrinterSetting(setting: PrinterSetting | null, storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage()): boolean {
  try {
    if (storage === null) return false;
    if (setting === null) {
      storage.removeItem(PRINTER_HOST_KEY);
      storage.removeItem(PRINTER_PLAIN_KEY);
      return true;
    }
    if (!isPrinterHost(setting.host)) return false;
    storage.setItem(PRINTER_HOST_KEY, setting.host.trim());
    if (setting.plain) storage.setItem(PRINTER_PLAIN_KEY, '1'); else storage.removeItem(PRINTER_PLAIN_KEY);
    return true;
  } catch {
    return false;
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

// ── The words on paper ───────────────────────────────────────────────────────

// For a printer whose character set prints accents or € wrong: plain letters only («città» → «citta'», «€» → «EUR»).
export function plainText(text: string): string {
  return text
    .replace(/[\u00a0\u202f]/g, ' ')
    .replace(/€/g, 'EUR').replace(/£/g, 'GBP')
    .replace(/[àáâä]/g, "a'").replace(/[ÀÁÂÄ]/g, "A'")
    .replace(/[èéêë]/g, "e'").replace(/[ÈÉÊË]/g, "E'")
    .replace(/[ìíîï]/g, "i'").replace(/[ÌÍÎÏ]/g, "I'")
    .replace(/[òóôö]/g, "o'").replace(/[ÒÓÔÖ]/g, "O'")
    .replace(/[ùúûü]/g, "u'").replace(/[ÙÚÛÜ]/g, "U'")
    .replace(/[«»“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, '-').replace(/·/g, '-')
    // The slips' «2 × Scacciata» (bookings rebuild step 4): the sign is not ASCII and would be dropped.
    .replace(/×/g, 'x')
    // Any other accented letter loses its accent («ç» → «c», «ñ» → «n»), «ß» becomes «ss».
    .replace(/ß/g, 'ss').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Anything still outside plain ASCII is dropped rather than printed as rubbish.
    .replace(/[^\x20-\x7E]/g, '');
}

// Lines wrapped at `columns` (a big line at half of it), on word boundaries where there are any; an empty line stays (a gap on paper).
export function wrapLines(lines: readonly SlipLine[], columns: number = COLUMNS): SlipLine[] {
  const out: SlipLine[] = [];
  for (const line of lines) {
    // ⚠️ RUNS OF SPACES ARE KEPT: they are what puts a price against the right edge (slipText's twoColumns). Only the spaces a
    // paper cannot show as such become plain ones — a tab, a line break, and the NO-BREAK space the money is written with
    // («18,00 €»), which is not ASCII and would be dropped, or printed as rubbish, by the printer.
    const text = line.text.replace(/[\t\n\r\f\v\u00a0\u202f]/g, ' ')
      // Other control characters (a pasted note can carry them) are not allowed in XML: the printer would refuse the document.
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .trimEnd();
    if (text === '') { out.push({ text: '', style: line.style }); continue; }
    const width = line.style === 'big' ? Math.floor(columns / 2) : columns;
    let rest = text;
    while (rest.length > width) {
      const cut = rest.lastIndexOf(' ', width);
      const at = cut > 0 ? cut : width;
      out.push({ text: rest.slice(0, at).trimEnd(), style: line.style });
      rest = rest.slice(at).trimStart();
    }
    out.push({ text: rest, style: line.style });
  }
  return out;
}

const xmlAttr = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// The whole request: a SOAP envelope holding ONE non-fiscal document. The printer cuts the paper at endNonFiscal.
export function nonFiscalXml(lines: readonly SlipLine[], { plain = false, columns = COLUMNS }: { plain?: boolean; columns?: number } = {}): string {
  const printed = wrapLines(lines.map(line => ({ ...line, text: plain ? plainText(line.text) : line.text })), columns)
    // An empty printNormal is still a line feed on paper: a single space keeps it valid everywhere.
    .map(line => `<printNormal operator="1" font="${FONT[line.style]}" data="${xmlAttr(line.text === '' ? ' ' : line.text)}" />`);
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">',
    '<s:Body>',
    '<printerNonFiscal>',
    '<beginNonFiscal operator="1" />',
    ...printed,
    '<endNonFiscal operator="1" />',
    '</printerNonFiscal>',
    '</s:Body>',
    '</s:Envelope>',
  ].join('\n');
}

// ── Sending ──────────────────────────────────────────────────────────────────

// Why a print did not happen, in kinds the screen puts into words. ⚠️ No text from the printer is shown or logged: only the kind
// and Epson's own short code, which says nothing about the customer.
export type PrintOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly kind: 'no-printer' }
  // The device could not reach it at all: wrong address, another network, switched off, or its certificate not accepted yet.
  | { readonly ok: false; readonly kind: 'unreachable' }
  | { readonly ok: false; readonly kind: 'timeout' }
  // It answered and said no (out of paper, cover open, busy): Epson's code, when it gave one.
  | { readonly ok: false; readonly kind: 'refused'; readonly code: string };

export function printerUrl(host: string): string {
  return `https://${host}/cgi-bin/fpmate.cgi?devid=local_printer&timeout=10000`;
}

// The printer's answer: `<response success="true" …>` when it printed.
export function readAnswer(body: string): PrintOutcome {
  if (/<response\b[^>]*\bsuccess="true"/.test(body)) return { ok: true };
  const code = /<response\b[^>]*\bcode="([A-Za-z0-9_]{0,40})"/.exec(body)?.[1] ?? '';
  return { ok: false, kind: 'refused', code };
}

export async function sendToPrinter(
  setting: PrinterSetting | null,
  lines: readonly SlipLine[],
  fetchImpl: typeof fetch = (...args) => fetch(...args),
  timeoutMs: number = PRINT_TIMEOUT_MS,
): Promise<PrintOutcome> {
  if (setting === null) return { ok: false, kind: 'no-printer' };
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); }, timeoutMs);
  try {
    const answer = await fetchImpl(printerUrl(setting.host), {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8' },
      body: nonFiscalXml(lines, { plain: setting.plain }),
      signal: controller.signal,
      // Nothing of the app's goes to the printer: no cookies, no referrer.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    return readAnswer(await answer.text());
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, kind: 'timeout' };
    console.warn('The receipt printer could not be reached:', err instanceof Error ? err.name : 'error');
    return { ok: false, kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}

// The test page (step 0 of the bookings plan): what a slip uses — plain and bold lines, accents and €, a ruler of the width.
// Since bookings rebuild step 4 it also prints a double-size line (font 4), which both slips use: a printer that refuses that font
// refuses the test page too, so the owner finds out here, not with a real booking.
export function testPage(words: { readonly title: string; readonly bold: string; readonly big: string; readonly accents: string; readonly when: string }): SlipLine[] {
  return [
    { text: words.title, style: 'bold' },
    { text: words.when, style: 'normal' },
    { text: '', style: 'normal' },
    { text: words.bold, style: 'bold' },
    { text: words.big, style: 'big' },
    { text: words.accents, style: 'normal' },
    { text: '123456789012345678901234567890123456789012'.slice(0, COLUMNS), style: 'normal' },
  ];
}
