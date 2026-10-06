// reasons.js — every «why» the invoice reader gives (a note on a price, a reason a line, document, file or
// product is left out) is one of these CODES, never a sentence. The reader is pure logic; the words a person
// reads belong in the dictionary (js/i18n.js, through t()) and are chosen by the screen that shows them.
// The Python script wrote Italian sentences; each code below is the same reason, one for one.
// A note that holds several reasons joins their codes with «; ».

export const NOTE = Object.freeze({
  // how a price was reached (reliability alta / media)
  BY_WEIGHT: 'invoiced-by-weight',
  BY_VOLUME: 'invoiced-by-volume',
  WEIGHT_FROM_DESCRIPTION: 'weight-from-description',
  PIECE_WEIGHT_FROM_DESCRIPTION: 'piece-weight-from-description',
  EGG_WEIGHT_FROM_CONFIG: 'egg-weight-from-config',
  EGG_PACK_COUNT_MISSING: 'egg-pack-count-missing',
  EGG_QUANTITY_COUNTS_EGGS: 'egg-quantity-counts-eggs',
  // why a price needs checking, or has none (reliability da verificare)
  EGG_QUANTITY_UNCLEAR: 'egg-quantity-unclear',
  PRICE_OUT_OF_SCALE: 'price-out-of-scale',
  UNATTRIBUTED_DISCOUNT: 'unattributed-discount',
  MIXED_UNITS: 'mixed-units',
  NO_WEIGHT_ON_INVOICE: 'no-weight-on-invoice',
  NO_PRICE_UNIT: 'no-price-unit',
  NO_PIECE_WEIGHT: 'no-piece-weight',
  QUANTITY_ZERO_OR_NEGATIVE: 'quantity-zero-or-negative',
  AMOUNT_ZERO_OR_NEGATIVE: 'amount-zero-or-negative',
  PRICE_UNIT_DIFFERS_FROM_INVOICE: 'price-unit-differs-from-invoice-unit',
  PRICE_UNIT_PACK_MISMATCH: 'price-unit-pack-mismatch',
  PRICE_UNIT_UNREADABLE: 'price-unit-unreadable',
  PACK_WEIGHT_UNREADABLE: 'pack-weight-unreadable',
  PACK_COUNT_UNREADABLE: 'pack-count-unreadable',
});

// Why an invoice line or a whole document is not read (`excluded[].reason`; `detail` carries the one
// variable part: the owner's reason for a supplier, the document type).
export const EXCLUDED = Object.freeze({
  INFO_LINE: 'info-line',
  COSTS: 'costs',
  SEPARATE_DISCOUNT_LINE: 'separate-discount-line',
  SUPPLIER_EXCLUDED: 'supplier-excluded',
  DOCUMENT_TYPE: 'document-type',
  NO_SDI_ID: 'no-sdi-id',
});

// Why a file or an archive was skipped (`skipped[].reason`; `detail` is the parser's message when there is one).
export const SKIPPED = Object.freeze({
  FILE_TOO_LARGE: 'file-too-large',
  DTD_NOT_ALLOWED: 'dtd-not-allowed',
  XML_UNREADABLE: 'xml-unreadable',
  TOO_MANY_INVOICES_IN_FILE: 'too-many-invoices-in-file',
  ZIP_UNREADABLE: 'zip-unreadable',
  TOO_MANY_ENTRIES: 'too-many-entries',
  ARCHIVE_TOO_LARGE: 'archive-too-large',
});

// Why a product is in `products` but not in the import file (`leftOutReason`).
export const LEFT_OUT = Object.freeze({
  NOT_AN_INGREDIENT: 'not-an-ingredient',
  PIECES_NEED_UNIT_AND_WEIGHT: 'pieces-need-price-unit-and-weight',
  PIECES_NEED_PACK_WEIGHT: 'pieces-need-pack-weight',
  NO_COMPUTABLE_PRICE: 'no-computable-price',
  NEEDS_CHECKING: 'needs-checking',
});

export const DOCUMENT_STATUS = Object.freeze({ INCLUDED: 'included', EXCLUDED: 'excluded' });
