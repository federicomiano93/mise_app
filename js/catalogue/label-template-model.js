// label-template-model.js — how much of a label FITS on a piece of paper, and at
// what size. PURE, asserted under Node (P15): no DOM, no Firestore, no dictionary.
//
// ⚠️⚠️ THE ONE RULE THIS FILE EXISTS TO ENFORCE: AN INGREDIENT LIST THAT DOES NOT
// FIT IS NEVER SILENTLY SHORTENED. Text shrinks, down to a floor the law sets, and
// below that floor the answer is «this will not fit», never a list with the end
// missing. A truncated allergen line is worse than no label at all — it reads as a
// finished declaration and it is a lie about what is in somebody's food. Same shape
// as canLabel() refusing an undeclared recipe, and for the same reason.
//
// ⚠️ WHAT THIS FILE DOES NOT DECIDE: what the label SAYS. That is
// recipe-label-model.js, which owns the ingredient order the regulation asks for and
// which words carry an allergen. This file only lays those words out.
//
// ⚠️ AND IT DOES NOT DECIDE WHETHER TO PRINT EITHER — read on, at FITTING.

import { containsLine, mayContainLine } from './recipe-label-model.js';
import { labelWord } from '../market.js';

// ── The paper ────────────────────────────────────────────────────────────────

// The stock a venue is most likely to have. Anything else is typed in as
// millimetres, so this list is a convenience, never a limit.
export const LABEL_SIZES = Object.freeze([
  { id: 'p76x51', widthMm: 76, heightMm: 51 },
  { id: 'p57x32', widthMm: 57, heightMm: 32 },
  { id: 'p102x76', widthMm: 102, heightMm: 76 },
]);

export const DEFAULT_SIZE_ID = 'p76x51';

const MIN_MM = 20;      // smaller than this is not a food label, it is a typo
const MAX_MM = 300;

// ── The floor, which is the law's and not ours ───────────────────────────────
//
// ⚠️ THE REGULATION MEASURES THE x-HEIGHT, NOT THE POINT SIZE — the height of a
// lower-case «x», which is what the eye actually reads. Mandatory particulars must
// be printed at an x-height of at least 1.2 mm, dropping to 0.9 mm when the
// package's largest surface is under 80 cm². A 76 × 51 mm label is 38.8 cm², so it
// is the smaller floor that applies to the stock this venue uses.
//
// ⚠️ EVERYTHING ON A PPDS LABEL IS A MANDATORY PARTICULAR — the name and the
// ingredient list both — so the floor applies to the SMALLEST text on it, which is
// why it is measured against the ingredient block and not against the title.
const X_HEIGHT_MM = 1.2;
const X_HEIGHT_SMALL_PACK_MM = 0.9;
const SMALL_PACK_CM2 = 80;

// x-height as a fraction of the font size, for a humanist sans of the kind this app
// sets its labels in. Stated as a constant rather than guessed at each call site,
// because it is the number that turns the law's millimetres into a font size.
const X_HEIGHT_EM = 0.52;

// Average glyph advance as a fraction of the font size. Used only to ESTIMATE how
// many words fit on a line — see FITTING below for why an estimate is honest here.
const AVG_GLYPH_EM = 0.52;

const LINE_HEIGHT = 1.28;

// The gap under each block, in multiples of its own font size, so spacing shrinks
// with the text instead of eating the label when the text gets small.
const BLOCK_GAP_EM = 0.45;

// How much bigger or smaller than the base each block is set. The product name has
// to be findable at arm's length; the traces line is the least of the four.
const BLOCK_SCALE = Object.freeze({
  name: 1.35,
  ingredients: 1,
  contains: 1.05,
  mayContain: 0.9,
  // ⚠️ THE NET QUANTITY AND THE DATE ARE NOT FOOTNOTES. Both are mandatory
  // particulars on a full label and both are things a person actually looks for, so
  // neither is set smaller than the ingredient list. Only the address is, because
  // nobody reads it at arm's length and it is the longest thing on the label.
  netWeight: 1,
  date: 1,
  storage: 0.9,
  business: 0.82,
});

