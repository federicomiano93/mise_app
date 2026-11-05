// importWords.ts — which phrase says what, on the invoice import (step 3e-6). Only TABLES of dictionary keys: the words are
// asked with t() when a screen is drawn (never here, at load — the venue's language arrives after this module does).

import type { MessageKey } from '../../i18n/en';

// The words for every code the invoice reader can hand the screen (shared/src/invoice-zip/reasons.ts): why a price needs
// checking or has none, why a product could not be read, why a file was skipped. A note that holds several reasons joins their
// codes with «; » (codesText). The spec pins that every code of NOTE (from the first «needs checking» one), LEFT_OUT and
// SKIPPED has a phrase.
export const CODE_KEYS = {
  'egg-quantity-unclear': 'sup.imp.code.eggQuantityUnclear',
  'price-out-of-scale': 'sup.imp.code.priceOutOfScale',
  'unattributed-discount': 'sup.imp.code.unattributedDiscount',
  'mixed-units': 'sup.imp.code.mixedUnits',
  'no-weight-on-invoice': 'sup.imp.code.noWeightOnInvoice',
  'no-price-unit': 'sup.imp.code.noPriceUnit',
  'no-piece-weight': 'sup.imp.code.noPieceWeight',
  'quantity-zero-or-negative': 'sup.imp.code.quantityZero',
  'amount-zero-or-negative': 'sup.imp.code.amountZero',
  'price-unit-differs-from-invoice-unit': 'sup.imp.code.unitDiffers',
  'price-unit-pack-mismatch': 'sup.imp.code.packMismatch',
  'price-unit-unreadable': 'sup.imp.code.unitUnreadable',
  'pack-weight-unreadable': 'sup.imp.code.packWeightUnreadable',
  'pack-count-unreadable': 'sup.imp.code.packCountUnreadable',
  'pieces-need-price-unit-and-weight': 'sup.imp.code.piecesNeedUnit',
  'pieces-need-pack-weight': 'sup.imp.code.piecesNeedWeight',
  'no-computable-price': 'sup.imp.code.noComputablePrice',
  'needs-checking': 'sup.imp.code.needsChecking',
  'file-too-large': 'sup.imp.code.fileTooLarge',
  'dtd-not-allowed': 'sup.imp.code.dtdNotAllowed',
  'xml-unreadable': 'sup.imp.code.xmlUnreadable',
  'too-many-invoices-in-file': 'sup.imp.code.tooManyInvoices',
  'zip-unreadable': 'sup.imp.code.zipUnreadable',
  'too-many-entries': 'sup.imp.code.tooManyEntries',
  'archive-too-large': 'sup.imp.code.archiveTooLarge',
} as const satisfies Record<string, MessageKey>;

// Why a supplier of the file cannot be imported (SupplierPlanEntry.reason): the codes of parseSupplier, and the model's
// duplicate-VAT answer. The ingredient-row reasons are REASON_KEYS, below.
export const SUPPLIER_REASON_KEYS = {
  'not-object': 'sup.imp.reason.notObject',
  'key-missing': 'sup.imp.reason.keyMissing',
  'duplicate-key': 'sup.imp.reason.duplicateKey',
  'name-missing': 'sup.imp.reason.nameMissing',
  'vat-missing': 'sup.imp.reason.vatMissing',
  'vat-too-long': 'sup.imp.reason.vatTooLong',
  'duplicate-vat': 'sup.imp.reason.duplicateVat',
} as const satisfies Record<string, MessageKey>;

export const UNKNOWN_REASON_KEY: MessageKey = 'sup.imp.reason.unknown';

// A supplier row's status → the word on its pill and the tone that repeats it. The word is ALWAYS there: the colour only
// repeats it (P18).
export type Tone = 'ok' | 'warn' | 'error' | 'quiet';

export const SUPPLIER_STATUS = {
  new: { key: 'sup.imp.status.new', tone: 'ok' },
  present: { key: 'sup.imp.status.present', tone: 'ok' },
  maybe: { key: 'sup.imp.status.maybe', tone: 'warn' },
  error: { key: 'sup.imp.status.error', tone: 'error' },
} as const satisfies Record<string, { key: MessageKey; tone: Tone }>;

export type SupplierStatus = keyof typeof SUPPLIER_STATUS;

export const isSupplierStatus = (value: string): value is SupplierStatus => Object.hasOwn(SUPPLIER_STATUS, value);

