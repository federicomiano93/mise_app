import { normalizeVat } from '@mise/shared/vat-number';
import { WEEKDAYS, isWeekday } from './supplierDays';
import type { Weekday } from './supplierDays';
import type { StoredDoc } from './suppliersSource';
import type { SupplierPayload } from './suppliersStore';

// The supplier card's working copy and what Save sends (parity S79, S82): the pure half of SupplierCard.tsx.

// The two names, the category and the contact boxes are text; the days are the ticked weekdays. Everything is what the
// boxes hold NOW — nothing is trimmed until it is saved.
export interface Working {
  readonly name: string;
  readonly shortName: string;
  readonly category: string;
  readonly phone: string;
  readonly email: string;
  readonly vatNumber: string;
  readonly deliveryDays: readonly Weekday[];
  readonly orderDays: readonly Weekday[];
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const daysOf = (value: unknown): Weekday[] => (Array.isArray(value) ? value : []).filter(isWeekday);

// The copy a card is made from: the stored supplier, or an empty one (a new supplier starts empty, with placeholders).
// ⚠️ MADE ONCE, when the card opens (SupplierCard): a supplier changed on another phone afterwards never replaces it.
export function workingFrom(supplier: StoredDoc | null): Working {
  return {
    name: text(supplier?.name),
    shortName: text(supplier?.shortName),
    category: text(supplier?.category),
    phone: text(supplier?.phone),
    email: text(supplier?.email),
    vatNumber: text(supplier?.vatNumber),
    deliveryDays: daysOf(supplier?.deliveryDays),
    orderDays: daysOf(supplier?.orderDays),
  };
}

// A day ticked or unticked. The days stay in the order of the week, however they were ticked.
export function toggleDay(days: readonly Weekday[], day: Weekday, on: boolean): Weekday[] {
  return WEEKDAYS.filter(candidate => (candidate === day ? on : days.includes(candidate)));
}

// The only validation there is (parity S81): a name that is not blank.
export const hasName = (working: Working): boolean => working.name.trim() !== '';

// What Save sends, EXACTLY (parity S82).
//  - `shortName` is '' when blank, never left out: the write is a merge, and only an empty string can clear one.
//  - `active` is what the supplier already has (an edit never switches one back on); a new supplier is on.
//  - `vatNumber` is the canonical form the invoice import matches on; '' clears it.
export function payloadOf(working: Working, supplier: StoredDoc | null): SupplierPayload {
  return {
    name: working.name.trim(),
    shortName: working.shortName.trim(),
    category: working.category.trim(),
    phone: working.phone.trim(),
    email: working.email.trim(),
    deliveryDays: inWeekOrder(working.deliveryDays),
    orderDays: inWeekOrder(working.orderDays),
    active: supplier === null ? true : supplier.active !== false,
    vatNumber: normalizeVat(working.vatNumber),
  };
}

const inWeekOrder = (days: readonly Weekday[]): Weekday[] => WEEKDAYS.filter(day => days.includes(day));
