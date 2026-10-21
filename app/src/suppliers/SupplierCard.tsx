import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Check } from 'lucide-react';
import { useBlocker } from 'react-router';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { BlockerFunction } from 'react-router';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { NEW_OPENER, useHandBack } from './handBack';
import { DAY_KEY, WEEKDAYS } from './supplierDays';
import type { Weekday } from './supplierDays';
import { hasName, payloadOf, toggleDay, workingFrom } from './supplierModel';
import type { Working } from './supplierModel';
import { cameFromList, cameFromSupplier, useLeave } from './suppliersNav';
import { SUPPLIERS_TAB_PATH, supplierPath } from './suppliersPath';
import { useSuppliersStore } from './SuppliersContext';
import type { StoredDoc } from './suppliersSource';
import styles from './SupplierCard.module.css';

// The longest «name to show» (the current app's maxlength) and VAT number.
export const SHORT_NAME_MAX = 60;
export const VAT_MAX = 30;
// The other boxes: the limits firestore.rules put on the suppliers whitelist (pinned by supplierLimits.spec.ts). Without
// them a longer entry closes the card local-first, the server refuses it, and everything typed is lost.
export const NAME_MAX = 200;
export const CATEGORY_MAX = 200;
export const PHONE_MAX = 40;
export const EMAIL_MAX = 320;

type Props = {
  // The supplier being edited, or null for a new one.
  id: string | null;
  // The supplier as the list held it when the card opened (null for a new one). Only read once, by the first render.
  supplier: StoredDoc | null;
  titleRef: Ref<HTMLHeadingElement>;
  // Set when the card is drawn in a dialog ABOVE another screen (the ingredient card's «+ New supplier…»): it then changes no
  // address and has no router blocker; Back asks as usual and then calls onCancel, and a save hands back the new supplier
  // (its id and the label the app will show) instead of leaving.
  host?: SupplierCardHost;
};

export interface SupplierCardHost {
  onSaved(made: { id: string; name: string }): void;
  onCancel(): void;
}

