import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { sectionsFor } from '@mise/shared/sections';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useIngredientDeletions } from './ingredientDeletions';
import { useSuppliersStore } from './SuppliersContext';

// Deleting an ingredient or a packaging item: count what uses it, ask, delete, say «Ingredient deleted.» exactly once, and
// leave. A port of the delete of js/ingredient-record-form.js with his decision F5 added: the question carries the number of
// recipes and Food cost products that name the item, because the delete leaves them pointing at nothing (parity C94, C95).
//
// ⚠️ THE COUNT IS READ WHEN THE BIN IS TAPPED, from the server, and the bin is disabled and busy until it answers (a second tap
// does nothing). A count that could not be made says the current app's sentence with no numbers, never a false «no recipe».
//
// ⚠️ THE PRICE DOCUMENT GOES TOO ONLY FOR A PERSON WHO MAY WRITE PRICES (parity S11, C-K): the role AND the Food cost section on,
// as the session narrows it. A batch is all-or-nothing, so a price delete the rules refuse would fail the whole delete.
//
// ⚠️ THE ITEM IS MARKED AS DELETED HERE before it goes, so the card — which says «This ingredient no longer exists.» when an
// item vanishes — stays quiet for a delete made here (ingredientDeletions.ts).
//
// Returns [run, dialog, counting]: `run` resolves true when the item was deleted, false when the person said no (or another
// delete was already under way); `dialog` goes in the component's output.
type Target = { readonly id: string; readonly name: string };

export function useDeleteIngredient(): readonly [(item: Target, after: () => void) => Promise<boolean>, ReactNode, boolean] {
  const { t } = useT();
  const store = useSuppliersStore();
  const say = useStatusMessage();
  const deletions = useIngredientDeletions();
  const { canManage, location, role } = useSession();
  const [confirm, dialog] = useConfirm();
  const asking = useRef(false);
  const [counting, setCounting] = useState(false);

  async function run(item: Target, after: () => void): Promise<boolean> {
    if (asking.current) return false;
    asking.current = true;
    try {
      setCounting(true);
      const usage = await store.ingredientUsage(item.id);
      setCounting(false);
      const message = usage.recipes === null || usage.products === null
        ? t('sup.ing.delete.unknown')
        : usage.recipes === 0 && usage.products === 0
          ? t('sup.ing.delete.unused')
          : t('sup.ing.delete.used', {
            recipes: t('sup.ing.delete.recipes', { n: usage.recipes }),
            products: t('sup.ing.delete.products', { n: usage.products }),
          });
      const ok = await confirm({
        title: t('sup.ing.delete.title', { name: item.name }),
        message,
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return false;
      const mayWritePrices = canManage && sectionsFor(location, role).foodcost === true;
      deletions.mark(item.id);
      store.deleteIngredient(item.id, mayWritePrices);
      say(t('sup.ingredientDeleted'));
      after();
      return true;
    } finally {
      setCounting(false);
      asking.current = false;
    }
  }

  return [run, dialog, counting];
}