// One or several reader codes («a; b») → the keys of the sentences a person reads, in order. An unknown code is «could not be
// imported», never a blank.
export function codeKeys(text: unknown): MessageKey[] {
  return String(text ?? '').split('; ').filter(Boolean)
    .map(code => (Object.hasOwn(CODE_KEYS, code) ? CODE_KEYS[code as keyof typeof CODE_KEYS] : UNKNOWN_REASON_KEY));
}

export function supplierReasonKey(code: string): MessageKey {
  return Object.hasOwn(SUPPLIER_REASON_KEYS, code) ? SUPPLIER_REASON_KEYS[code as keyof typeof SUPPLIER_REASON_KEYS] : UNKNOWN_REASON_KEY;
}

// ── Step 3 · the ingredients ────────────────────────────────────────────────────────────────────────────────────────

// Why an ingredient row cannot be imported, or what to know about it (IngredientRow.reason): the supplier reasons above plus
// the ones only a product has. An unknown code is «could not be imported», never a blank.
export const REASON_KEYS = {
  ...SUPPLIER_REASON_KEYS,
  'supplier-key-missing': 'sup.imp.reason.supplierKeyMissing',
  'supplier-missing': 'sup.imp.reason.supplierMissing',
  'price-unit': 'sup.imp.reason.priceUnit',
  'unit-weight-missing': 'sup.imp.reason.unitWeightMissing',
  'pack-count': 'sup.imp.reason.packCount',
  'no-prices': 'sup.imp.reason.noPrices',
  'price-invalid': 'sup.imp.reason.priceInvalid',
  'target-not-found': 'sup.imp.reason.targetNotFound',
  'code-ambiguous': 'sup.imp.reason.codeAmbiguous',
  'name-ambiguous': 'sup.imp.reason.nameAmbiguous',
  'merge-target-not-found': 'sup.imp.reason.mergeNotFound',
  'merge-target-ambiguous': 'sup.imp.reason.mergeAmbiguous',
  'code-differs': 'sup.imp.reason.codeDiffers',
  'unit-differs': 'sup.imp.reason.unitDiffers',
  'piece-differs': 'sup.imp.reason.pieceDiffers',
  'codes-full': 'sup.imp.reason.codesFull',
} as const satisfies Record<string, MessageKey>;

export function reasonKey(code: unknown): MessageKey {
  return typeof code === 'string' && Object.hasOwn(REASON_KEYS, code) ? REASON_KEYS[code as keyof typeof REASON_KEYS] : UNKNOWN_REASON_KEY;
}

// An ingredient row's status (or the `check` bucket) → the word on its pill and the tone that repeats it.
export const STATUS = {
  new: { key: 'sup.imp.status.new', tone: 'ok' },
  'update-price': { key: 'sup.imp.status.updatePrice', tone: 'ok' },
  'history-only': { key: 'sup.imp.status.historyOnly', tone: 'quiet' },
  unchanged: { key: 'sup.imp.status.unchanged', tone: 'quiet' },
  'maybe-duplicate': { key: 'sup.imp.status.decide', tone: 'warn' },
  choose: { key: 'sup.imp.status.decide', tone: 'warn' },
  skipped: { key: 'sup.imp.status.skipped', tone: 'quiet' },
  check: { key: 'sup.imp.status.priceCheck', tone: 'warn' },
  error: { key: 'sup.imp.status.error', tone: 'error' },
} as const satisfies Record<string, { key: MessageKey; tone: Tone }>;

export type IngredientStatus = keyof typeof STATUS;

export const isIngredientStatus = (value: unknown): value is IngredientStatus => typeof value === 'string' && Object.hasOwn(STATUS, value);

// The chips (the model's FILTERS) → their words.
export const FILTER_KEYS = {
  all: 'sup.imp.filter.all',
  new: 'sup.imp.status.new',
  'update-price': 'sup.imp.status.updatePrice',
  'history-only': 'sup.imp.status.historyOnly',
  unchanged: 'sup.imp.status.unchanged',
  check: 'sup.imp.status.priceCheck',
  decide: 'sup.imp.status.decide',
  error: 'sup.imp.filter.errors',
} as const satisfies Record<string, MessageKey>;

export const filterKey = (filter: string): MessageKey =>
  (Object.hasOwn(FILTER_KEYS, filter) ? FILTER_KEYS[filter as keyof typeof FILTER_KEYS] : UNKNOWN_REASON_KEY);
