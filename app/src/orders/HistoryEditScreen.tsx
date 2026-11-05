import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import { Trash2 } from 'lucide-react';
import { isLegacyRecord, recordDate } from '@mise/shared/archive';
import { dayLabel, dayPhrase, spellDay } from '@mise/shared/day';
import { HISTORY_LIVE_MONTHS, mergeHistory } from '@mise/shared/history-window';
import { indexById } from '@mise/shared/order-text';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { NumberBox } from './NumberBox';
import { useOrders, useOrdersStore } from './OrdersContext';
import { dayTranslate } from './dayWords';
import { correctOpener, useHandBack } from './handBack';
import { editRows } from './historyEdit';
import { cameFromList, useLeave } from './ordersNav';
import { HISTORY_PATH } from './ordersPath';
import type { StoredDoc } from './ordersSource';
import { LONG_MS } from './useClearQuantities';
import { KEEP_FOCUS } from '../shell/Page';
import styles from './HistoryEditScreen.module.css';

// «Correct order» (parity H12), at /orders/history/<recordId>, one level below History: the lines of ONE recorded order with their
// quantity and stock, a Save, and a small «Delete this order» at the foot. It is the safety valve behind «a second order the same
// day ADDS to the first»: adding can never lose the first order, but it is the wrong arithmetic when somebody meant to CORRECT a
// number.
//
// ⚠️ IT EDITS A COPY, TAKEN ONCE WHEN IT OPENS (P20) and kept as `opened`: the live data moving under it (another phone adding to
// the order) never rewrites the numbers under the finger. The store's guarded write compares the stored record with `opened`
// and writes nothing when they differ (`changed`), so a correction can never wipe a colleague's order.
//
// Opened by its address before the records have arrived it waits; once they have, a record that is not there sends it to History.
export function HistoryEditScreen({ id }: { id: string }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { history, olderHistory, historyLoaded } = useOrders();
  const [opened, setOpened] = useState<StoredDoc | null>(null);
  const found = useMemo(() => mergeHistory(history, olderHistory).find(record => record.id === id), [history, olderHistory, id]);
  if (opened === null && found !== undefined) setOpened(structuredClone(found));

  const handBack = useHandBack();
  const leave = useLeave(HISTORY_PATH, () => { handBack.expect(correctOpener(id)); });
  const missing = historyLoaded && opened === null;
  useEffect(() => {
    if (missing) void navigate(HISTORY_PATH, { replace: true, state: KEEP_FOCUS });
  }, [missing, navigate]);

  if (opened === null) {
    return (
      <section className={styles.screen} aria-label={t('ord.history.editTitle')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.history.editTitle')} />
        <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
      </section>
    );
  }
  return <Editor key={id} opened={opened} leave={leave} />;
}

function Editor({ opened, leave }: { opened: StoredDoc; leave: () => void }) {
  const { t } = useT();
  const { state } = useLocation();
  const store = useOrdersStore();
  const handBack = useHandBack();
  const { ingredients } = useOrders();
  const say = useStatusMessage();
  const [alert, alertDialog] = useAlert();
  const [confirm, confirmDialog] = useConfirm();
  const titleId = useId();
  const hintId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const dt = dayTranslate(t);
  const date = recordDate(opened);

  const ingredientsById = useMemo(() => indexById(ingredients), [ingredients]);
  const rows = editRows(opened, ingredientsById, t('ord.deletedIngredient'));
  const [typed, setTyped] = useState(() => ({
    qty: Object.fromEntries(rows.map(row => [row.id, row.qty])) as Record<string, number>,
    stock: Object.fromEntries(rows.map(row => [row.id, row.stock])) as Record<string, number>,
  }));
  const dirty = rows.some(row => typed.qty[row.id] !== row.qty || typed.stock[row.id] !== row.stock);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // The supplier, or the week of a legacy record, as the screen and its questions name the order.
  const now = new Date();
  const what = isLegacyRecord(opened)
    ? t('ord.history.weekOf', { day: spellDay(date, dt) })
    : typeof opened.supplierName === 'string' && opened.supplierName !== '' ? opened.supplierName : t('ord.unknownSupplier');

  useEffect(() => {
    // Opened from History the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  // ⚠️ RULE 2 OF EVERY SCREEN: a number was changed, so a self-started reload must wait.
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  // ⚠️ EVERY WAY OUT asks while a number differs from the copy: Back, the browser's Back, the rail. And none leaves while a save or
  // a delete is in the air: its answer is said here and decides where the screen goes.
  const [working, setWorking] = useState(false);
  const workingRef = useRef(false);
  const leaving = useRef(false);
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const blocker = useBlocker(useCallback(() => (dirtyRef.current || workingRef.current) && !leaving.current, []));
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    if (workingRef.current) {
      blocker.reset();
      return;
    }
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

  // Back to History after the answer: only from THIS screen (a result that arrives after it went moves nobody). ⚠️ An order
  // that is gone takes its card's «Correct» with it, a moment AFTER History is back: nobody is owed the focus, so it does not
  // land on a button about to vanish and drop on the page — History's title takes it.
  const backToHistory = (orderGone = false) => {
    if (!mounted.current) return;
    leaving.current = true;
    leave();
    if (orderGone) handBack.forget();
  };

  // A write in the air: the screen cannot be left, Save and Delete are off, and the focus returns to the button when it stays.
  async function run(write: () => Promise<void>) {
    if (workingRef.current) return;
    workingRef.current = true;
    setWorking(true);
    try {
      await write();
    } finally {
      workingRef.current = false;
      if (mounted.current) {
        setWorking(false);
        requestAnimationFrame(() => {
          if (!mounted.current) return;
          const active = document.activeElement;
          if (active === null || active === document.body) saveButton.current?.focus();
        });
      }
    }
  }

  const nothingLeft = () => alert({
    title: t('ord.history.nothingLeftTitle'),
    message: t('ord.history.nothingLeftText'),
    okLabel: t('common.ok'),
  });

  async function save() {
    if (workingRef.current) return;
    // Nothing changed: back to History, writing nothing (the current app would add a «Corretto» line that corrects nothing).
    if (!dirty) {
      backToHistory();
      return;
    }
    // An order with nothing in it is not an order: point at the action that means «this never happened».
    if (rows.every(row => (typed.qty[row.id] ?? 0) <= 0)) {
      await nothingLeft();
      return;
    }
    const ok = await confirm({
      title: t('ord.history.saveTitle'),
      message: t('ord.history.saveText', { supplier: what, day: dayPhrase(date, now, dt) }),
      okLabel: t('ui.save'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    await run(async () => {
      const outcome = await store.correctRecord(opened, { qty: typed.qty, stock: typed.stock });
      if (outcome === 'saved') {
        say(t('ord.history.saved'), 4000);
        backToHistory();
      } else if (outcome === 'changed' || outcome === 'gone') {
        await alert({ message: t(outcome === 'changed' ? 'ord.history.changedSave' : 'ord.history.gone'), okLabel: t('common.ok') });
        backToHistory(outcome === 'gone');
      } else if (outcome === 'empty') {
        await nothingLeft();
      } else {
        say(t(outcome === 'offline' ? 'ord.history.offlineSave' : 'ord.history.failedSave'), LONG_MS);
      }
    });
  }

  async function remove() {
    if (workingRef.current) return;
    const ok = await confirm({
      title: t('ord.history.deleteThis'),
      message: t('ord.history.deleteText', { supplier: what, day: dayPhrase(date, now, dt), n: HISTORY_LIVE_MONTHS }).split('\n\n'),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      const outcome = await store.deleteRecord(opened);
      if (outcome === 'deleted') {
        say(t('ord.history.deleted'), 4000);
        backToHistory(true);
      } else if (outcome === 'changed' || outcome === 'gone') {
        await alert({ message: t(outcome === 'changed' ? 'ord.history.changedDelete' : 'ord.history.gone'), okLabel: t('common.ok') });
        backToHistory(outcome === 'gone');
      } else {
        say(t(outcome === 'offline' ? 'ord.history.offlineDelete' : 'ord.history.failedDelete'), LONG_MS);
      }
    });
  }

  const setBox = (field: 'qty' | 'stock', rowId: string, n: number) => {
    setTyped(before => ({ ...before, [field]: { ...before[field], [rowId]: n } }));
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('ord.history.editTitle')}
        titleId={titleId}
        titleRef={title}
        action={(
          <Button ref={saveButton} variant="primary" isDisabled={working} onPress={() => { void save(); }}>
            {t('ui.save')}
          </Button>
        )}
      />
      <div className={styles.body}>
        <p className={styles.what}>{`${what} · ${dayLabel(date, now, dt)}`}</p>
        {rows.length === 0 ? (
          <p className={styles.empty}>{t('ord.history.noItems')}</p>
        ) : (
          <>
            <div className={styles.columns}>
              <span />
              <span className={styles.columnName}>{t('ord.field.order')}</span>
              <span className={styles.columnName}>{t('ord.field.stock')}</span>
            </div>
            <ul className={styles.rows}>
              {rows.map(row => (
                <li key={row.id} className={styles.row}>
                  <span className={styles.main}>
                    <span className={styles.name}>{row.name}</span>
                    {row.unit === '' ? null : <span className={styles.unit}>{row.unit}</span>}
                  </span>
                  <NumberBox
                    value={typed.qty[row.id] ?? 0}
                    className={styles.box}
                    ariaLabel={t('ord.history.qtyOrderedFor', { name: row.name })}
                    describedBy={hintId}
                    onChange={n => { setBox('qty', row.id, n); }}
                  />
                  <NumberBox
                    value={typed.stock[row.id] ?? 0}
                    className={styles.box}
                    ariaLabel={t('ord.stockOnHandFor', { name: row.name })}
                    onChange={n => { setBox('stock', row.id, n); }}
                  />
                </li>
              ))}
            </ul>
            <p id={hintId} className={styles.hint}>{t('ord.confirm.zeroHint')}</p>
          </>
        )}
        {/* Delete is deliberately quiet — small, low-key, at the foot — and it is the one action in Orders that destroys data for
            good, so it is spelt out. */}
        <Button variant="bare" className={styles.delete} isDisabled={working} onPress={() => { void remove(); }}>
          <Trash2 aria-hidden="true" />
          {t('ord.history.deleteThis')}
        </Button>
      </div>
      {confirmDialog}
      {alertDialog}
    </section>
  );
}
