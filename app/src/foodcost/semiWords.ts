import { fcMoney } from '@mise/shared/fc-number';
import type { Money } from '@mise/shared/currency';
import type { SemiCardCost } from '@mise/shared/foodcost-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// The two things the list and the chooser say about a semi-finished card, in words (the figures are semiCardCost's, the same
// ones a line holding the card is costed by, so no screen can say a different number):
//   pill   «11,20 €/kg» — ALWAYS THE MATERIALS: that is the figure other cards put in their cost and food cost %; «no price yet» without it
//   sub    «labour 3,10 €/kg» beside it where the labour is known (the manager's), '' otherwise
// ⚠️ A NUMBER STANDING ALONE IS THE MATERIALS COST PER KG; materials + labour is only ever said with those words (the cost block).
// ⚠️ UNKNOWN IS NEVER 0: a card with no price says so instead of «0,00 €/kg», and labour is left out while the rate is not handed in.
// What the delete question says. A card that other cards use warns what the delete leaves behind: in each of them a line with no price,
// to take off by hand (nothing is rewritten for them). `usedIn` is cardsUsing(...).length.
export function deleteQuestion(t: Translate, name: string, usedIn: number): string {
  return usedIn > 0 ? t('fc.deleteSemiUsedQ', { name, n: usedIn }) : t('fc.deleteProductQ', { name });
}

export function semiFigures(t: Translate, money: Money, cost: SemiCardCost): { pill: string; sub: string } {
  if (cost.materialsPerKg === null || cost.totalPerKg === null) return { pill: t('fc.semi.pillNoPrice'), sub: '' };
  return {
    pill: t('fc.semi.pill', { amount: fcMoney(cost.materialsPerKg, money) }),
    sub: cost.labourPerKg === null ? '' : t('fc.semi.subLabour', { labour: fcMoney(cost.labourPerKg, money) }),
  };
}
