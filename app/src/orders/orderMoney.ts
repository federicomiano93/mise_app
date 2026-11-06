import type { Money } from '@mise/shared/currency';
import { localNumber } from '@mise/shared/currency';
import { supplierSummary } from '@mise/shared/order-summary';
import type { SupplierSummary, SummaryCostLine } from '@mise/shared/order-summary';
import { formatMoney, withPrices } from '@mise/shared/price-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { DraftView } from './draftSync';
import type { OrdersLens } from './ordersLens';

// The order's money, drawn by Orders (step 3f-8c, parity L19/L20). Pure: the screens only draw what this answers.

type Translate = (key: MessageKey, params?: MessageParams) => string;

// ⚠️ THE SAME SELECTION AS THE MESSAGE. The lines are the lens's linesOf (what sendFlow's draftSendRows hands to orderedItems), so the
// summary can never show a line the supplier will not receive. Prices are laid over them ONLY when the read of ingredient-prices
// succeeded (`readable`): otherwise every cost comes back null, and the screens must not draw it either way.
export function summaryFor(
  lens: OrdersLens,
  supplierId: string,
  draft: DraftView,
  prices: Readonly<Record<string, object | null | undefined>>,
  readable: boolean,
): SupplierSummary {
  const lines = lens.linesOf(supplierId);
  return supplierSummary(lens.supplierById(supplierId), readable ? withPrices(lines, prices) : lines, draft.entries);
}

// One ordered line's money, the small line under its quantity: «4 × 45,00 € = 180,00 € · VAT 4%», or what is missing instead.
// The quantity is written in the money's layout, so one line never mixes «2.5 × 6,50 €».
export function lineCostText(t: Translate, money: Money, line: Pick<SummaryCostLine, 'qty' | 'unitCost' | 'vatRate'>): { text: string; warn: boolean } {
  const { qty, unitCost, vatRate } = line;
  if (unitCost === null || unitCost === undefined) return { text: t('ord.cost.noPrice'), warn: true };
  const base = t('ord.cost.lineTotal', { qty: localNumber(qty, money), rate: formatMoney(unitCost, money), total: formatMoney(qty * unitCost, money) });
  if (vatRate === null || vatRate === undefined) return { text: `${base} · ${t('ord.cost.vatNotStated')}`, warn: true };
  return { text: `${base} · ${t('ord.cost.vatAtRate', { rate: vatRate })}`, warn: false };
}
