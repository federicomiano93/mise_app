import { useCallback } from 'react';
import type { ReactNode } from 'react';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { useConfirm } from '../ui/useConfirm';
import { useStatusMessage } from '../ui/StatusMessage';
import { useOrdersStore } from './OrdersContext';
import { whoWords } from './orderWords';
import type { OrdersLens } from './ordersLens';

// How long a refusal that says what to do stays on screen (the usual message is gone in under three seconds).
export const LONG_MS = 8000;

// «Clear quantities» (parity X11): the ONE path for the supplier's own screen and the picker, so the two can never behave
// differently. Resolves true when the quantities were cleared.
//
//   const [clearQuantities, clearDialog] = useClearQuantities(lens);
//   if (await clearQuantities([id])) leave();
//
// The second value is the dialog itself and goes in the component's output.
export function useClearQuantities(lens: OrdersLens): readonly [(ids: readonly string[]) => Promise<boolean>, ReactNode] {
  const { t } = useT();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const [confirm, dialog] = useConfirm();

  const clear = useCallback(async (ids: readonly string[]): Promise<boolean> => {
    if (ids.length === 0) return false;
    // Refused offline: the write would wait, and the clear would land at some other moment than the screen shows.
    if (navigator.onLine === false) {
      say(t('ord.offline.clear'), LONG_MS);
      return false;
    }
    const names = ids.map(id => supplierLabel(lens.supplierById(id))).filter(name => name !== '');
    const sure = await confirm({
      title: t('ord.clear.title'),
      message: t('ord.clear.confirm', { who: whoWords(t, names) }).split('\n\n'),
      okLabel: t('ord.clear.ok'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!sure) return false;
    const outcome = await store.clearQuantities(ids, t('ord.noSupplier'));
    if (outcome === 'cleared') {
      say(ids.length === 1 ? t('ord.clear.done') : t('ord.clear.doneMany', { n: ids.length }), 4000);
      return true;
    }
    // Failed: the screen is clear and the database is not, and no snapshot will correct that — say so plainly.
    say(outcome === 'offline' ? t('ord.offline.clear') : t('ord.clear.failed'), LONG_MS);
    return false;
  }, [confirm, lens, say, store, t]);

  return [clear, dialog];
}
