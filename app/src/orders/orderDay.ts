// orderDay.ts — the day a supplier's rows are for and the day its order is recorded under (parity D3, decision F3). Pure.
import { localDayOf } from '@mise/shared/day';
import { recordDay } from '@mise/shared/order-day';
import type { DraftView } from './draftSync';

type DayDraft = Pick<DraftView, 'days' | 'updatedAt'>;

// The day the supplier's rows are FOR (js/orders/orders-main.js rawDayFor): the stored stamp, else the local day the draft was
// last written on (a draft from before stamps existed), else today. It can be in the future (a day chosen ahead).
export function rawDayFor(draft: DayDraft, supplierId: string, today: string): string {
  return draft.days[supplierId] || localDayOf(draft.updatedAt) || today;
}

// The day the order is RECORDED under: never a day that has not come (decision F3, `recordDay`), so an order stamped for
// «Tomorrow» and placed now is filed under today, the day it really left.
export function recordDateFor(draft: DayDraft, supplierId: string, today: string): string {
  return recordDay(rawDayFor(draft, supplierId, today), today) ?? today;
}
