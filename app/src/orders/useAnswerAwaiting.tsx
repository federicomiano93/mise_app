import { useCallback, useRef } from 'react';
import type { ReactNode } from 'react';
import { ingredientDisplayLabel } from '@mise/shared/archive';
import { todayISO } from '@mise/shared/day';
import { useT } from '../i18n/useT';
import { announceAction } from '../telemetry/usage';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useOrders, useOrdersStore } from './OrdersContext';
import { awaitingSupplierName } from './awaitingWords';
import type { OrdersLens } from './ordersLens';
import type { AwaitingOutcome } from './ordersStore';
import { unitConflictOfLines } from './unitConflictText';
import { LONG_MS } from './useClearQuantities';
import { joinList } from './orderWords';

// «Yes» / «No» to «did it go?», from a banner or the sender's dialog: asks the store and says how it ended, in the person's words.
//
//   const [answer, answerDialogs] = useAnswerAwaiting(lens);
//   void answer(supplierId, 'yes', at);
//
// The second value is the dialogs it may open («It may already be recorded», and the unit-clash notice) and goes in the component's
// output. The store decides everything; this only words the outcome:
//   • recorded / failed say what placing says (the confirm screen's own sentences), once;
//   • «No» says the quantities stay; «Don't record» says «Not recorded.»;
//   • an answer given elsewhere, or «Yes» offline, or a claim that could not be made, say so — and nothing was done.
export function useAnswerAwaiting(lens: OrdersLens): readonly [
  (supplierId: string, answer: 'yes' | 'no', at: string) => Promise<AwaitingOutcome>, ReactNode,
] {
  const { t } = useT();
  const store = useOrdersStore();
  const { suppliers } = useOrders();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  // The latest of everything the answer reads: it is called from a press and may finish long after that render.
  const latest = useRef({ t, suppliers, say, confirm, alert, lens });
  latest.current = { t, suppliers, say, confirm, alert, lens };

  const answer = useCallback(async (supplierId: string, which: 'yes' | 'no', at: string): Promise<AwaitingOutcome> => {
    const name = () => awaitingSupplierName(latest.current.suppliers, supplierId, latest.current.t);
    // ⚠️ THE DAY THE QUESTION WAS FOR, TAKEN BEFORE ANSWERING: the claim removes the question from the page, and a unit clash is
    // worded by the day it is about — read afterwards it would fall back to today.
    const askedFor = store.getSnapshot().awaiting.questions
      .find(question => question.supplierId === supplierId && question.entry.at === at)?.entry.date ?? '';
    const outcome = await store.answerAwaiting(supplierId, which, at, () => {
      const { t: tt, confirm: ask } = latest.current;
      return ask({
        title: tt('ord.awaiting.maybeRecorded.title'),
        message: tt('ord.awaiting.maybeRecorded.body', { supplier: name() }),
        okLabel: tt('ord.awaiting.maybeRecorded.yes'),
        cancelLabel: tt('ord.awaiting.maybeRecorded.no'),
      });
    }, latest.current.t('ord.noSupplier'));

    const { t: tt, say: speak } = latest.current;
    if (outcome.kind === 'elsewhere') speak(tt('ord.awaiting.elsewhere'), 4000);
    else if (outcome.kind === 'offline') speak(tt('ord.offline.place'), LONG_MS);
    else if (outcome.kind === 'declined') speak(tt('ord.awaiting.notRecorded'), 5000);
    else if (outcome.kind === 'kept') speak(tt('ord.awaiting.kept', { supplier: name() }), 5000);
    else if (outcome.kind === 'claim-failed') speak(tt('ord.awaiting.couldNotSave'), LONG_MS);
    else if (outcome.kind === 'recorded' || outcome.kind === 'failed') {
      const place = outcome.place;
      if (place === null) {
        speak(tt('ord.offline.place'), LONG_MS);
      } else if (place.kind === 'saved') {
        announceAction('order-sent');
        speak(tt('ord.savedToHistory', { names: name() }), 5000);
      } else if (place.kind === 'not-cleared') {
        announceAction('order-sent');
        speak(tt('ord.savedNotCleared', { name: name() }), LONG_MS);
      } else if (place.kind === 'unit-conflict') {
        const known = latest.current.lens.lines;
        const names = place.ids.map(id => {
          const line = known.find(candidate => candidate.id === id);
          return (line && ingredientDisplayLabel(line)) || id;
        });
        await latest.current.alert({
          message: unitConflictOfLines({ date: askedFor || todayISO(), names, now: new Date(), t: tt }),
          okLabel: tt('common.ok'),
        });
      } else {
        speak(`${tt('ord.notRecorded', { names: joinList(tt, [name()]) })} ${tt('ord.tryAgain')}`, LONG_MS);
      }
    }
    return outcome;
  }, [store]);

  return [answer, <>{confirmDialog}{alertDialog}</>];
}
