// classify.js — reading an invoice line's description: product key, proposed type, package size.
// A port of invoice-import/classify.py, function by function. Everything here is a PROPOSAL: the owner
// overrides any of it, so a rule that is wrong costs one edited cell, not a wrong price in the database.
// Pure. The Python `\b` is written B_START / B_END (see py-compat.js): accented letters are word characters.

import { B_END, B_START, WORD, escapeRegex, stripChars } from './py-compat.js';
import { EXCLUDED } from './reasons.js';

// ── product key ───────────────────────────────────────────────────────────────

// NFD, accents stripped, lower case, `{lot/expiry}` removed, leading `*` removed, punctuation -> space,
// spaces collapsed. The key must survive the supplier changing the lot text on every delivery.
export function normaliseName(description) {
  let s = String(description || '').replace(/\{.*?\}/g, ' ');
  s = s.trim().replace(/^\*+/, '');
  s = s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase();
  return s.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function productKey(supplierKey, articleCode, description) {
  const code = String(articleCode || '').trim();
  if (code) return `${supplierKey}|code:${code}`;
  return `${supplierKey}|name:${normaliseName(description)}`;
}

// ── line classification ───────────────────────────────────────────────────────

// Lines that carry information, not goods (offer, lot, delivery note, stamp duty note…).
const NOISE_RE = new RegExp(
  '^\\*?(offerta|lotto|ordine|ddt|rif\\.|consegna|riga ausiliaria|cassa num|\\*\\*|\\.|\\*i suddetti'
  + '|contributo ambientale)|non disponibile|assolve gli obblighi', 'iu');
const COSTS_RE = new RegExp(`^[^\\p{L}\\p{N}_]*(spese|incasso|trasporto|imposta di bollo)${B_END}`, 'iu');
const DISCOUNT_RE = new RegExp(`^[^\\p{L}\\p{N}_]*(sconto|abbuono|ribasso)${B_END}`, 'iu');

// Checked BEFORE packaging: "ZUCCHERO SACCHI DA KG 25" is sugar in sacks, not a sack.
const FOOD_RE = new RegExp(
  `${B_START}(zucchero|farina|semola|sale|lievito|burro|margarina|strutto|olio|uova|uovo|latte|panna`
  + `|cacao|cioccolato|miele|mandorl${WORD}*|nocciol${WORD}*|pistacch${WORD}*|noci|uvetta|canditi|marmellata`
  + `|confettura|crema|ricotta|mascarpone|formaggio|mozzarella)${B_END}`, 'iu');
// Ready-made goods bought to be sold as they are. Looked at before FOOD_RE because the
// food word is often only the filling («cornetto alla crema»).
const READY_RE = new RegExp(
  '(?<!fecola di )patate|cornetto|panzerott|pasticciotto|treccia|sg\\.cr|cr\\.integrale|mini cr'
  + '|tm cr|tm-midi|cipolle fette'
  // Bar and shelf goods sold as they are (5 Oct 2026, from the first real import).
  + `|${B_START}yog\\.|yogurt|kefir|dolcificante|capsul|${B_START}caps${B_END}|caff\\S*\\s*cialde`, 'iu');
const PACKAGING_RE = new RegExp(
  'sh\\. ml|b\\.sch|grattugia|flacone|posate|asciugamano|vasch\\.caldo|rotolo|buste|carta |carta$'
  + '|sacch|cont\\. plastica|fogli pol|pellicola|stagnola|vaschette|box +pizza|velina|bicch|tappo'
  + '|bobina|laccetti|black nitro|carta forno|staccante'
  // Not food at all — tools, clothing, cleaning, shop bags (5 Oct 2026, from the first real
  // import). Never imported, like packaging. Food words are checked first, so «olio … ml10»
  // or «zucchero … bustina» never land here.
  + `|alluminio|grembiul|palett|coprivassoi|carte pizzo|shopper|${B_START}borsa${B_END}|${B_START}bags${B_END}|caraffa`
  + `|coppetta|anticalcare|detersiv|sgrassa|igienizz|candeggin|pennello|asciugaman|organza`
  + `|spolett|pentol|padell|${B_START}padel${B_END}|guanti`, 'iu');
// Beverages are bought to be sold: resale, whatever the liquid.
const BEVERAGE_RE = new RegExp(
  ['coca cola', `${B_START}acqua${B_END}`, 'birra', 'redbull', 'succo', `${B_START}the${B_END}`, 'fanta', 'sprite',
    'lemonsoda', 'aranciata', 'chinotto', 'prosecco', `${B_START}vino${B_END}`].join('|'), 'iu');

// A discount that names no product cannot be shared out among the products.
export function isUnattributedDiscount(description, quantity, total) {
  if (total === null || total === undefined || total >= 0) return false;
  if (!quantity) return true;
  return DISCOUNT_RE.test(description || '');
}

// ['excluded', reason] for a line that is not goods, else [type, ''].
// type is `ingrediente`, `packaging` or `rivendita`.
export function classify(description, quantity, total) {
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

// ONE package's size, and how many packages the invoiced unit holds (null = one).
// unit: 'g' | 'kg' | 'ml' | 'l'
export function packInfo(size, unit, count = null) {
  return { size, unit, count };
}

const f = (s) => Number(String(s).replace(',', '.'));

// «(X12PZ)» after a size: twelve packages in the unit.
function countAfter(d) {
  const m = new RegExp(`${B_START}X\\s*(\\d+)\\s*(?:PZ|PEZZI|NR)${B_END}`, 'u').exec(d);
  return m && Number(m[1]) > 1 ? Number(m[1]) : null;
}

// Python's str(round(a / b, 3)): «0.5», «2.0».
function fractionText(a, b) {
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

export function parsePack(description) {
  let d = String(description || '').toUpperCase();
  // "1/2KG", "1/4 KG": a fraction of a unit. Without this the "2KG" inside "1/2KG" reads as
  // a 2 kg pack — four times the real half kilo (real invoice, 3 Oct 2026).
  d = d.replace(FRACTION_RE, (match, a, b) => (Number(b) === 0 ? match : fractionText(Number(a), Number(b))));

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
export function formatNumber(x) {
  let s = x.toFixed(6);
  s = s.replace(/0+$/, '');
  return s.replace(/\.$/, '');
}

// The `weight` string the ingredient card stores: dot decimal, g/kg/ml/l.
export function formatPackSize(size, unit) {
  return `${formatNumber(size)} ${unit}`;
}

const WEIGHT_TEXT_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(kg|kgm|g|gr|grammi|l|lt|litri|litro|ml|cl)\.?\s*$/i;

// «2,5 kg», «250g», «1 l», «500 ml» typed by hand -> [2.5, 'kg'], null if unreadable.
export function parsePackText(text) {
  const m = WEIGHT_TEXT_RE.exec(String(text ?? ''));
  if (!m) return null;
  let value = f(m[1]);
  let unit = m[2].toLowerCase();
  if (unit === 'kg' || unit === 'kgm') unit = 'kg';
  else if (unit === 'g' || unit === 'gr' || unit === 'grammi') unit = 'g';
  else if (unit === 'l' || unit === 'lt' || unit === 'litri' || unit === 'litro') unit = 'l';
  else if (unit === 'cl') { value *= 10; unit = 'ml'; }
  if (value <= 0) return null;
  return [value, unit];
}

// ── eggs ─────────────────────────────────────────────────────────────────────

const EGG_RE = new RegExp(`${B_START}UOV[AO]${B_END}`, 'u');

export function isEgg(description) {
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
export function eggsPerPack(description) {
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

const PACK_WORDS = [
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
].map(([pattern, word]) => [new RegExp(pattern, 'u'), word]);

export function packWord(description) {
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

// The proposed «Nome in Mise»: sizes, pack words, codes and lot text taken away,
// only the first letter in capitals.
export function cleanName(description, articleCode = '') {
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
