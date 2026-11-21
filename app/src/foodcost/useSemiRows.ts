import { useMemo } from 'react';
import { semiCardCost, wouldBeTooDeep, wouldLoop } from '@mise/shared/foodcost-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { categoryIdOf } from './categoriesModel';
import { useFoodcost } from './FoodcostContext';
import { semiFigures } from './semiWords';

// One semi-finished card as a chooser offers it: its category, why it cannot be chosen (null: it can), and its figures in words.
export type SemiRow = {
  card: ReturnType<typeof useFoodcost>['products'][number];
  categoryId: string | null;
  reason: Extract<MessageKey, 'fc.pick.itself' | 'fc.pick.alreadyHere' | 'fc.pick.loops' | 'fc.pick.tooDeep'> | null;
  figures: { pill: string; sub: string };
};

// ⚠️ MODEL 4: ONLY SEMI-FINISHED CARDS ARE OFFERED, each with its cost per kilo (semiCardCost: the figure a line holding it is costed by),
// by name. The card itself, one already on this card and one that would hold this card again are listed, said, and cannot be chosen.
// The ONE source of the semi-finished list: Food cost's chooser dialog and Cakes' search box read the same rows.
export function useSemiRows(cardId: string, usedSemiIds: readonly string[]): SemiRow[] {
  const { t } = useT();
  const money = useMoney();
  const { products, categories, tables } = useFoodcost();
  return useMemo(() => products
    .filter(card => card.kind === 'semi' && card.name.trim() !== '')
    .map((card): SemiRow => {
      const reason = card.id === cardId ? 'fc.pick.itself' as const
        : usedSemiIds.includes(card.id) ? 'fc.pick.alreadyHere' as const
          : wouldLoop(tables.products, cardId, card.id) ? 'fc.pick.loops' as const
            // ⚠️ Not a loop but too many cards inside each other (MAX_SEMI_DEPTH), for this card or for the cards that already hold it.
            : wouldBeTooDeep(tables.products, cardId, card.id) ? 'fc.pick.tooDeep' as const
              : null;
      const figures = semiFigures(t, money, semiCardCost(card, tables));
      return { card, categoryId: categoryIdOf(card, categories), reason, figures };
    })
    .sort((a, b) => a.card.name.localeCompare(b.card.name)), [products, categories, tables, cardId, usedSemiIds, t, money]);
}
