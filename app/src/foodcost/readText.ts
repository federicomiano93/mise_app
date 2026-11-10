import { localNumber } from '@mise/shared/currency';
import type { Money } from '@mise/shared/currency';
import { fcNumber } from '@mise/shared/fc-number';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// The words of the read view of a product (the current app's read-sections.js, after 18679a38, d491c7ca and f8770132): the
// small rules of how a stored number is written as text. Pure, so a spec can run them without a screen.

type Translate = (key: MessageKey, params?: MessageParams) => string;

// A number worth showing: finite and above zero. Zero, null and a missing value read «Not set», never «0» or «€0.00», which read as
// «free».
export function positive(value: unknown): value is number {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0;
}

// A COUNT the person typed (minutes, people): not a measure, so it keeps its own figure («30», not «30,00»), in the venue's
// layout.
export function plainCount(value: number, money: Money): string {
  return localNumber(String(value), money);
}

// An amount with its unit, two decimals. Pieces read «12,00 pz» (fc.perKg.pieces): «pezzi» after a 1 read «1,00 pezzi».
export function amountText(t: Translate, money: Money, value: number, unit: string): string {
  return unit === 'pcs' ? t('fc.perKg.pieces', { n: fcNumber(value, money) }) : `${fcNumber(value, money)} ${unit}`;
}

// The weighings, in grams, two decimals; nothing weighed is «Not set».
export function gramsText(money: Money, value: number): string | null {
  return positive(value) ? `${fcNumber(value, money)} g` : null;
}
