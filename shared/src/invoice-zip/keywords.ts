// keywords.ts — the seven keyword patterns that classify an invoice line's description. They are the
// ones part of classify that the original (js/orders/invoice-zip/classify.js) keeps private; they live
// in a module of their own here so that keywords.spec.ts can read them and compare each, word for word,
// with its twin in invoice-import/classify.py. NOT paired in parity.spec.ts: the original exports none of
// them, so there is no counterpart to compare.
//
// ⚠️ THE PATTERNS MUST STAY THE SAME AS THE ORIGINAL'S (same alternatives, same order, flags `iu`). The
// Python `\b` is written B_START / B_END, `\w` WORD and `\W` `[^\p{L}\p{N}_]` (see py-compat.ts): accented
// letters are word characters. Pure.

import { B_END, B_START, WORD } from './py-compat';

// Lines that carry information, not goods (offer, lot, delivery note, stamp duty note…).
export const NOISE_RE = new RegExp(
  '^\\*?(offerta|lotto|ordine|ddt|rif\\.|consegna|riga ausiliaria|cassa num|\\*\\*|\\.|\\*i suddetti'
  + '|contributo ambientale)|non disponibile|assolve gli obblighi', 'iu');
export const COSTS_RE = new RegExp(`^[^\\p{L}\\p{N}_]*(spese|incasso|trasporto|imposta di bollo)${B_END}`, 'iu');
export const DISCOUNT_RE = new RegExp(`^[^\\p{L}\\p{N}_]*(sconto|abbuono|ribasso)${B_END}`, 'iu');

// Checked BEFORE packaging: "ZUCCHERO SACCHI DA KG 25" is sugar in sacks, not a sack.
export const FOOD_RE = new RegExp(
  `${B_START}(zucchero|farina|semola|sale|lievito|burro|margarina|strutto|olio|uova|uovo|latte|panna`
  + `|cacao|cioccolato|miele|mandorl${WORD}*|nocciol${WORD}*|pistacch${WORD}*|noci|uvetta|canditi|marmellata`
  + `|confettura|crema|ricotta|mascarpone|formaggio|mozzarella)${B_END}`, 'iu');
// Ready-made goods bought to be sold as they are. Looked at before FOOD_RE because the
// food word is often only the filling («cornetto alla crema»).
export const READY_RE = new RegExp(
  '(?<!fecola di )patate|cornetto|panzerott|pasticciotto|treccia|sg\\.cr|cr\\.integrale|mini cr'
  + '|tm cr|tm-midi|cipolle fette'
  // Bar and shelf goods sold as they are (5 Oct 2026, from the first real import).
  + `|${B_START}yog\\.|yogurt|kefir|dolcificante|capsul|${B_START}caps${B_END}|caff\\S*\\s*cialde`, 'iu');
export const PACKAGING_RE = new RegExp(
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
export const BEVERAGE_RE = new RegExp(
  ['coca cola', `${B_START}acqua${B_END}`, 'birra', 'redbull', 'succo', `${B_START}the${B_END}`, 'fanta', 'sprite',
    'lemonsoda', 'aranciata', 'chinotto', 'prosecco', `${B_START}vino${B_END}`].join('|'), 'iu');
