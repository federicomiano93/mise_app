import { BLOCKER_TEXT } from '@mise/shared/foodcost-model';
import type { CostResult, FoodCostStatus } from '@mise/shared/foodcost-model';
import type { Money } from '@mise/shared/currency';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// The traffic light's words. Keys, resolved when a row is drawn: a `t()` here at module load would
// freeze the language the page booted in.
const STATUS_TEXT = {
  green: 'fc.onTarget',
  amber: 'fc.slightlyOver',
  red: 'fc.overTarget',
} as const satisfies Record<FoodCostStatus, MessageKey>;

// The dot's word. A product with no target has nothing to be measured against, and says so.
export function statusWord(t: Translate, status: FoodCostStatus | null): string {
  return status === null ? t('fc.noTargetSet') : t(STATUS_TEXT[status]);
}

// «31,50%», ALWAYS two decimals, in the venue's own layout (the owner, 8 Nov 2026; current app 151ea191, shared/fc-number), or «—» while the
// product cannot be costed (never a 0%: a food cost of nothing would read as a product that costs nothing to make).
export function figureText(result: CostResult, money: Money): string {
  return result.foodCostPct === null ? '—' : percentText(result.foodCostPct, money);
}

export function percentText(value: number, money: Money): string {
  return `${fcNumber(value, money)}%`;
}

// ONE line under the name, so every row is the same height: what it earns when it can be costed,
// otherwise the first thing still missing.
export function subLine(t: Translate, result: CostResult, money: Money): string {
  if (result.foodCostPct !== null) {
    return [
      statusWord(t, result.status),
      t('fc.listCost', { cost: fcMoney(result.unitCost, money) }),
      t('fc.listMargin', { margin: fcMoney(result.margin, money) }),
    ].join('  ·  ');
  }
  const first = result.blockers[0];
  return first === undefined ? t('fc.notCostedYet') : t(BLOCKER_TEXT[first]);
}