// ⚠️ THE ORDER IS THE ONE A LABEL IS READ IN, AND IT IS NOT A PREFERENCE. The name
// says what the food is, the list says what is in it, the two allergen lines
// summarise that list, and then come the particulars a full label carries: how much
// of it there is, until when, how to keep it, and who made it. Anybody adding a
// block puts it where it BELONGS in that reading, not at the end.
export const BLOCK_ROLES = Object.freeze([
  'name', 'ingredients', 'contains', 'mayContain',
  'netWeight', 'date', 'storage', 'business',
]);

// ── The profile ──────────────────────────────────────────────────────────────
//
// What a venue has chosen: the paper, the printer, and which of the optional blocks
// it wants. Stored at locations/{lid}/config/labels.
//
// ⚠️ EVERY DEFAULT HERE IS THE SAFE ANSWER, not the tidy one. A document that failed
// to load, a field nobody has written yet and a corrupt value all have to leave a
// venue printing what it has always printed — the same direction venue-features.js
// takes, and for the same reason.
export const DEFAULT_PROFILE = Object.freeze({
  widthMm: 76,
  heightMm: 51,
  marginMm: 2.5,
  baseFontMm: 2.6,
  dpi: 203,
  printerLanguage: 'os',
  // ⚠️⚠️ EVERY ONE OF THE FULL-LABEL BLOCKS IS OFF, AND EMPTY, BY DEFAULT. That is
  // what let this ship without asking anybody a question: a venue that sells only
  // over its own counter needs the PPDS minimum — the name and the ingredients with
  // the allergens emphasised — and its labels come out byte-identical to the day
  // before. Nothing here changes a label until somebody switches it on.
  showDate: false,
  showWeight: false,
  showStorage: false,
  showBusiness: false,
  // ⚠️ «Use by» is a SAFETY statement and «best before» is a quality one. The
  // default is the stricter of the two on purpose: a quality date read as a safety
  // one wastes food, and a safety date read as a quality one is somebody eating
  // something they should not have. The settings screen explains the difference
  // rather than leaving it to be guessed.
  dateKind: 'useBy',
  storageText: '',
  businessName: '',
  businessAddress: '',
});

export const DATE_KINDS = Object.freeze(['useBy', 'bestBefore']);

// The longest a free-typed line may be. Generous, and bounded: these end up in a
// Firestore document and on a piece of paper, and neither wants a novel.
const MAX_TEXT = 200;

function text(value, max = MAX_TEXT) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export const PRINTER_LANGUAGES = Object.freeze(['os', 'zpl']);
export const DPI_CHOICES = Object.freeze([203, 300]);

function num(value, fallback, min, max) {
  // ⚠️ A BOOLEAN IS NOT A NUMBER, whatever Number() says about it. Number(true) is
  // 1, which would quietly turn a corrupt flag into a 1 mm label.
  if (typeof value !== 'number' && typeof value !== 'string') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) return fallback;
  return n;
}

// A stored document (or null, before anybody has saved one) → the profile the
// screens use.
export function normalizeLabelProfile(doc) {
  const d = DEFAULT_PROFILE;
  return {
    widthMm: num(doc && doc.widthMm, d.widthMm, MIN_MM, MAX_MM),
    heightMm: num(doc && doc.heightMm, d.heightMm, MIN_MM, MAX_MM),
    marginMm: num(doc && doc.marginMm, d.marginMm, 0, 20),
    baseFontMm: num(doc && doc.baseFontMm, d.baseFontMm, 1, 20),
    dpi: DPI_CHOICES.includes(doc && doc.dpi) ? doc.dpi : d.dpi,
    printerLanguage: PRINTER_LANGUAGES.includes(doc && doc.printerLanguage)
      ? doc.printerLanguage : d.printerLanguage,
    // ⚠️ === true, NOT !== false. The date is the one block that can print something
    // FALSE — a shelf life nobody chose — so it stays off until somebody switches it
    // on. The allergen blocks take the opposite direction, above.
    showDate: !!(doc && doc.showDate === true),
    // ⚠️ === true FOR ALL FOUR, like showDate and for the same reason: these blocks
    // can print something FALSE — a weight nobody weighed, an address that has
    // moved — so they stay off until somebody says otherwise. That is the OPPOSITE
    // direction from the allergen switches, which default ON because their failure
    // is somebody in hospital rather than a wrong line on a sticker.
    showWeight: !!(doc && doc.showWeight === true),
    showStorage: !!(doc && doc.showStorage === true),
    showBusiness: !!(doc && doc.showBusiness === true),
    dateKind: DATE_KINDS.includes(doc && doc.dateKind) ? doc.dateKind : d.dateKind,
    storageText: text(doc && doc.storageText),
    businessName: text(doc && doc.businessName),
    businessAddress: text(doc && doc.businessAddress),
  };
}

