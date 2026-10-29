import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import { recordedName, wholeNumber } from '@mise/shared/archive';
import { compareLabels, indexById } from '@mise/shared/order-text';
import { qtyWithUnit } from '@mise/shared/order-unit';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useOrders, useOrdersStore } from './OrdersContext';
import { arrivalOpener, useHandBack } from './handBack';
import { carriedMissingIds } from './IncomingScreen';
import { cameFromList, useLeave } from './ordersNav';
import { INCOMING_PATH } from './ordersPath';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
import styles from './IncomingMissingScreen.module.css';

// «What arrived?» (parity V4, V5), at /orders/incoming/<recordId>, one level below Incoming: one row per ingredient of the order,
// every one ticked (arrived) until told otherwise, except the lines the order already carries as missing.
//
// ⚠️ IT WORKS ON A COPY OF THE RECORD, TAKEN ONCE WHEN IT OPENS (P20): the live data moving under it (another phone answering this
// order, a same-day order added to it) never rewrites the ticks under the finger.
//
// Opened by its address before the records have arrived it waits; once they have, a record that is not there says so and goes back
// to Incoming.
export function IncomingMissingScreen({ id }: { id: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const { history, historyLoaded } = useOrders();
  const [opened, setOpened] = useState<StoredDoc | null>(null);
  const found = useMemo(() => history.find(record => record.id === id), [history, id]);
  if (opened === null && found !== undefined) setOpened(structuredClone(found));

  const handBack = useHandBack();
  const leave = useLeave(INCOMING_PATH, useCallback(() => { handBack.expect(arrivalOpener(id)); }, [handBack, id]));
  const gone = historyLoaded && opened === null;
  useEffect(() => {
    if (!gone) return;
    say(t('ord.incoming.orderGone'), LONG_MS);
    void navigate(INCOMING_PATH, { replace: true, state: KEEP_FOCUS });
  }, [gone, navigate, say, t]);

  if (opened === null) {
    return (
      <section className={styles.screen} aria-label={t('ord.incoming.whatArrived')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.incoming.whatArrived')} />
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      </section>
    );
  }
  return <Picker key={id} opened={opened} leave={leave} />;
}

function Picker({ opened, leave }: { opened: StoredDoc; leave: () => void }) {
  const { t } = useT();
  const { state } = useLocation();
  const store = useOrdersStore();
  const say = useStatusMessage();
  const { ingredients } = useOrders();
  const [confirm, confirmDialog] = useConfirm();
  const titleId = useId();
  const hintId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const ingredientsById = useMemo(() => indexById(ingredients), [ingredients]);
  const rows = useMemo(() => {
    const quantities = (opened.quantities ?? {}) as Record<string, unknown>;
    const units = (opened.units ?? {}) as Record<string, unknown>;
    const deletedWord = t('ord.deletedIngredient');
    return Object.keys(quantities)
      .map(rowId => ({
        id: rowId,
        name: recordedName(rowId, ingredientsById, opened.names, deletedWord),
        qty: qtyWithUnit(wholeNumber(quantities[rowId]), units[rowId]),
      }))
      .sort((a, b) => compareLabels(a.name, b.name));
  }, [opened, ingredientsById, t]);

  // The lines already marked as missing start unticked (and so in the set); every other line is considered arrived. The two must
  // agree, or a line shown as arrived would still be saved as missing.
  const initial = useMemo(() => new Set(carriedMissingIds(opened).filter(rowId => rows.some(row => row.id === rowId))), [opened, rows]);
  const [missing, setMissing] = useState<ReadonlySet<string>>(initial);
  const dirty = missing.size !== initial.size || [...missing].some(rowId => !initial.has(rowId));
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    // Opened from Incoming the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  // ⚠️ RULE 2 OF EVERY SCREEN: a tick was changed, so a self-started reload must wait.
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  // ⚠️ EVERY WAY OUT asks while a tick differs from the copy: Back, the browser's Back, the rail (the History editor's pattern).
  const leaving = useRef(false);
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const blocker = useBlocker(useCallback(() => dirtyRef.current && !leaving.current, []));
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      const discard = await confirm({
        title: t('ord.discard.title'),
        message: t('ord.discard.text'),
        okLabel: t('ui.discard'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      asking.current = false;
      if (!mounted.current) return;
      const current = latestBlocker.current;
      if (current.state !== 'blocked') return;
      if (discard) {
        leaving.current = true;
        current.proceed();
      } else {
        current.reset();
      }
    })();
  });

  // ⚠️ NO SECOND QUESTION: this screen IS the answer to «did it all arrive?», and a confirm on every delivery is the friction that
  // killed the feature before (decision of the plan; an exception to P20's «confirm before save», stated). The write is not awaited
  // (local-first); a refusal is said.
  const saved = useRef(false);
  function save(): void {
    if (saved.current) return;
    saved.current = true;
    leaving.current = true;
    const said = () => { say(t('ord.incoming.couldNotSave'), LONG_MS); };
    store.confirmDelivery(opened, [...missing]).then(outcome => { if (outcome !== 'saved') said(); }, said);
    leave();
  }

  const toggle = (rowId: string, arrived: boolean) => {
    setMissing(before => {
      const next = new Set(before);
      if (arrived) next.delete(rowId); else next.add(rowId);
      return next;
    });
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('ord.incoming.whatArrived')}
        titleId={titleId}
        titleRef={title}
        action={<Button variant="primary" onPress={save}>{t('ui.save')}</Button>}
      />
      <div className={styles.body}>
        <p id={hintId} className={styles.hint}>{t('ord.incoming.untickHint')}</p>
        <ul className={styles.rows}>
          {rows.map(row => (
            // ⚠️ THE WHOLE ROW IS THE TARGET, and it is 48px tall — not the 31px a bare checkbox gives. A mis-tap here says something
            // arrived that never did, and that ingredient then never reaches «To re-order».
            <li key={row.id}>
              <label className={styles.row}>
                <input
                  type="checkbox"
                  className={styles.check}
                  checked={!missing.has(row.id)}
                  aria-describedby={hintId}
                  onChange={event => { toggle(row.id, event.target.checked); }}
                />
                <span className={styles.name}>{row.name}</span>
                <span className={styles.qty}>{row.qty}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      {confirmDialog}
    </section>
  );
}
