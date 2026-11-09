// productValue.ts — the words the money of a product rests on: why a row has no value, and the note
// under the pack weight on a product's screen. Pure: it is handed the translator, the venue's money
// and the interface locale, so every sentence is a spec and none of it freezes the language the
// page booted in.
//
// A port of paintPackNote() and BLOCKER_TEXT of js/inventory/inventory-detail.js.

import { localNumber } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import {
  NO_FROZEN_PRICE, NO_PACK, NO_PRICE, casePackNote, packKgFor, packPrice,
} from '@mise/shared/inventory-value';
import type { CasePackNote, ValueBlocker } from '@mise/shared/inventory-value';
import { formatMoney, formatRate, roundTo, storedCaseOf } from '@mise/shared/price-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { displayNumber } from './stocktakeFormat';

export type Translate = (key: MessageKey, params?: MessageParams) => string;

const BLOCKER_KEY: Readonly<Record<ValueBlocker, MessageKey>> = {
  [NO_PRICE]: 'stock.noPriceYet',
  [NO_PACK]: 'stock.noPackYet',
  [NO_FROZEN_PRICE]: 'stock.noFrozenPrice',
};

// Why a row has no money beside it, in words that say which job would fix it. A product the model
// gives no reason for is told «no price entered», as the original.
export function blockerText(t: Translate, blocker: ValueBlocker | null): string {
  return t(blocker === null ? 'stock.noPriceYet' : BLOCKER_KEY[blocker]);
}

// ⚠️ A PRODUCT PRICED BY THE PIECE OR PER CASE HAS NO KILOS BOX: its cost per counted unit needs no
// pack weight, so «write the kilos in and it gets a value» would send somebody to fill in a number
// that changes nothing.
export function isPricedByUnit(product: Readonly<Record<string, unknown>>): boolean {
  return storedCaseOf(product) !== null || product.priceUnit === 'pcs';
}

// The current app's dictionary keys casePackNote() hands back, as the keys of Mise 2's dictionary.
const CASE_NOTE_KEY: Readonly<Record<CasePackNote['key'], MessageKey>> = {
  'inv.packCaseAmbiguous': 'stock.packCaseAmbiguous',
  'inv.packCasePer': 'stock.packCasePer',
};

type NoteInput = {
  month: unknown;
  product: Readonly<Record<string, unknown>>;
  closed: boolean;
  money: Money;
  locale: string;
};

// What the pack note says the money rests on, for whoever runs the place.
export function packNoteText(t: Translate, { month, product, closed, money, locale }: NoteInput): string {
  const price = packPrice(month, product, closed);

  // ⚠️ A CLOSED MONTH IS NOT A JOB LIST. Its figures are frozen and its boxes are disabled, so
  // «write the kilos in and this product gets a cost» would be an instruction nobody can follow.
  // It says what was recorded at the time instead — and if nothing was, it says that, because
  // entering a price today cannot change what September cost.
  if (closed) {
    return price === null ? t('stock.packNotFrozen') : t('stock.packFrozen', { price: formatMoney(price, money) });
  }

  if (storedCaseOf(product) !== null) {
    const note = casePackNote(product);
    if (note !== null) {
      const key = CASE_NOTE_KEY[note.key];
      // ⚠️ formatRate, not formatMoney: one straw out of 2000 must not read «0.00».
      return 'value' in note
        ? t(key, { price: formatRate(note.value, money), unit: note.unit || t('stock.packsShort') })
        : t(key);
    }
  }

  if (product.priceUnit === 'pcs') {
    return price === null ? t('stock.packByPieceNoPrice') : t('stock.packByPiece', { price: formatMoney(price, money) });
  }

  const kg = packKgFor(month, product, false);
  if (kg === null) {
    const weight = typeof product.weight === 'string' ? product.weight : '';
    return weight ? t('stock.packUnreadable', { text: weight }) : t('stock.packUnknown');
  }

  // Beside a price the kilos take the price's layout (the venue's country), so one line never reads
  // «2.5 kg … 3,40 €»; without a price they follow the interface language.
  return price === null
    ? t('stock.packKnown', { kg: displayNumber(kg, locale) })
    : t('stock.packKnownPriced', {
      kg: localNumber(String(roundTo(kg, 3)), money),
      price: formatMoney(price, money),
    });
}
