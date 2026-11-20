import { fcMoney } from '@mise/shared/fc-number';
import type { Money } from '@mise/shared/currency';
import type { SemiCardCost } from '@mise/shared/foodcost-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Translate = (key: MessageKey, params?: MessageParams) => string;

// The two things the list and the chooser say about a semi-finished card, in words (the figures are semiCardCost's, the same
// ones a line holding the card is costed by, so no screen can say a different number):
//   pill   «14,30 €/kg» — materials plus labour where labour is known, the materials alone otherwise; «no price yet» without any
//   sub    «materials 11,20 · labour 3,10», or «materials 11,20» while the labour is not known; '' without a price
// ⚠️ UNKNOWN IS NEVER 0: a card with no price says so instead of «0,00 €/kg», and labour is left out while the rate is not handed in.
export function semiFigures(t: Translate, money: Money, cost: SemiCardCost): { pill: string; sub: string } {
  if (cost.materialsPerKg === null || cost.totalPerKg === null) return { pill: t('fc.semi.pillNoPrice'), sub: '' };
  const materials = fcMoney(cost.materialsPerKg, money);
  return {
    pill: t('fc.semi.pill', { amount: fcMoney(cost.totalPerKg, money) }),
    sub: cost.labourPerKg === null
      ? t('fc.semi.subMaterials', { materials })
      : t('fc.semi.subLabour', { materials, labour: fcMoney(cost.labourPerKg, money) }),
  };
}
