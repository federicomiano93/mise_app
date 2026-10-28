import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Share } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useOrders } from './OrdersContext';
import { SEND_OPENER, useHandBack } from './handBack';
import { cameFromList, confirmState, useLeave } from './ordersNav';
import { ORDERS_PATH, PLACE_ALL_CONFIRM_PATH } from './ordersPath';
import type { OrdersLens } from './ordersLens';
import { draftSendRows } from './sendFlow';
import { LONG_MS } from './useClearQuantities';
import { useSendOrder } from './useSendOrder';
import styles from './SendScreen.module.css';

// «Send order» (parity X15–X21, step 3f-3), at /orders/send: the suppliers with something in the order, each a tick, over a
// choice of how the WhatsApp message is written and one «Send» button. One level below the list; Back is Back (P20).
//
// ⚠️ NOTHING IS TICKED WHEN IT OPENS: a message goes to one chat, and who it is for is a decision, not a default (the picker
// that records ticks everything because recording is local; sending is not).
//
// ⚠️ «SEND» CALLS useSendOrder's `send` STRAIGHT FROM ITS PRESS, with nothing awaited first (a window opened later is blocked as
// a pop-up). A second press while the first is still pending is ignored.
//
// A send that reached suppliers goes on to the confirm screen, where they are recorded as ordered (record-after-send, parity
// X10): opening WhatsApp is not sending, so «Did you send it?» is still asked there.
export function SendScreen({ lens }: { lens: OrdersLens }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const { draft } = useOrders();
  const handBack = useHandBack();
  const leave = useLeave(ORDERS_PATH, () => { handBack.expect(SEND_OPENER); });
  const [send, sendDialogs] = useSendOrder(lens);
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const action = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);

  // The rows are live: another phone's quantities appear, a supplier whose lines were cleared drops out.
  const rows = useMemo(() => draftSendRows(lens, draft), [lens, draft]);
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

  useEffect(() => {
    mounted.current = true;
    // Opened from the list the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
    return () => { mounted.current = false; };
  }, []);

  const press = () => {
    if (pendingRef.current || chosen.length === 0) return;
    pendingRef.current = true;
    setPending(true);
    // ⚠️ CALLED HERE, IN THE PRESS: takeRoad opens its windows before its first await.
    const sending = send({ rows: chosen, grouped, supplierRoadsOnly: false });
    void sending.then(result => {
      pendingRef.current = false;
      if (!mounted.current) return;
      setPending(false);
      if (result?.kind === 'sent' && result.ids.length > 0) {
        // Record-after-send: the confirm screen takes the suppliers that were reached.
        void navigate(PLACE_ALL_CONFIRM_PATH, { state: confirmState(state, { ids: result.ids, afterSend: true }) });
        return;
      }
      if (result?.kind === 'sent' && result.blocked) say(t('ord.send.nothingOpened'), LONG_MS);
      // The button was disabled while it ran and a disabled button drops the focus on the page: it goes back to the button,
      // or to the title when it is somewhere else.
      requestAnimationFrame(() => {
        if (!mounted.current) return;
        const active = document.activeElement;
        if (active === null || active === document.body) action.current?.focus();
        else title.current?.focus();
      });
    });
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.send.title')} titleId={titleId} titleRef={title} />
      {rows.length === 0 ? (
        <p className={styles.empty}>{t('ord.send.empty')}</p>
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
    </section>
  );
}
