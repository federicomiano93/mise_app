// classify.ts — reading an invoice line's description: product key, proposed type, package size.
// A port of invoice-import/classify.py, function by function. Everything here is a PROPOSAL: the owner
// overrides any of it, so a rule that is wrong costs one edited cell, not a wrong price in the database.
// Pure. The Python `\b` is written B_START / B_END (see py-compat.ts): accented letters are word characters.
//
// FULL port of js/orders/invoice-zip/classify.js: same exported names, same behaviour input for input.
// Typing only differs. ONE structural difference, invisible from outside: the seven keyword patterns
// (NOISE_RE … BEVERAGE_RE), private in the original, are in keywords.ts, so a spec can compare them with
// invoice-import/classify.py. They are still NOT exported from here, so the exports match the original's.

import { B_END, B_START, WORD, escapeRegex, stripChars } from './py-compat';
import { EXCLUDED } from './reasons';
import {
  BEVERAGE_RE, COSTS_RE, DISCOUNT_RE, FOOD_RE, NOISE_RE, PACKAGING_RE, READY_RE,
} from './keywords';

// ── product key ───────────────────────────────────────────────────────────────

// NFD, accents stripped, lower case, `{lot/expiry}` removed, leading `*` removed, punctuation -> space,
// spaces collapsed. The key must survive the supplier changing the lot text on every delivery.
export function normaliseName(description?: unknown): string {
  let s = String(description || '').replace(/\{.*?\}/g, ' ');
  s = s.trim().replace(/^\*+/, '');
  s = s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function productKey(supplierKey: string, articleCode: unknown, description: unknown): string {
  const code = String(articleCode || '').trim();
  if (code) return `${supplierKey}|code:${code}`;
  return `${supplierKey}|name:${normaliseName(description)}`;
}

// ── line classification ───────────────────────────────────────────────────────

// A discount that names no product cannot be shared out among the products.
export function isUnattributedDiscount(description: unknown, quantity: number | null | undefined,
  total: number | null | undefined): boolean {
  if (total === null || total === undefined || total >= 0) return false;
  if (!quantity) return true;
  return DISCOUNT_RE.test((description as string) || '');
}

export type LineType = 'ingrediente' | 'packaging' | 'rivendita';

// ['excluded', reason] for a line that is not goods, else [type, ''].
// type is `ingrediente`, `packaging` or `rivendita`.
export function classify(description: unknown, quantity: number | null | undefined,
  total: number | null | undefined): ['excluded', string] | [LineType, ''] {
  const d = String(description || '').trim();
  const low = d.toLowerCase();
  if (!d || NOISE_RE.test(low)) return ['excluded', EXCLUDED.INFO_LINE];
  if (!quantity && !(total || 0)) return ['excluded', EXCLUDED.INFO_LINE];
  if (COSTS_RE.test(low)) return ['excluded', EXCLUDED.COSTS];
  if (READY_RE.test(low)) return ['rivendita', ''];
  if (FOOD_RE.test(low)) return ['ingrediente', ''];
  if (PACKAGING_RE.test(low)) return ['packaging', ''];
  if (BEVERAGE_RE.test(low)) return ['rivendita', ''];
  return ['ingrediente', ''];
}

// ── package size from the description ────────────────────────────────────────

const NUM = '(\\d+(?:[.,]\\d+)?)';

export type PackUnit = 'g' | 'kg' | 'ml' | 'l';
export interface PackInfo { size: number; unit: PackUnit; count: number | null }

// ONE package's size, and how many packages the invoiced unit holds (null = one).
// unit: 'g' | 'kg' | 'ml' | 'l'
export function packInfo(size: number, unit: PackUnit, count: number | null = null): PackInfo {
  return { size, unit, count };
}

const f = (s: unknown): number => Number(String(s).replace(',', '.'));

// «(X12PZ)» after a size: twelve packages in the unit.
function countAfter(d: string): number | null {
  const m = new RegExp(`${B_START}X\\s*(\\d+)\\s*(?:PZ|PEZZI|NR)${B_END}`, 'u').exec(d);
  return m && Number(m[1]) > 1 ? Number(m[1]) : null;
}

// Python's str(round(a / b, 3)): «0.5», «2.0».
function fractionText(a: number, b: number): string {
  const x = Number((a / b).toFixed(3));
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

const FRACTION_RE = new RegExp(`(?<![\\d/])(\\d)\\s*/\\s*(\\d)(?=\\s*(?:KG|GR|G|LT|L|ML)${B_END})`, 'gu');
const P_KG_X = new RegExp(`${NUM}\\s*(KG|GR|G)\\.?\\s*[*X]\\s*(\\d+)(?!\\d)`, 'u');
const P_PZ_GR = new RegExp(`${B_START}PZ\\.?\\s*(\\d+)\\s*GR\\.?\\s*(\\d+)`, 'u');
const P_UNIT_FIRST = new RegExp(`(?<![A-Z])(ML|CL|LT|L|GR|G|KG)\\s*\\.?\\s*${NUM}\\s*[X×*]\\s*(\\d+)(?!\\d)`, 'u');
const P_KG_NUM_X = new RegExp(`${B_START}KG\\.?\\s*${NUM}\\s*X\\s*(\\d+)(?!\\d)`, 'u');
const P_GR_X = new RegExp(`${B_START}GR?\\.?\\s*(\\d+)\\s*X\\s*(\\d+)(?!\\d)`, 'u');
const P_KG = new RegExp(`${B_START}KG\\.?\\s*${NUM}|${NUM}\\s*KG${B_END}`, 'u');
const P_G_DOT = new RegExp(
  `${B_START}(?:GR?|G)\\.\\s*(\\d+)${B_END}|${B_START}GR\\s+(\\d+)${B_END}|${B_START}G\\s+(\\d{3,4})${B_END}`, 'u');
const P_G = new RegExp(`${NUM}\\s*(?:GR?|G)${B_END}`, 'u');
const P_LT = new RegExp(`${B_START}LT\\.?\\s*${NUM}|${NUM}\\s*(?:LT|L)${B_END}`, 'u');
const P_ML = new RegExp(`${B_START}ML\\.?\\s*(\\d+)|(\\d+)\\s*ML${B_END}`, 'u');
const P_CL = new RegExp(`(\\d+)\\s*CL${B_END}`, 'u');

export function parsePack(description?: unknown): PackInfo | null {
  let d = String(description || '').toUpperCase();
  // "1/2KG", "1/4 KG": a fraction of a unit. Without this the "2KG" inside "1/2KG" reads as
  // a 2 kg pack — four times the real half kilo (real invoice, 3 Oct 2026).
  d = d.replace(FRACTION_RE, (match: string, a: string, b: string) => (
    Number(b) === 0 ? match : fractionText(Number(a), Number(b))));

  // "2,5kg* 4pz", "85gr* 50pz", "2,5 KG X 4", "1kgx6", "7gx80"
  let m = P_KG_X.exec(d);
  if (m) return packInfo(f(m[1]), m[2] === 'KG' ? 'kg' : 'g', Number(m[3]));
  // "PZ.50 GR.85": pieces first, then grams each
  m = P_PZ_GR.exec(d);
  if (m) return packInfo(Number(m[2]), 'g', Number(m[1]));
  // Unit FIRST, then size x count: "ML10X102" is 102 portions of 10 ml, "GR25X40" 40 of 25 g,
  // "KG1X10" ten of 1 kg. The unit must not be the tail of a longer word.
  m = P_UNIT_FIRST.exec(d);
  if (m) {
    const unit = m[1];
    const size = f(m[2]);
    const count = Number(m[3]);
    if (unit === 'KG') return packInfo(size, 'kg', count);
    if (unit === 'GR' || unit === 'G') return packInfo(size, 'g', count);
    if (unit === 'ML') return packInfo(size, 'ml', count);
    if (unit === 'CL') return packInfo(size * 10, 'ml', count);
    return packInfo(size, 'l', count);
  }
  // "kg 2,5 x 4", "KG.2,5X4"
  m = P_KG_NUM_X.exec(d);
  if (m) return packInfo(f(m[1]), 'kg', Number(m[2]));
  // "gr.70x6" (not when "PZ" is there: that is a count in front of something else)
  m = P_GR_X.exec(d);
  if (m && !d.includes('PZ')) return packInfo(Number(m[1]), 'g', Number(m[2]));
  // "KG 25", "2,5KG"
  m = P_KG.exec(d);
  if (m) return packInfo(f(m[1] || m[2]), 'kg', countAfter(d));
  // "GR.250", "G.1000", "GR 250", "G 570" (three or four digits: «G 5» is not a weight)
  m = P_G_DOT.exec(d);
  if (m) return packInfo(Number(m[1] || m[2] || m[3]), 'g', countAfter(d));
  // "500 g", "100G"
  m = P_G.exec(d);
  if (m) return packInfo(f(m[1]), 'g', countAfter(d));
  // "LT 1", "1L", "5 LT"
  m = P_LT.exec(d);
  if (m) return packInfo(f(m[1] || m[2]), 'l');
  // "ML 500", "500 ml"
  m = P_ML.exec(d);
  if (m) return packInfo(Number(m[1] || m[2]), 'ml');
  m = P_CL.exec(d);
  if (m) return packInfo(Number(m[1]) * 10, 'ml');
  return null;
}

// f"{x:.6f}".rstrip("0").rstrip(".")
export function formatNumber(x: number): string {
  let s = x.toFixed(6);
  s = s.replace(/0+$/, '');
  return s.replace(/\.$/, '');
}

// The `weight` string the ingredient card stores: dot decimal, g/kg/ml/l.
export function formatPackSize(size: number, unit: string): string {
  return `${formatNumber(size)} ${unit}`;
}

const WEIGHT_TEXT_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|kgm|g|gr|grammi|l|lt|litri|litro|ml|cl)\.?\s*$/i;

// «2,5 kg», «250g», «1 l», «500 ml» typed by hand -> [2.5, 'kg'], null if unreadable.
export function parsePackText(text: unknown): [number, string] | null {
  const m = WEIGHT_TEXT_RE.exec(String(text ?? ''));
  if (!m) return null;
  let value = f(m[1]);
  let unit = (m[2] as string).toLowerCase();
  if (unit === 'kg' || unit === 'kgm') unit = 'kg';
  else if (unit === 'g' || unit === 'gr' || unit === 'grammi') unit = 'g';
  else if (unit === 'l' || unit === 'lt' || unit === 'litri' || unit === 'litro') unit = 'l';
  else if (unit === 'cl') { value *= 10; unit = 'ml'; }
  if (value <= 0) return null;
  return [value, unit];
}

// ── eggs ─────────────────────────────────────────────────────────────────────

const EGG_RE = new RegExp(`${B_START}UOV[AO]${B_END}`, 'u');

export function isEgg(description?: unknown): boolean {
  return EGG_RE.test(String(description || '').toUpperCase());
}

const EGG_TRAYS_RE = new RegExp(`${B_START}(\\d+)\\s*[X*]\\s*(\\d+)\\s*UOV[AO]${B_END}`, 'u');
const EGG_COUNT_RES = [
  new RegExp(`${B_START}DA\\s+(\\d+)\\s+UOV[AO]${B_END}`, 'u'),
  new RegExp(`${B_START}(\\d+)\\s*UOV[AO]${B_END}`, 'u'),
  new RegExp(`${B_START}X\\s*(\\d+)(?!\\d)`, 'u'),
  new RegExp(`${B_START}(\\d+)\\s*(?:PZ|PEZZI)${B_END}`, 'u'),
];

// «DA 30 UOVA», «30 UOVA», «X30», «30 PZ» -> 30; «6 X 10 UOVA» (six trays of ten) -> 60;
// null when the invoice does not say.
export function eggsPerPack(description?: unknown): number | null {
  const d = String(description || '').toUpperCase();
  let m = EGG_TRAYS_RE.exec(d);
  if (m && Number(m[1]) >= 1 && Number(m[2]) >= 1) return Number(m[1]) * Number(m[2]);
  for (const re of EGG_COUNT_RES) {
    m = re.exec(d);
    if (m && Number(m[1]) >= 1) return Number(m[1]);
  }
  return null;
}

// ── proposed card fields ─────────────────────────────────────────────────────

const PACK_WORD_SOURCES: [string, string][] = [
  [`${B_START}SACC(?:O|HI)${B_END}`, 'sacco'],
  [`${B_START}BUST[AE]${B_END}`, 'busta'],
  [`${B_START}CARTON[EI]${B_END}`, 'cartone'],
  [`${B_START}LATTA${B_END}`, 'latta'],
  [`${B_START}SECCHI[O]?${B_END}`, 'secchio'],
  [`${B_START}BOTTIGLI[AE]${B_END}`, 'bottiglia'],
  [`${B_START}VASETT[OI]${B_END}`, 'vasetto'],
  [`${B_START}BARATTOL[OI]${B_END}`, 'barattolo'],
  [`${B_START}SCATOL[AE]${B_END}`, 'scatola'],
  [`${B_START}VASCHETT[AE]${B_END}`, 'vaschetta'],
];
const PACK_WORDS: [RegExp, string][] = PACK_WORD_SOURCES.map(([pattern, word]) => [new RegExp(pattern, 'u'), word]);

export function packWord(description?: unknown): string {
  const d = String(description || '').toUpperCase();
  for (const [re, word] of PACK_WORDS) {
    if (re.test(d)) return word;
  }
  return '';
}

const N = '\\d+(?:[.,]\\d+)?';
const CLEAN_RES = [
  `${B_START}PZ\\.?\\s*\\d+\\s*GR?\\.?\\s*\\d+`,
  `${B_START}(?:DA\\s+)?${N}\\s*(?:KG|GR|G|LT|L|ML|CL)${B_END}\\.?(?:\\s*[*X]\\s*\\d+(?!\\d)(?:\\s*(?:PZ|NR|PEZZI)${B_END})?)?`,
  `${B_START}(?:DA\\s+)?(?:KG|GR?|LT|ML|CL)\\.?\\s*${N}(?:\\s*X\\s*${N})?(?!\\d)`,
  `${B_START}(?:DA\\s+)?\\d+\\s*(?:PZ|NR|PEZZI)${B_END}`,
  `${B_START}PZ\\.?\\s*\\d+${B_END}`,
  `${B_START}DA\\s+\\d+\\s+(?=UOV)`,
].map((pattern) => new RegExp(pattern, 'giu'));
const PACK_NOISE_RE = new RegExp(
  `${B_START}(?:SACCO|SACCHI|BUSTA|BUSTE|CARTONE|CARTONI|LATTA|SECCHIO|SECCHI|BOTTIGLIA|BOTTIGLIE`
  + `|VASETTO|VASETTI|BARATTOLO|SCATOLA|VASCHETTA|CONFEZIONE|CONF|CF|CT)${B_END}\\.?`, 'giu');
const DANGLING_RE = /(?:^|\s)(?:DA|IN|DI|CON|X)\s*$/iu;
const TRIM_CHARS = ' \t-.,;:*/';

// «Nome in fattura»: the description exactly as the supplier wrote it, with ONLY the {…} lot blocks taken away and the
// whitespace collapsed — case and everything else kept. It is how the import tells a product it already holds
// from a new one, so it must never be «cleaned» further.
export function invoiceNameOf(description?: unknown): string {
  return String(description || '').replace(/\{.*?\}/g, ' ').replace(/\s+/g, ' ').trim();
}

// The proposed «Nome in Mise»: sizes, pack words, codes and lot text taken away,
// only the first letter in capitals.
export function cleanName(description?: unknown, articleCode: unknown = ''): string {
  const original = String(description || '').replace(/\{.*?\}/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/^\*+/, '').trim();
  let s = original;
  for (const re of CLEAN_RES) s = s.replace(re, ' ');
  // «SACCHI DA KG 25»: the pack word is a detail of the delivery. Without a size next to
  // it the word is the product itself («BUSTE PLASTICA») and must stay.
  if (s !== original) s = s.replace(PACK_NOISE_RE, ' ');
  const code = String(articleCode || '').trim();
  if (code) s = s.replace(new RegExp(`(?<!${WORD})${escapeRegex(code)}(?!${WORD})`, 'giu'), ' ');
  s = stripChars(s.replace(/\s+/g, ' ').trim(), TRIM_CHARS);
  for (;;) {
    const trimmed = stripChars(s.replace(DANGLING_RE, '').trim(), TRIM_CHARS);
    if (trimmed === s) break;
    s = trimmed;
  }
  s = (s || original).toLowerCase();
  const [first = ''] = Array.from(s);
  return first.toUpperCase() + s.slice(first.length);
}
