import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useSuppliersStore } from './SuppliersContext';
import { useSupplierDeletions } from './supplierDeletions';

// Deleting a supplier: the question, the delete, «Supplier deleted.» exactly once, and the caller's `after` (leave the
// screen). A port of the delete of js/orders/mgmt-ui.js with his decision F2 added: when products are filed under the
// supplier the question says what becomes of them, because the delete leaves them where they are (parity S36, S87) and the
// current app never said so.
//
// ⚠️ THE SUPPLIER IS MARKED AS DELETED HERE before it goes, so the supplier's own screen — which says «This supplier no
// longer exists.» and leaves when an open supplier vanishes, the way it learns that another phone deleted it — stays quiet
// for a delete made here (supplierDeletions.ts).
//
// Returns [run, dialog]: `run` resolves true when the supplier was deleted, false when the person said no (or another
// question was already open); `dialog` goes in the component's output.
type Target = { readonly id: string; readonly name: string };

export function useDeleteSupplier(): readonly [(supplier: Target, after: () => void) => Promise<boolean>, ReactNode] {
  const { t } = useT();
  const store = useSuppliersStore();
  const say = useStatusMessage();
  const deletions = useSupplierDeletions();
  const [confirm, dialog] = useConfirm();
  const asking = useRef(false);

  async function run(supplier: Target, after: () => void): Promise<boolean> {
    if (asking.current) return false;
    asking.current = true;
    try {
      // Read when the question is asked: the products under the supplier right now.
      const products = store.itemsOfSupplier(supplier.id);
      const question = t('sup.delete.question', { name: supplier.name });
      const ok = await confirm({
        title: t('sup.delete.title'),
        message: products > 0 ? [question, t('sup.delete.products', { n: products })] : question,
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return false;
      deletions.mark(supplier.id);
      store.deleteSupplier(supplier.id);
      say(t('sup.supplierDeleted'));
      after();
      return true;
    } finally {
      asking.current = false;
    }
  }

  return [run, dialog];
}
