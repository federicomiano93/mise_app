import { useId, useLayoutEffect, useRef } from 'react';
import type { FocusEvent } from 'react';
import { useT } from '../i18n/useT';
import { useOrders } from './OrdersContext';
import { SEARCH_BOX, useHandBack } from './handBack';
import { awaitingSentence } from './awaitingWords';
import type { OrdersLens } from './ordersLens';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useAnswerAwaiting } from './useAnswerAwaiting';
import styles from './AwaitingBanners.module.css';

// «Order to Bruno sent at 10:42: did it go?» with «Yes» / «No», one row per waiting supplier, oldest first, on EVERY device (the order
// of 14 Nov 2026: an order left with a line missing and nobody was asked, because the question lived only on the device that opened
// WhatsApp). Under the Orders head, on the supplier list and on the flat view, above the notices.
//
// ⚠️ ALWAYS VISIBLE, NEVER INSIDE THE BELL'S PANEL (decision P2 of the port): an order handed over and never answered is the order
// that used to go unrecorded, and a panel nobody opens would hide exactly that.
//
// ⚠️ THE CONTAINER IS ON THE PAGE BEFORE IT SPEAKS and only its rows come and go: a live region inserted already filled is not
// announced reliably.
//
// ⚠️ FOCUS SURVIVES. Tapping «Yes» flips the row to busy, and a re-render must not throw a keyboard or screen-reader user off the
// button: rows are keyed by supplier, the buttons stay in the page, and while an answer is under way they are `aria-disabled` — NOT
// `disabled`, which cannot hold the focus. When the answered row goes, the focus moves to the next row's «Yes», else to the search
// box, a stable control just above.
export function AwaitingBanners({ lens }: { lens: OrdersLens }) {
  const { t, locale } = useT();
  const { awaiting } = useOrders();
  const [answer, dialogs] = useAnswerAwaiting(lens);
  const handBack = useHandBack();
  const base = useId();
  const rows = awaiting.questions;

  const yesButtons = useRef(new Map<string, HTMLButtonElement>());
  const order = useRef<readonly string[]>([]);
  // Which row's button had the focus last, kept while the focus is merely on its way out of a row that is being removed.
  const focused = useRef<string | null>(null);

  useLayoutEffect(() => {
    const now = rows.map(row => row.supplierId);
    const before = order.current;
    order.current = now;
    const was = focused.current;
    if (was === null || now.includes(was)) return;
    focused.current = null;
    // The focused button left with its row: the page has the focus now. The next row's «Yes», or the search box above.
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const at = before.indexOf(was);
    const next = at < 0 ? undefined : before.slice(at + 1).find(id => now.includes(id));
    const target = next === undefined ? undefined : yesButtons.current.get(next);
    if (target) target.focus();
    else handBack.focus(SEARCH_BOX);
  }, [rows, handBack]);

  const onFocus = (supplierId: string) => () => { focused.current = supplierId; };
  const onBlur = (event: FocusEvent<HTMLButtonElement>) => {
    // The focus went to another control: it is not on its way out of a removed row.
    if (event.relatedTarget !== null) focused.current = null;
  };

  return (
    <>
      <div className={styles.banners} role="status" aria-live="polite">
        {rows.map(({ supplierId, entry }) => {
          const supplier = lens.supplierById(supplierId);
          const name = supplier ? supplierLabel(supplier) : '';
          const sentence = awaitingSentence(t, locale, name, entry.at);
          const sentenceId = `${base}-${supplierId}`;
          const waiting = awaiting.busy.includes(supplierId);
          const press = (which: 'yes' | 'no') => () => {
            // Ignored while this device is answering: the store's own busy guard would refuse it anyway.
            if (waiting) return;
            void answer(supplierId, which, entry.at);
          };
          return (
            <div key={supplierId} className={styles.row}>
              <p id={sentenceId} className={styles.sentence}>{sentence}</p>
              <div className={styles.actions}>
                <button
                  ref={node => {
                    if (node) yesButtons.current.set(supplierId, node);
                    else yesButtons.current.delete(supplierId);
                  }}
                  type="button"
                  className={`${styles.button} ${styles.yes}`}
                  aria-describedby={sentenceId}
                  aria-disabled={waiting ? true : undefined}
                  onFocus={onFocus(supplierId)}
                  onBlur={onBlur}
                  onClick={press('yes')}
                >
                  {t('ord.awaiting.yes')}
                </button>
                <button
                  type="button"
                  className={styles.button}
                  aria-describedby={sentenceId}
                  aria-disabled={waiting ? true : undefined}
                  onFocus={onFocus(supplierId)}
                  onBlur={onBlur}
                  onClick={press('no')}
                >
                  {t('ord.awaiting.no')}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {dialogs}
    </>
  );
}
