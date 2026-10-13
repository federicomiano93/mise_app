import { useRef } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { getClientById, getVisibleRecipes } from '@mise/shared/calculator-config';
import { calculatorPatch } from '@mise/shared/client-order-model';
import { lockKey, parseLock, qtyKey } from '@mise/shared/calculator-tab-keys';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS } from '../shell/Page';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useCalculatorStore, useClientOrdersStore } from './CalculatorContext';
import { inspectPatch, joinList } from './clientOrdersView';
import type { ApplyTarget } from './clientOrdersView';
import type { ClientOrder } from './clientOrdersStore';
import { CALCULATOR_PATH, recipePath } from './calculatorPath';
import { useTabState } from './TabStateContext';
import styles from './ClientOrderApply.module.css';

// Putting a client's own order into the quantity boxes (js/calculator-client-orders.js `applyOrder`): look first, say
// what will change, then write — NEVER silently.
//
//   const [apply, dialogs] = useApplyOrder();   // `dialogs` goes in the component's output
//   <Button onPress={() => { void apply(order); }}>…</Button>
//
// ⚠️ NOTHING MOVES A NUMBER BY ITSELF. An order can be corrected, can arrive while a dough is already being
// calculated, and can be wrong: the owner reads it and taps. Three things are never silent:
//   1. an order that CHANGED after it was used (the card says it; this file records «used» only after the boxes moved);
//   2. a box that already holds a different number, before it is overwritten;
//   3. a tab that has been confirmed, whose boxes are locked and will not move.
export function useApplyOrder(): readonly [(order: ClientOrder) => Promise<void>, ReactNode] {
  const { t, locale } = useT();
  const navigate = useNavigate();
  const calculator = useCalculatorStore();
  const orders = useClientOrdersStore();
  const tabs = useTabState();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  // A second press while the first one is still being answered is ignored.
  const running = useRef(false);

  const say = (message: string) => alert({ message, okLabel: t('common.ok') });

  async function run(order: ClientOrder): Promise<void> {
    const config = calculator.getSnapshot().config;
    const client = getClientById(config, order.clientId);
    if (!client) {
      await say(t('calc.co.clientGone', { client: String(order.clientName ?? '') || t('calc.co.thisClient') }));
      return;
    }

    const targets = inspectPatch(config, calculatorPatch(order, client.products), tabs.read);
    if (targets.length === 0) {
      await say(t('calc.noneOfThisClient'));
      return;
    }

    // ⚠️ A CONFIRMED TAB DOES NOT MOVE, and saying so beforehand is the difference between «the app ignored me» and «I
    // know what to do». Its boxes are locked until Edit is tapped, exactly as they are for a person typing.
    const lockedNames = [...new Set(targets.filter(target => target.locked).map(target => target.recipeName))];
    const lockedSentence = lockedNames.length > 0
      ? t('calc.co.someLocked', { n: lockedNames.length, names: joinList(t, lockedNames) })
      : null;
    if (targets.every(target => target.locked)) {
      await say(t('calc.co.allLocked', { n: lockedNames.length, names: joinList(t, lockedNames) }));
      return;
    }

    // ⚠️ THE OVERWRITE WARNING NAMES THE ROWS. «Some values will change» is a sentence nobody can check; a list of what
    // is about to be replaced is one they can.
    const clashes = targets.filter(target => !target.locked && target.current > 0 && target.current !== target.next);
    const ask = t('calc.co.putOrderIn', { client: client.name });
    const number = new Intl.NumberFormat(locale);

    const answer = await confirm(clashes.length > 0
      ? {
          title: t('calc.thisWillReplaceWhat'),
          message: t('calc.theseAlreadyHaveA'),
          body: (
            <>
              <ul className={styles.clashes}>
                {clashes.map(clash => (
                  <li key={clash.qtyId} className={styles.clash}>
                    <span className={styles.product}>{`${clash.productName}:`}</span>
                    <span className={styles.change}>{`${number.format(clash.current)} → ${number.format(clash.next)}`}</span>
                  </li>
                ))}
              </ul>
              {lockedSentence === null ? null : <p className={styles.paragraph}>{lockedSentence}</p>}
              <p className={styles.ask}>{ask}</p>
            </>
          ),
          okLabel: t('calc.putItIn'),
          cancelLabel: t('common.cancel'),
          danger: true,
        }
      : {
          title: ask,
          ...(lockedSentence === null ? {} : { message: lockedSentence }),
          okLabel: t('calc.putItIn'),
          cancelLabel: t('common.cancel'),
        });
    if (!answer) return;

    // The tab's lock is read again: a question can stay open while the person does something else.
    const written: ApplyTarget[] = targets.filter(target =>
      !target.locked && !parseLock(tabs.read(lockKey(target.recipeId)))?.locked);
    if (written.length === 0) return;

    // The same write a typed number makes: the boxes keep their text under the current app's own keys and the tab is
    // stamped as used, or the new-work-day sweep would clear these on the next opening as though nobody had touched
    // the tab. Each tab recalculates from what it reads, so a recipe is drawn once however many boxes moved.
    for (const target of written) tabs.set(qtyKey(target.qtyId), String(target.next), target.recipeId);

    // ⚠️ RECORDED ONLY AFTER THE BOXES REALLY MOVED, and a failure to record is said (the store's message): if the app
    // cannot remember that this order was used, it can no longer tell you when the client changes it.
    orders.markApplied(order);

    // Back to the work view, on the tab of the first recipe (in tab order) that received a number.
    const receiving = new Set(written.map(target => target.recipeId));
    const first = getVisibleRecipes(calculator.getSnapshot().config).find(recipe => receiving.has(recipe.id));
    void navigate(first ? recipePath(first.id) : CALCULATOR_PATH, { replace: true, state: KEEP_FOCUS });
  }

  const apply = async (order: ClientOrder): Promise<void> => {
    if (running.current) return;
    running.current = true;
    try {
      await run(order);
    } finally {
      running.current = false;
    }
  };

  return [apply, <>{confirmDialog}{alertDialog}</>];
}