// A supplier's card: a new one, or an existing one's. A port of js/supplier-record-form.js, decision for decision, except
// what docs/parity/suppliers.md («Step 3e-1 slice B as built») lists.
//
// The editing pattern is the app's own (P20): work on a COPY, nothing touches the stored supplier until Save, Save is
// confirmed, the required field is checked before saving (a blank name is shown, said and takes the focus), and leaving
// with unsaved edits asks.
//
// ⚠️ THE COPY IS MADE ONCE, WHEN THIS FORM MOUNTS — and SupplierCardScreen mounts it only once the supplier is in the list
// (the server's word, or after COPY_WAIT_MS), keyed on the id. A supplier changed on another phone afterwards NEVER
// replaces the copy.
export function SupplierCard({ id, supplier, titleRef, host }: Props) {
  const { t } = useT();
  const store = useSuppliersStore();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;
  const nameId = `${ids}-name`;
  const nameErrorId = `${ids}-name-error`;
  const shortId = `${ids}-short`;
  const shortHintId = `${ids}-short-hint`;
  const categoryId = `${ids}-category`;
  const phoneId = `${ids}-phone`;
  const emailId = `${ids}-email`;
  const vatId = `${ids}-vat`;

  // ⚠️ WHAT THE CARD WAS OPENED WITH, kept: a supplier deleted on another phone leaves the list under an open card, and the
  // card must go on being that supplier's (its `active`, its id), never turn into a new one.
  const [opened] = useState(supplier);
  const [working, setWorking] = useState<Working>(() => workingFrom(opened));

  // ⚠️ DIRTY IS «SOMETHING WAS TYPED», also kept in a ref: the router's blocker reads it at the moment of a navigation, and a
  // state value read there could be one render behind.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const edit = (change: (current: Working) => Working) => {
    dirtyRef.current = true;
    setDirty(true);
    setWorking(change);
  };
  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Set once the edits are saved, so leaving asks nothing.
  const leavingClean = useRef(false);
  // A second tap on Save while a question is open is ignored.
  const busy = useRef(false);
  const askingLeave = useRef(false);

  // ── Where Back goes ──────────────────────────────────────────────────────────────────────────────────────────
  // A new supplier steps up to the list (the Suppliers tab) and hands the focus to the button that opened it. An existing
  // supplier's card is one level below the supplier: Back is the browser's Back when the supplier is the entry behind it,
  // and replaces itself with the supplier when it was opened by its address; the supplier is then owed the focus on «Edit».
  const onLeaving = useCallback(() => {
    if (id === null) handBack.expect(NEW_OPENER);
    else handBack.wantEdit(id);
  }, [handBack, id]);
  const leaveByAddress = useLeave(id === null ? SUPPLIERS_TAB_PATH : supplierPath(id), onLeaving, id === null ? cameFromList : cameFromSupplier);
  const leave = host ? host.onCancel : leaveByAddress;

  // ── Leaving with unsaved changes ─────────────────────────────────────────────────────────────────────────────
  const discardQuestion = () => confirm({
    title: t('sup.discard.title'),
    message: t('sup.discard.message'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, a supplier picked in
  // the split's list, the rail and the tab bar all navigate. Staying on the same address is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => host === undefined && !leavingClean.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [host],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      askingLeave.current = false;
      return;
    }
    if (askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The form went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails
  // silently on a POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (busy.current || askingLeave.current) return;
    if (dirtyRef.current) {
      busy.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        busy.current = false;
      }
    }
    leavingClean.current = true;
    leave();
  }

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const [showError, setShowError] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  // In a dialog the cursor starts in the name, the one thing a new supplier needs.
  useEffect(() => { if (host) nameBox.current?.focus(); }, []);
  const nameInvalid = showError && !hasName(working);

  async function save() {
    if (busy.current || askingLeave.current || leavingClean.current) return;
    if (!hasName(working)) {
      // The one rule: a name. The box is marked, the sentence stands under it, and the cursor goes there (Save is at the
      // top, so the box can be far above the fold on a phone).
      setShowError(true);
      nameBox.current?.focus();
      if (typeof nameBox.current?.scrollIntoView === 'function') nameBox.current.scrollIntoView({ block: 'center' });
      return;
    }
    const payload = payloadOf(working, opened);
    busy.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t('sup.save.title'),
        message: t('sup.save.question', { name: supplierLabel(payload) }),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
    } finally {
      busy.current = false;
    }
    if (!ok || !mounted.current) return;
    // Saved: nothing is unsaved any more, so leaving asks nothing. Local-first: the list changes at once and the database
    // follows; a refused write is taken back and said by the store.
    leavingClean.current = true;
    const savedId = store.saveSupplier(id, payload);
    announceAction('supplier-saved');
    say(t('sup.supplierSaved'));
    if (host) host.onSaved({ id: savedId, name: supplierLabel(payload) });
    else leave();
  }

  const tick = (field: 'deliveryDays' | 'orderDays', day: Weekday, on: boolean) => {
    edit(current => ({ ...current, [field]: toggleDay(current[field], day, on) }));
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t(id === null ? 'sup.newSupplier' : 'sup.editSupplier')}
        titleId={titleId}
        titleRef={titleRef}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      <div className={styles.body}>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>{t('sup.field.name')}</label>
          <input
            ref={nameBox}
            id={nameId}
            type="text"
            autoComplete="off"
            className={styles.box}
            maxLength={NAME_MAX}
            aria-required="true"
            aria-invalid={nameInvalid ? true : undefined}
            aria-describedby={nameInvalid ? nameErrorId : undefined}
            value={working.name}
            onChange={event => { edit(current => ({ ...current, name: event.target.value })); }}
          />
          {/* ⚠️ THE LIVE REGION IS THERE, EMPTY, BEFORE IT SPEAKS: text added to a region that was already on the page is
              announced; a region inserted already filled in often is not. */}
          <p id={nameErrorId} role="status" className={nameInvalid ? styles.error : styles.quiet}>
            {nameInvalid ? t('sup.nameRequired') : ''}
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor={shortId} className={styles.label}>{t('sup.field.shortName')}</label>
          <input
            id={shortId}
            type="text"
            autoComplete="off"
            maxLength={SHORT_NAME_MAX}
            className={styles.box}
            aria-describedby={shortHintId}
            value={working.shortName}
            onChange={event => { edit(current => ({ ...current, shortName: event.target.value })); }}
          />
          <p id={shortHintId} className={styles.hint}>{t('sup.field.shortNameHint')}</p>
        </div>

        <div className={styles.field}>
          <label htmlFor={categoryId} className={styles.label}>{t('sup.field.category')}</label>
          <input
            id={categoryId}
            type="text"
            autoComplete="off"
            maxLength={CATEGORY_MAX}
            className={styles.box}
            value={working.category}
            onChange={event => { edit(current => ({ ...current, category: event.target.value })); }}
          />
        </div>

        <Days legend={t('sup.field.deliveryDays')} days={working.deliveryDays} onTick={(day, on) => { tick('deliveryDays', day, on); }} />
        <Days legend={t('sup.field.orderDays')} days={working.orderDays} onTick={(day, on) => { tick('orderDays', day, on); }} />

        <div className={styles.field}>
          <label htmlFor={phoneId} className={styles.label}>{t('sup.field.phone')}</label>
          <input
            id={phoneId}
            type="tel"
            autoComplete="off"
            maxLength={PHONE_MAX}
            className={styles.box}
            placeholder={t('sup.eg.phone')}
            value={working.phone}
            onChange={event => { edit(current => ({ ...current, phone: event.target.value })); }}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={emailId} className={styles.label}>{t('sup.field.email')}</label>
          <input
            id={emailId}
            type="email"
            autoComplete="off"
            maxLength={EMAIL_MAX}
            className={styles.box}
            value={working.email}
            onChange={event => { edit(current => ({ ...current, email: event.target.value })); }}
          />
        </div>

        <div className={styles.field}>
          <label htmlFor={vatId} className={styles.label}>{t('sup.field.vat')}</label>
          <input
            id={vatId}
            type="text"
            autoComplete="off"
            maxLength={VAT_MAX}
            className={styles.box}
            placeholder={t('sup.eg.vat')}
            value={working.vatNumber}
            onChange={event => { edit(current => ({ ...current, vatNumber: event.target.value })); }}
          />
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}

// Seven ticks, Monday first. The LABEL is the screen's word and the VALUE stays the English key (supplierModel.ts).
function Days({ legend, days, onTick }: { legend: string; days: readonly Weekday[]; onTick: (day: Weekday, on: boolean) => void }) {
  const { t } = useT();
  return (
    <fieldset className={styles.days}>
      <legend className={styles.label}>{legend}</legend>
      <div className={styles.ticks}>
        {WEEKDAYS.map(day => (
          <label key={day} className={styles.tick}>
            <input
              type="checkbox"
              value={day}
              checked={days.includes(day)}
              onChange={event => { onTick(day, event.target.checked); }}
            />
            <span>{t(DAY_KEY[day])}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