// ── How much of it there is ──────────────────────────────────────────────────
//
// ⚠️ THE NUMBER FORMAT FOLLOWS THE COUNTRY, NOT THE SCREEN, exactly as the words do.
// «1.2 kg» in Italy is «1,2 kg», and a decimal point read as a thousands separator
// is a label claiming a thousand times the weight. The locale table is local because
// this file may not import the dictionary — see tests/i18n-label-separation.
const LOCALE = Object.freeze({ en: 'en-GB', it: 'it-IT' });

export function netWeightText(grams, lang = 'en') {
  const g = Number(grams);
  if (!Number.isFinite(g) || g <= 0) return '';
  const locale = LOCALE[lang] || LOCALE.en;
  // Under a kilo it is grams and whole numbers; above it, kilos to one decimal —
  // which is how a scale reads and how a label is written.
  if (g < 1000) return `${new Intl.NumberFormat(locale).format(Math.round(g))} g`;
  const kg = Math.round(g / 100) / 10;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(kg)} kg`;
}

// ── Until when ───────────────────────────────────────────────────────────────
//
// ⚠️ THE DATE IS WORKED OUT FROM THE DAY IT IS PRINTED, never stored on the recipe.
// A recipe knows how long the food keeps; only the morning knows when it was made.
export function useByDate(shelfLifeDays, madeOn = new Date()) {
  // ⚠️⚠️ A SHELF LIFE NOBODY SET IS NOT ZERO DAYS. `Number(null)` is 0 and `Number('')`
  // is 0, so the first version answered TODAY for a recipe that had never been given
  // one — printing today's date as a USE BY, which is a safety statement about food
  // that may keep for a week. Caught by a test, and it is the reason this check comes
  // before the arithmetic rather than after it.
  if (typeof shelfLifeDays !== 'number' && typeof shelfLifeDays !== 'string') return null;
  if (typeof shelfLifeDays === 'string' && !shelfLifeDays.trim()) return null;
  const days = Math.floor(Number(shelfLifeDays));
  if (!Number.isFinite(days) || days < 0 || days > 3650) return null;
  const base = madeOn instanceof Date ? madeOn : new Date(madeOn);
  if (Number.isNaN(base.getTime())) return null;
  const out = new Date(base.getTime());
  out.setDate(out.getDate() + days);
  return out;
}

export function dateText(date, lang = 'en') {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const locale = LOCALE[lang] || LOCALE.en;
  // ⚠️ DAY / MONTH / YEAR, ALL NUMERIC, AND FOUR-DIGIT. Both countries this app
  // sells in read dates that way round; a month name would have to be translated
  // and a two-digit year is ambiguous on food that keeps for a year.
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

// Which named page a size maps to, so label-print.css can carry a static @page rule
// per preset and only a custom size needs one built at runtime.
export function sizeIdFor(profile) {
  const p = normalizeLabelProfile(profile);
  const found = LABEL_SIZES.find(s => s.widthMm === p.widthMm && s.heightMm === p.heightMm);
  return found ? found.id : null;
}

// The legal floor for THIS piece of paper, in millimetres of font size.
//
// ⚠️ THE AREA DECIDES WHICH FLOOR, and it is the label's own area — the surface a
// person reads the declaration on.
export function minFontMm(profile) {
  const p = normalizeLabelProfile(profile);
  const cm2 = (p.widthMm * p.heightMm) / 100;
  const xHeight = cm2 < SMALL_PACK_CM2 ? X_HEIGHT_SMALL_PACK_MM : X_HEIGHT_MM;
  return round2(xHeight / X_HEIGHT_EM);
}

// ── The blocks ───────────────────────────────────────────────────────────────
//
// ⚠️ THE INGREDIENT BLOCK CARRIES ITS WORDS SEPARATELY, not as one string, because
// the allergens inside it have to be emphasised WHERE THEY APPEAR. The regulation
// asks for the allergen to stand out inside the list, not only to be summarised
// underneath, and a single string cannot say which words those are.
function blocksFor(label, lang, extras, profile) {
  const out = [];
  if (label.name) out.push({ role: 'name', text: label.name, parts: null, prefix: '' });

  out.push({
    role: 'ingredients',
    text: null,
    prefix: labelWord('ingredients', lang) + ': ',
    parts: label.ingredients.map(item => ({ text: item.name, emphasise: !!item.emphasise })),
  });

  const contains = containsLine(label, lang);
  if (contains) out.push({ role: 'contains', text: contains, parts: null, prefix: '' });

  const traces = mayContainLine(label, lang);
  if (traces) out.push({ role: 'mayContain', text: traces, parts: null, prefix: '' });

  // ── The particulars a FULL label carries ──────────────────────────────────
  //
  // ⚠️⚠️ EVERY ONE OF THESE IS SKIPPED WHEN IT HAS NOTHING TO SAY, and that is not
  // tidiness. A block switched on with no value behind it would print «Peso netto:»
  // followed by nothing — a mandatory particular that LOOKS declared and is not,
  // which is worse than its absence. The switch says «print this if you have it»,
  // never «print this heading».
  const p = profile;

  if (p.showWeight) {
    const weight = netWeightText(extras && extras.netWeightG, lang);
    if (weight) out.push({ role: 'netWeight', text: `${labelWord('netWeight', lang)}: ${weight}`, parts: null, prefix: '' });
  }

  // The date belongs to the batch being labelled this morning, not to the recipe —
  // the recipe knows only how LONG the food keeps. Worked out at print time.
  if (p.showDate && extras && extras.dateText) {
    out.push({
      role: 'date',
      text: `${labelWord(p.dateKind, lang)} ${extras.dateText}`,
      parts: null, prefix: '',
    });
  }

  if (p.showStorage && p.storageText) {
    out.push({ role: 'storage', text: `${labelWord('storage', lang)}: ${p.storageText}`, parts: null, prefix: '' });
  }

  // ⚠️ THE NAME AND THE ADDRESS ARE ONE BLOCK, because the law asks for the business
  // that can be held responsible — a name with no address does not identify anybody.
  // With only one of the two filled in, this prints what there is rather than
  // refusing: half an address is still more than none on a label somebody has to
  // trace back.
  if (p.showBusiness) {
    const who = [p.businessName, p.businessAddress].filter(Boolean).join(', ');
    if (who) out.push({ role: 'business', text: who, parts: null, prefix: '' });
  }

  return out;
}

// The whole of a block as one run of text, for measuring. The separators are the
// ones the printed block actually uses, so the estimate measures what is drawn.
// ⚠️ THE EMPHASIS IS APPLIED HERE TOO, and it is not cosmetic in a fit estimate:
// CAPITALS ARE WIDER. Measuring «Farina 0» and printing «FARINA 0» is measuring a
// shorter label than the one that comes out — on a declaration whose whole job is to
// make the allergens stand out, so the widest words are exactly the emphasised ones.
export function blockText(block, emphasis = 'bold') {
  if (block.parts) {
    return (block.prefix || '')
      + block.parts.map(p => (p.emphasise ? emphasised(p.text, emphasis) : p.text)).join(', ')
      + '.';
  }
  return block.text || '';
}

// ── FITTING ──────────────────────────────────────────────────────────────────
//
// ⚠️⚠️ THIS IS AN ESTIMATE, AND SAYING SO IS PART OF THE DESIGN. There is no browser
// under Node, so nothing here can truly measure text: line breaks are simulated with
// an average glyph width, and a line of «lll» and a line of «www» are the same width
// to it.
//
// ⚠️ SO IT IS NOT THE GATE, AND MUST NEVER BECOME ONE. The screen renders the same
// words at the same millimetre size in the same typeface and MEASURES the result;
// that measurement is what decides whether the Print button works. What this file
// provides is a starting size and an early warning — both of which can be asserted
// under Node, which a browser measurement cannot.
//
// A greedy word wrap, because it is what a text block actually does and it costs
// nothing more than a character count would.
function linesFor(text, fontMm, widthMm) {
  const charMm = fontMm * AVG_GLYPH_EM;
  const perLine = Math.max(1, Math.floor(widthMm / charMm));
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;

  let lines = 1;
  let used = 0;
  for (const word of words) {
    // A word longer than the line breaks inside itself rather than pushing the block
    // off the paper — overflow-wrap: anywhere, which is what the stylesheet sets and
    // what an ingredient like «emulsionanti» needs on a narrow label.
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

function heightAt(blocks, baseFontMm, widthMm, emphasis) {
  let total = 0;
  blocks.forEach((block, i) => {
    const font = baseFontMm * (BLOCK_SCALE[block.role] || 1);
    total += linesFor(blockText(block, emphasis), font, widthMm) * font * LINE_HEIGHT;
    if (i < blocks.length - 1) total += font * BLOCK_GAP_EM;
  });
  return total;
}

// How much the text is stepped down while looking for a size that fits. Small enough
// that the answer is never much smaller than it needed to be.
const STEP_MM = 0.05;

// ── The whole thing ──────────────────────────────────────────────────────────
//
// A built label (from buildLabel()) + a profile → what to draw, at what size.
//
//   { ok: false, reason: 'not-ok' | 'no-blocks' }
//   { ok: true, blocks, fontMm, minFontMm, fits, widthMm, heightMm, marginMm, ... }
//
// ⚠️ `fits: false` IS A WARNING, NOT A REFUSAL. See FITTING above: the screen
// measures and decides. Returning ok:true with fits:false is deliberate — the caller
// still has something to draw, and drawing it is how a person sees the problem for
// themselves rather than being told about it.
export function resolveLabel(label, profile = DEFAULT_PROFILE, extras = {}, lang = 'en') {
  if (!label || !label.ok) return { ok: false, reason: 'not-ok' };

  const p = normalizeLabelProfile(profile);
  const blocks = blocksFor(label, lang, extras, p);
  if (!blocks.length) return { ok: false, reason: 'no-blocks' };

  const innerW = Math.max(1, p.widthMm - p.marginMm * 2);
  const innerH = Math.max(1, p.heightMm - p.marginMm * 2);
  const floor = minFontMm(p);
  const emphasis = emphasisFor(p);

  // Never START above what the venue asked for: a label that fits at the chosen size
  // is printed at the chosen size, and only one that does not gets shrunk.
  let font = Math.max(p.baseFontMm, floor);
  let fits = heightAt(blocks, font, innerW, emphasis) <= innerH;

  while (!fits && round2(font - STEP_MM) >= floor) {
    font = round2(font - STEP_MM);
    fits = heightAt(blocks, font, innerW, emphasis) <= innerH;
  }

  return {
    ok: true,
    reason: null,
    blocks,
    fontMm: round2(font),
    minFontMm: floor,
    fits,
    widthMm: p.widthMm,
    heightMm: p.heightMm,
    marginMm: p.marginMm,
    scale: BLOCK_SCALE,
    lineHeight: LINE_HEIGHT,
    blockGapEm: BLOCK_GAP_EM,
    // ⚠️⚠️ HOW AN ALLERGEN IS MADE TO STAND OUT, AND IT DEPENDS ON THE PRINTER.
    // See emphasisFor(): a thermal printer driven by ZPL has no bold inside a
    // wrapped paragraph, so it emphasises by CAPITALS instead. The preview obeys
    // this too — the whole design of this feature is that what is on screen is what
    // comes out of the printer, and a preview showing bold where the paper will
    // show capitals is the drift that rule exists to prevent.
    emphasis,
    dpi: p.dpi,
    printerLanguage: p.printerLanguage,
  };
}

// ⚠️ CAPITALS ARE NOT A LESSER EMPHASIS, THEY ARE A DIFFERENT ONE. The regulation
// asks for the allergen to be distinguished from the rest of the list "by means of
// the typeset — for example by font, style or background colour"; capitals are one
// of the accepted ways and the one a monochrome thermal printer can actually do.
// ingredientLine() in recipe-label-model.js has always used capitals for the same
// reason, on the plain-text copy, so this is the app's existing answer rather than a
// new one.
export function emphasisFor(profile) {
  return normalizeLabelProfile(profile).printerLanguage === 'zpl' ? 'caps' : 'bold';
}

// The one place a word is put into its emphasised form, so the screen and the
// printer cannot disagree about what that form is.
export function emphasised(text, emphasis) {
  return emphasis === 'caps' ? String(text).toUpperCase() : String(text);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
