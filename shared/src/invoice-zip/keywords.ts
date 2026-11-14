// keywords.ts — the eight keyword patterns (seven of the original; Mise 2 splits NONFOOD_RE out of packaging) that classify an invoice line's description. They are the
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
  + `|confettura|crema|ricotta|mascarpone|formaggio|mozzarella`
  // Ready-made food: «patate padellate» is not a pan, «cornetto fantasia» is not a Fanta.
  + `|patate|cornett[oi]|panzerott${WORD}*|pasticciott${WORD}*|treccia|trecce)${B_END}`, 'iu');
// Only bar and shelf goods sold as they are are resale (5 Oct 2026, from the first real import).
// Ready-made FOOD (frozen croissants, panzerotti, sliced potatoes) is proposed as an ingredient,
// because food cost and the order lists need it (owner's decision, 1 Nov 2026); a keyword list of
// article prefixes let identical goods land on both sides. Looked at before FOOD_RE because the
// food word is often only the filling.
export const READY_RE = new RegExp(
  `${B_START}yog\\.|yogurt|kefir|dolcificante|capsul|${B_START}caps${B_END}|caff\\S*\\s*cialde`, 'iu');
export const PACKAGING_RE = new RegExp(
  'sh\\. ml|b\\.sch|grattugia|flacone|posate|asciugamano|vasch\\.caldo|rotolo|buste|carta |carta$'
  + '|sacch|cont\\. plastica|fogli pol|pellicola|stagnola|vaschette|box +pizza|velina|bicch|tappo'
  + '|bobina|laccetti|black nitro|carta forno|staccante', 'iu');
// ⚠️ MISE 2 ONLY (14 Nov 2026): what is not food at all — tools, clothing, cleaning, shop bags — is no longer packaging but a
// line type of its own, «altro», imported as an item of kind 'other'. In invoice-import/classify.py (and the frozen current
// app) these words are still the tail of PACKAGING_RE: keywords.spec.ts compares PACKAGING_RE + «|» + NONFOOD_RE with it.
// Not food at all — tools, clothing, cleaning, shop bags (5 Oct 2026, from the first real
// import). Food words are checked first, so «olio … ml10» or «zucchero … bustina» never land here.
export const NONFOOD_RE = new RegExp(
  `alluminio|grembiul|palett|coprivassoi|carte pizzo|shopper|${B_START}borsa${B_END}|${B_START}bags${B_END}|caraffa`
  + `|coppetta|anticalcare|detersiv|sgrassa|igienizz|candeggin|pennello|asciugaman|organza`
  + `|spolett|pentol|padell|${B_START}padel${B_END}|guanti`
  // A potato peeler (the word «patate» no longer catches it as resale).
  + '|pelapatate'
  // Cleaning goods given free: a product received only free is now created with no price (build-import.ts).
  + '|lavastovigl|micronizzator', 'iu');
// Beverages are bought to be sold: resale, whatever the liquid.
export const BEVERAGE_RE = new RegExp(
  ['coca cola', `${B_START}acqua${B_END}`, 'birra', 'redbull', 'succo', `${B_START}the${B_END}`, 'fanta', 'sprite',
    'lemonsoda', 'aranciata', 'chinotto',
    // Soft drinks proposed as ingredients on a real invoice (14 Nov 2026: «LIMONATA TOM LATTINA CL 33X24», «TONICA SCHWEPPES
    // LEMON CL 18X24»), and their kin. Also in invoice-import/classify.py; NOT in the frozen current app.
    'limonata', 'tonica', 'gassosa', 'spuma', 'cedrata', 'ginger',
    'prosecco', `${B_START}vino${B_END}`].join('|'), 'iu');
