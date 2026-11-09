import { useRef } from 'react';
import type { ReactNode } from 'react';
import { isClosed, previousMonth, productsOfMonth } from '@mise/shared/inventory-model';
import { useT } from '../i18n/useT';
import { announceAction } from '../telemetry/usage';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import type { Product } from './countListModel';
import { useStocktakeStore } from './StocktakeContext';
import { monthName } from './stocktakeFormat';
import { frozenFor, uncountedIn } from './stocktakeModel';

export type MonthActions = {
  // The four things a month's screen can do beyond counting. Each asks first where it writes
  // something that is hard to take back, and says what happened in the status message.
  carry: () => void;
  purchases: () => void;
  // Opens «What it cost» with what it is handed, once there is something true to say there.
  seeCost: (open: () => void) => void;
  // Resolve true when the person went ahead (so the screen can follow the focus to the button that
  // takes the pressed one's place), false when they backed out or another action was running.
  close: () => Promise<boolean>;
  reopen: () => Promise<boolean>;
  // The question and the notice themselves: they go in the component's output, next to the buttons.
  dialogs: ReactNode;
};

// «Carry forward», «From the orders», «Close the month» and «Reopen the month» of one month.
//
// ⚠️ ONE ACTION AT A TIME, whichever button started it. The dialog takes time to read, and taps keep
// arriving: a second press while the first is still asking (or still writing) would replace the
// question on screen, or run the action twice. The guard is a ref, so it holds in the very same
// instant as the press — the state of a render would still say «not running».
//
// ⚠️ EVERYTHING IS READ FROM THE STORE AFTER AN ANSWER, never from what the screen drew when the
// question was asked: counts keep arriving from the other phones while somebody reads the dialog,
// and what is frozen into a closed month must be the month as it is when «Close» is pressed. And an
// action never runs on another month than the one it asked about (the browser's Back can change
// the month under an open dialog).
//
// ⚠️⚠️ AND NOTHING RUNS ON A MONTH THAT IS NOT READY, OR THAT HAS BEEN CLOSED MEANWHILE (`shutOut`), before the question AND after
// the answer: a dialog takes time to read, and another phone can close the month under it. With nothing arrived there are no
// rows to warn about, so the close question read as the normal one, and confirming it stamped the month closed with no names
// and no prices (emulator, 2 Nov 2026). The tap says why; the buttons stay dimmed, not disabled (MonthActions).
export function useMonthActions(monthId: string): MonthActions {
  const { t, locale } = useT();
  const store = useStocktakeStore();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const running = useRef(false);

  const stillHere = () => store.getSnapshot().monthId === monthId;

  function shutOut(): boolean {
    const now = store.getSnapshot();
    if (now.month !== null && isClosed(now.month)) {
      say(t('stock.closedElsewhere'));
      return true;
    }
    if (!now.ready) {
      say(t('stock.notReady'));
      return true;
    }
    return false;
  }

  async function once(work: () => Promise<boolean>): Promise<boolean> {
    if (running.current) return false;
    running.current = true;
    try {
      return await work();
    } finally {
      running.current = false;
    }
  }

  // The names of the products ordered in another unit than the stocktake counts in, which the app
  // could not convert: the invoice name and the pack text, as the original (not the display name).
  // Read inside the function, because the language is only known once a venue is open.
  function otherUnitSentence(ids: readonly string[]): string {
    if (ids.length === 0) return '';
    const byId = new Map(store.getSnapshot().ingredients.map(ingredient => [ingredient.id, ingredient]));
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    const names = ids
      .map(id => {
        const ingredient = byId.get(id);
        return [text(ingredient?.name), text(ingredient?.weight)].filter(Boolean).join(' ').trim()
          || t('stock.unnamedProduct');
      })
      .sort((a, b) => a.localeCompare(b))
      .join(', ');
    return t('stock.purchasesOtherUnit', { names });
  }

  // Copy last month's closing counts into this month's openings.
  const carry = () => once(async () => {
    const previous = previousMonth(monthId);
    if (previous === null || shutOut()) return false;
    const ok = await confirm({
      title: t('stock.carryTitle'),
      message: t('stock.carryMessage', { month: monthName(previous, locale) }),
      okLabel: t('stock.carryOk'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok || !stillHere() || shutOut()) return false;
    const moved = await store.pullOpeningFromPrevious(previous);
    // It may have been closed while the read was out, and then nothing was carried.
    if (stillHere() && moved === 0 && shutOut()) return true;
    // ⚠️ THREE ANSWERS, NOT TWO. «That month has nothing in it» and «I could not read it» look the
    // same on screen and mean opposite things — and this screen is used where there is no signal.
    if (moved === null) say(t('stock.carryFailed'));
    else say(moved > 0 ? t('stock.carriedOver', { n: moved }) : t('stock.nothingToCarry'));
    return true;
  });

  // Fill in what was bought from the orders already recorded this month.
  //
  // ⚠️ THE DIALOG SAYS WHAT THIS CANNOT KNOW, and that sentence is the point of the whole feature
  // being a PROPOSAL: the app records what was ORDERED, and knows what did not turn up only where
  // somebody ticked it missing on the delivery. Every row stays editable afterwards.
  const purchases = () => once(async () => {
    if (shutOut()) return false;
    const found = await store.readProposedPurchases();
    if (!stillHere()) return false;
    const month = monthName(monthId, locale);
    if (found.failed) { say(t('stock.purchasesFailed')); return true; }
    if (found.orders === 0) { say(t('stock.purchasesNone', { month })); return true; }

    // Said in a dialog, not in the status message: a message vanishes before a list of names can be
    // read, and a quiet omission would read as «none bought».
    const otherUnit = otherUnitSentence(found.unconverted);
    const notice = () => alert({ message: otherUnit, okLabel: t('common.ok') });
    if (found.products === 0 && otherUnit) {
      await notice();
      return true;
    }

    // ⚠️ ONE COUNT IN THE SENTENCE, AND IT IS THE ONE THAT INFLECTS: it names the products it will
    // fill in, and says it replaces hand-typed figures without counting them.
    const ok = await confirm({
      title: t('stock.purchasesTitle'),
      message: t('stock.purchasesMessage', { month, n: found.products }),
      okLabel: t('stock.purchasesOk'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok || !stillHere() || shutOut()) return false;
    say(t('stock.purchasesFilled', { n: store.applyPurchases(found.totals) }));
    if (otherUnit) await notice();
    return true;
  });

  // Freeze the month, and open the next one with these counts as its opening.
  const close = () => once(async () => {
    const before = store.getSnapshot();
    if (before.monthId !== monthId || before.month === null || shutOut()) return false;
    const month = monthName(monthId, locale);
    const missing = uncountedIn(before.month, productsOfMonth<Product>(before.month, before.ingredients));
    const ok = await confirm({
      title: t('stock.closeTitle'),
      message: missing > 0 ? t('stock.closeMessageMissing', { n: missing, month }) : t('stock.closeMessage', { month }),
      okLabel: t('stock.closeOk'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return false;

    // ⚠️ WHAT IS FROZEN IS THE NAMES AND THE PRICES, not the counts, worked out from the month as it
    // is NOW: an ingredient deleted next spring must still be readable in the month it was counted
    // in, and a price changed next spring must not restate what this month was worth.
    const now = store.getSnapshot();
    if (now.monthId !== monthId || now.month === null || shutOut()) return false;
    const frozen = frozenFor(now.month, productsOfMonth<Product>(now.month, now.ingredients));
    const result = await store.closeMonth(frozen);
    // ⚠️ A REFUSED CLOSE IS NOT RECORDED, AND NOT SAID AS A CLOSE: the store wrote nothing, so «Month closed.» (and a
    // `month-closed` in the usage record) would be a claim about something this phone did not do. There is nothing to follow
    // with the focus either: false.
    if (result.refused) {
      shutOut();
      return false;
    }
    announceAction('month-closed');
    say(result.opened ? t('stock.closedAndOpened', { month: monthName(result.opened, locale) }) : t('stock.closed'));
    return true;
  });

  // Unfreeze a month closed too early. The dialog says the month after it does not change.
  const reopen = () => once(async () => {
    const ok = await confirm({
      title: t('stock.reopenTitle'),
      message: t('stock.reopenMessage'),
      okLabel: t('stock.reopenOk'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok || !stillHere()) return false;
    await store.reopenMonth();
    return true;
  });

  return {
    carry: () => { void carry(); },
    purchases: () => { void purchases(); },
    // ⚠️ A TOTAL OF ZERO AND «NOTHING HAS BEEN COUNTED YET» ARE CLAIMS, and while the month has not arrived they are false.
    seeCost: open => {
      if (store.getSnapshot().ready) open();
      else say(t('stock.notReady'));
    },
    close,
    reopen,
    dialogs: (
      <>
        {confirmDialog}
        {alertDialog}
      </>
    ),
  };
}
