import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Share } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useStatusMessage } from '../ui/StatusMessage';
import { joinList } from './orderWords';
import type { OrdersLens } from './ordersLens';
import type { SendRow } from './sendFlow';
import { LONG_MS } from './useClearQuantities';
import { useSendOrder } from './useSendOrder';
import styles from './SendScreen.module.css';

type Props = {
  lens: OrdersLens;
  // The suppliers that can be sent to and their lines. Live: a row that drops out is also dropped from what is ticked.
  rows: readonly SendRow[];
  // The heading that names the list of ticks for a screen reader.
  titleId: string;
  // What is said when there is no row.
  emptyText: string;
  // A recorded order sent again (History): nothing is recorded after it and the same-day unit check is skipped.
  resend?: boolean;
  // A send reached these suppliers. Called before the «not reached» line is spoken; the screen goes on from here.
  onReached: (ids: readonly string[]) => void;
};

// The body both send screens share (the draft's «Send order» and History's «Send <day>»): the tick of every row, «Select all», how
// the message is written and the one «Send» button. What happens AFTER a send that reached somebody is the screen's own (the
// draft goes on to record what was sent; a recorded day goes back to History).
//
// ⚠️ NOTHING IS TICKED WHEN IT OPENS: a message goes to one chat, and who it is for is a decision, not a default.
//
// ⚠️ «SEND» CALLS useSendOrder's `send` STRAIGHT FROM ITS PRESS, with nothing awaited first (a window opened later is blocked as
// a pop-up). A second press while the first is still pending is ignored.
export function SendPicker({ lens, rows, titleId, emptyText, resend = false, onReached }: Props) {
  const { t } = useT();
  const say = useStatusMessage();
  const [send, sendDialogs] = useSendOrder(lens);
  const action = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  const latest = useRef(onReached);
  latest.current = onReached;

  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [grouped, setGrouped] = useState(true);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  // What is sent: ticked AND still in the rows.
  const chosen = rows.filter(row => ticked.includes(row.id));
  const all = rows.length > 0 && chosen.length === rows.length;

  const radios = useRef(new Map<boolean, HTMLButtonElement>());
  const chooseFormat = (next: boolean) => {
    setGrouped(next);
    radios.current.get(next)?.focus();
  };
  const onRadioKey = (event: KeyboardEvent<HTMLButtonElement>, value: boolean) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      chooseFormat(!value);
    }
  };

  // ⚠️ SET ON EVERY MOUNT, not only cleared: StrictMode runs the effect's cleanup and then the effect again.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const press = () => {
    if (pendingRef.current || chosen.length === 0) return;
    pendingRef.current = true;
    setPending(true);
    // ⚠️ A SEND THAT THROWS OR REJECTS MUST NOT LEAVE THE BUTTON DISABLED FOR GOOD: both the synchronous part (the road's first
    // window) and the promise end here, the screen is freed and a friendly line is said. The log carries the error, never the order.
    const failed = (err: unknown) => {
      console.error('Sending the order failed:', err);
      pendingRef.current = false;
      if (!mounted.current) return;
      setPending(false);
      say(t('ord.send.failed'), LONG_MS);
    };
    const going = chosen;
    let sending: ReturnType<typeof send>;
    try {
      // ⚠️ CALLED HERE, IN THE PRESS: takeRoad opens its first window before its first await.
      sending = send({ rows: going, grouped, supplierRoadsOnly: false, ...(resend ? { resend: true } : {}) });
    } catch (err) {
      failed(err);
      return;
    }
    void sending.then(result => {
      pendingRef.current = false;
      if (!mounted.current) return;
      setPending(false);
      // ⚠️ THE TICKED SUPPLIERS THE SEND DID NOT REACH ARE NAMED, never dropped silently (X17): a skipped or blocked window, or a
      // road that has no phone or email for one of them (an employee whose only road is «straight to the supplier» is never shown
      // the chooser's note).
      const reached = result?.kind === 'sent' ? result.ids : [];
      const missed = going.filter(row => !reached.includes(row.id)).map(row => row.name);
      const notReached = result?.kind === 'sent' && missed.length > 0
        ? t('ord.sentCheck.notReached', { names: joinList(t, missed) }) : '';
      if (result?.kind === 'sent' && result.ids.length > 0) {
        latest.current(result.ids);
        if (notReached !== '') say(notReached, LONG_MS);
        return;
      }
      if (result?.kind === 'sent' && result.blocked) say(t('ord.send.nothingOpened'), LONG_MS);
      else if (notReached !== '') say(notReached, LONG_MS);
      // The button was disabled while it ran and a disabled button drops the focus on the page: it goes back to the button. A
      // focus that is somewhere else (the person moved on) is left alone.
      requestAnimationFrame(() => {
        if (!mounted.current) return;
        const active = document.activeElement;
        if (active === null || active === document.body) action.current?.focus();
      });
    }).catch(failed);
  };

  return (
    <>
      {rows.length === 0 ? (
        <p className={styles.empty}>{emptyText}</p>
      ) : (
        <div className={styles.body}>
          <label className={`${styles.tick} ${styles.all}`}>
            <input
              type="checkbox"
              checked={all}
              onChange={event => { setTicked(event.target.checked ? rows.map(row => row.id) : []); }}
            />
            <span className={styles.name}>{t('ord.send.selectAll')}</span>
          </label>
          <ul className={styles.rows} aria-labelledby={titleId}>
            {rows.map(row => (
              <li key={row.id} className={styles.item}>
                <label className={styles.tick}>
                  <input
                    type="checkbox"
                    checked={ticked.includes(row.id)}
                    onChange={event => {
                      setTicked(before => (event.target.checked ? [...before, row.id] : before.filter(id => id !== row.id)));
                    }}
                  />
                  <span className={styles.name}>{row.name}</span>
                  <span className={styles.count}>{t('ord.itemsCount', { n: row.items.length })}</span>
                </label>
              </li>
            ))}
          </ul>
          {/* Not remembered: every send starts with «By supplier». */}
          <div role="radiogroup" aria-label={t('ord.send.format')} className={styles.format}>
            {([true, false] as const).map(value => (
              <button
                key={String(value)}
                ref={node => {
                  if (node) radios.current.set(value, node);
                  else radios.current.delete(value);
                }}
                type="button"
                role="radio"
                aria-checked={grouped === value}
                tabIndex={grouped === value ? 0 : -1}
                className={styles.radio}
                onClick={() => { setGrouped(value); }}
                onKeyDown={event => { onRadioKey(event, value); }}
              >
                {value ? t('ord.send.bySupplier') : t('ord.send.oneList')}
              </button>
            ))}
          </div>
          <div className={styles.actions}>
            <Button ref={action} variant="primary" isDisabled={chosen.length === 0 || pending} onPress={press}>
              <Share aria-hidden="true" />
              {t('ord.send.action')}
            </Button>
          </div>
        </div>
      )}
      {sendDialogs}
    </>
  );
}
