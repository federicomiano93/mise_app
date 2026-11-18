import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { formatMoney } from '@mise/shared/price-model';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/en';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { useTodayKey } from '../shell/useTodayKey';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import {
  BOOKING_MODES, LIMITS, blankLine, draftFrom, emptyDraft, fieldId, firstProblem, nextNumber, parseMoney, sameDraft,
  draftLineAmount, effectiveTotal, linePack, linePrice, listTotal, toBookingData, toPay,
} from './bookingModel';
import type { Booking, BookingMode, BookingStatus, BookingUnit, Draft, DraftField, DraftLine, DraftProblem } from './bookingModel';
import type { PriceItem, PriceList } from '@mise/shared/price-list';
import { spellDate } from './bookingWords';
import { useBookings, useBookingsStore } from './BookingsContext';
import { afterSave, cameFromBooking, cameFromList, restoresRefused } from './bookingsNav';
import { BOOKINGS_PATH, bookingPath } from './bookingsPath';
import type { RefusedSave } from './bookingsStore';
import styles from './BookingEditor.module.css';

const PROBLEM_TEXT: Readonly<Record<DraftProblem['reason'], MessageKey>> = {
  required: 'bookings.err.required',
  phone: 'bookings.err.phone',
  noLines: 'bookings.err.noLines',
  qty: 'bookings.err.qty',
  money: 'bookings.err.money',
  pastDate: 'bookings.err.pastDate',
  tooHigh: 'bookings.err.tooHigh',
};

// The editor of a booking, new (id null) or existing (18 Nov 2026).
//
// ⚠️ IT COPIES THE BOOKING ONCE AND NEVER REPAINTS, so an existing booking's editor waits for the bookings to arrive (opened by
// its address on a device with nothing stored, a copy taken at once would be empty, and a Save would write that over the real
// one). A booking another device deleted meanwhile is said, not edited.
export function BookingEditor({ id }: { id: string | null }) {
  const { t } = useT();
  const { status, items } = useBookings();
  const store = useBookingsStore();
  const { state } = useLocation();
  const navigate = useNavigate();
  // The refused save to put back, taken out of the store once (a reload or a second opening starts from the stored booking).
  // ⚠️ READ while drawing, TAKEN in an effect: an initializer runs twice in React's development mode, and one that emptied the store
  // would hand the second run nothing.
  const [refused] = useState<RefusedSave | null>(() => {
    if (!restoresRefused(state)) return null;
    const kept = store.getSnapshot().refused;
    return kept !== null && kept.id === id ? kept : null;
  });
  useEffect(() => {
    if (refused !== null && store.getSnapshot().refused === refused) store.takeRefused();
  }, [refused, store]);
  // A new booking waits for the bookings too (from this device's copy, offline): its short number is one more than the highest held.
  const [start, setStart] = useState<{ booking: Booking | null } | null>(null);

  if (start === null && status !== 'loading') {
    const booking = id === null ? null : items.find(item => item.id === id) ?? null;
    if (id === null || booking !== null || refused !== null) setStart({ booking });
  }

  if (start === null) {
    const gone = status !== 'loading';
    return (
      <section className={styles.editor} aria-busy={!gone}>
        <FormBar
          backLabel={t('ui.back')}
          onBack={() => { void navigate(BOOKINGS_PATH, { replace: true }); }}
          title={id === null ? t('bookings.form.newTitle') : t('bookings.edit')}
        />
        <p className={styles.loading}>{gone ? t('bookings.notFound') : id === null ? t('bookings.loading') : t('bookings.form.waiting')}</p>
      </section>
    );
  }
  return <EditorForm id={id} booking={start.booking} refused={refused} />;
}

type FormProps = { id: string | null; booking: Booking | null; refused: RefusedSave | null };

function EditorForm({ id, booking, refused }: FormProps) {
  const { t, locale } = useT();
  const store = useBookingsStore();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const money = useMoney();
  const today = useTodayKey();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const isNew = id === null;
  // Arriving from the list or the booking, the page leaves the focus alone (their marks carry keepFocus): it goes to this form's
  // title, so its name is what a screen reader hears. Opened by its address, the page does it.
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { state: arrivedWith } = useLocation();
  useEffect(() => {
    if (cameFromBooking(arrivedWith) || cameFromList(arrivedWith)) titleRef.current?.focus();
  }, []);
  const number = booking?.number ?? refused?.number ?? null;
  const decimal = money.layout.decimal;

  // ⚠️ PAST EVERY KEY OF A RESTORED WORKING COPY: its rows carry the refused editor's keys, and a new row given one of them again
  // would be typed into together with the old one.
  const keyCounter = useRef(refused === null ? 0 : Math.max(0, ...refused.draft.lines.map(line => line.key)));
  const nextKey = useCallback(() => {
    keyCounter.current += 1;
    return keyCounter.current;
  }, []);

  // The working copy (P20): nothing touches the stored booking until Save is pressed and confirmed.
  const [initial] = useState<Draft>(() => (booking !== null ? draftFrom(booking, nextKey, decimal) : emptyDraft(nextKey)));
  const [draft, setDraft] = useState<Draft>(() => refused?.draft ?? initial);
  const [problem, setProblem] = useState<DraftProblem | null>(null);
  const dirty = refused !== null || !sameDraft(initial, draft);
  // Read by the router's blocker at the moment of a navigation, when a state value could be a render behind.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaving = useRef(false);

  // Unsaved edits: a reload the app starts by itself waits until they are saved or dropped (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The published price list (bookings step 2), for the product suggestions and the prices: read only while the editor is open
  // (P14). Nothing published, or a refusal, leaves free text only, and says so.
  const { list: priceList, unavailable, loaded } = usePriceList();
  const items = priceList.items;

  const update = (patch: Partial<Draft>) => {
    setDraft(current => ({ ...current, ...patch }));
  };
  // ⚠️ A NAME THAT IS ON THE PRICE LIST SETS THE LINE'S UNIT to the list's (a kilo price is counted in kilos), so the quantity
  // typed next is read the way it will be priced.
  const updateLine = (key: number, patch: Partial<DraftLine>) => {
    setDraft(current => ({
      ...current,
      lines: current.lines.map(line => {
        if (line.key !== key) return line;
        const next = { ...line, ...patch };
        if (patch.name !== undefined) {
          const price = linePrice(next, items);
          if (price.kind === 'listed') return { ...next, unit: price.unit };
        }
        return next;
      }),
    }));
  };

  // Focus requests after the rows are redrawn (a new line, a removed one).
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    document.getElementById(target)?.focus();
  }, [draft.lines]);

  const domId = (field: DraftField) => `${ids}-${fieldId(field)}`;

  const addLine = () => {
    if (draft.lines.length >= LIMITS.lines) return;
    pendingFocus.current = domId({ line: draft.lines.length, part: 'name' });
    update({ lines: [...draft.lines, blankLine(nextKey())] });
  };
  const removeLine = (index: number) => {
    const lines = draft.lines.filter((_, i) => i !== index);
    pendingFocus.current = domId({ line: Math.max(0, Math.min(index, lines.length - 1)), part: 'name' });
    update({ lines: lines.length > 0 ? lines : [blankLine(nextKey())] });
  };

  // ── Leaving ──
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leaving.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const askingLeave = useRef(false);
  const discardQuestion = useMemo(() => ({
    title: t('bookings.discard.title'),
    message: t('bookings.discard.body'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [t]);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked' || askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await confirm(discardQuestion);
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } finally {
        askingLeave.current = false;
      }
    })();
  }, [blocker, confirm, discardQuestion]);

  // Back goes up one level: to the booking for an existing one, to the list for a new one. The router's blocker asks first
  // when something was typed.
  // Opened from the booking (Edit) or from the list (New booking), Back is the browser's Back, so the history never holds the same
  // screen twice; opened by its address it replaces itself with the level above.
  const back = () => {
    if (cameFromBooking(arrivedWith) || cameFromList(arrivedWith)) void navigate(-1);
    else void navigate(isNew ? BOOKINGS_PATH : bookingPath(id), { replace: true });
  };

  // ── Saving ──
  const asking = useRef(false);
  async function save() {
    if (asking.current) return;
    const found = firstProblem(draft, { today, isNew, items });
    if (found !== null) {
      setProblem(found);
      // Block, jump to the first problem and say it; the box is marked until it is put right.
      document.getElementById(domId(found.field))?.focus();
      say(t('bookings.err.check', { field: fieldName(t, found.field) }));
      return;
    }
    setProblem(null);
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('bookings.save.title'),
        message: t('bookings.save.body', { name: draft.customerName.trim(), date: spellDate(draft.date, locale), time: draft.time }),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      const { items: stocked } = store.getSnapshot();
      // ⚠️ THE STATUS AS IT IS NOW, never as it was when the editor opened: the editor does not show it, and a status set on another
      // device meanwhile (Cancelled, Collected) must not be quietly put back by a Save that only fixed a phone number.
      const stored = id === null ? undefined : stocked.find(item => item.id === id);
      const statusNow: BookingStatus = stored?.status ?? refused?.status ?? booking?.status ?? 'todo';
      // ⚠️ A RESTORED SAVE OF A BOOKING DELETED ON ANOTHER DEVICE IS MADE AGAIN AS A NEW ONE: written to its old id it would be a
      // create without `createdAt`, refused by the rules every time.
      const saveId = id !== null && stored === undefined && refused !== null ? null : id;
      const data = toBookingData(draft, { status: statusNow, number: number ?? nextNumber(stocked), items });
      const savedId = store.save(saveId, data, draft);
      leaving.current = true;
      say(t('bookings.saved'));
      // Back to the list, on the booking's day, the focus on its row. Never awaited: the write is in Firestore's queue and reaches
      // the server when it can.
      // The editor's entry is REPLACED: the browser's Back must not open the editor again.
      void navigate(BOOKINGS_PATH, { replace: true, state: afterSave(data.date, savedId) });
    } finally {
      asking.current = false;
    }
  }

  async function remove() {
    if (id === null || booking === null) return;
    const ok = await confirm({
      title: t('bookings.delete.title'),
      message: t('bookings.delete.body', { name: booking.customerName }),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok || !mounted.current) return;
    store.remove(id);
    leaving.current = true;
    say(t('bookings.deleted'));
    void navigate(BOOKINGS_PATH, { replace: true });
  }

  // A box is marked only once Save has found it wrong, and only while it still is.
  const live = problem === null ? null : firstProblem(draft, { today, isNew, items });
  const errorOn = (field: DraftField): string | null => {
    if (live === null || fieldId(live.field) !== fieldId(field)) return null;
    return t(PROBLEM_TEXT[live.reason]);
  };

  const depositValue = parseMoney(draft.deposit);
  // The total is the one typed, else the price list's sum of the priced lines (the counter may type over it: a discount).
  const fromList = listTotal(draft, items);
  const due = toPay(effectiveTotal(draft, items), typeof depositValue === 'number' ? depositValue : null);
  const title = isNew ? t('bookings.form.newTitle') : t('bookings.form.editTitle', { number: t('bookings.number', { n: number ?? 0 }) });

  return (
    <section className={styles.editor} aria-labelledby={`${ids}-title`}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={back}
        title={title}
        titleId={`${ids}-title`}
        titleRef={titleRef}
        sub={<span className={styles.dirty} data-dirty={dirty ? 'true' : undefined} aria-live="polite">{dirty ? t('bookings.form.unsaved') : ''}</span>}
        action={<Button variant="primary" className={styles.save} onPress={() => { void save(); }}>{t('ui.save')}</Button>}
      />
      <form className={styles.body} noValidate onSubmit={event => { event.preventDefault(); void save(); }}>
        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('bookings.form.customer')}</legend>
          <TextField
            id={domId('customerName')}
            label={t('bookings.form.name')}
            value={draft.customerName}
            placeholder={t('bookings.form.namePlaceholder')}
            maxLength={LIMITS.customerName}
            autoComplete="off"
            error={errorOn('customerName')}
            onChange={value => { update({ customerName: value }); }}
          />
          <TextField
            id={domId('phone')}
            label={t('bookings.form.phone')}
            value={draft.phone}
            placeholder={t('bookings.form.phonePlaceholder')}
            maxLength={LIMITS.phone}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            error={errorOn('phone')}
            onChange={value => { update({ phone: value }); }}
          />
          <ModeChoice
            id={domId('mode')}
            value={draft.mode}
            error={errorOn('mode')}
            onChange={mode => { update({ mode }); }}
          />
          {draft.mode === 'delivery' ? (
            <TextField
              id={domId('address')}
              label={t('bookings.form.address')}
              value={draft.address}
              placeholder={t('bookings.form.addressPlaceholder')}
              maxLength={LIMITS.address}
              autoComplete="off"
              error={errorOn('address')}
              onChange={value => { update({ address: value }); }}
            />
          ) : null}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('bookings.form.when')}</legend>
          <div className={styles.pair}>
            <TextField
              id={domId('date')}
              label={t('bookings.form.date')}
              value={draft.date}
              type="date"
              min={isNew ? today : undefined}
              error={errorOn('date')}
              onChange={value => { update({ date: value }); }}
            />
            <TextField
              id={domId('time')}
              label={t('bookings.form.time')}
              value={draft.time}
              type="time"
              error={errorOn('time')}
              onChange={value => { update({ time: value }); }}
            />
          </div>
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('bookings.form.items')}</legend>
          {/* Said only once the list has answered: nothing is said while it is on its way. */}
          {unavailable ? <p className={styles.hint}>{t('bookings.form.priceListUnreadable')}</p>
            : loaded && items.length === 0 ? <p className={styles.hint}>{t('bookings.form.noPriceList')}</p> : null}
          <datalist id={`${ids}-prices`}>
            {items.map(item => <option key={item.productId} value={item.name} label={priceWords(t, item, money)} />)}
          </datalist>
          <ol className={styles.lines}>
            {draft.lines.map((line, index) => (
              <li key={line.key} className={styles.lineItem}>
                <LineFields
                  index={index}
                  line={line}
                  listId={`${ids}-prices`}
                  price={linePrice(line, items)}
                  amount={draftLineAmount(line, items)}
                  nameId={domId({ line: index, part: 'name' })}
                  qtyId={domId({ line: index, part: 'qty' })}
                  nameError={errorOn({ line: index, part: 'name' })}
                  qtyError={errorOn({ line: index, part: 'qty' })}
                  canRemove={draft.lines.length > 1}
                  onChange={patch => { updateLine(line.key, patch); }}
                  onRemove={() => { removeLine(index); }}
                />
              </li>
            ))}
          </ol>
          {draft.lines.length < LIMITS.lines ? (
            <Button variant="secondary" className={styles.addLine} onPress={addLine}>
              <Plus aria-hidden="true" />
              <span>{t('bookings.form.addItem')}</span>
            </Button>
          ) : null}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={styles.legend}>{t('bookings.form.money')}</legend>
          <div className={styles.pair}>
            <TextField
              id={domId('total')}
              label={t('bookings.form.total', { symbol: money.symbol })}
              value={draft.total}
              inputMode="decimal"
              autoComplete="off"
              error={errorOn('total')}
              hint={fromList.total !== null
                ? (draft.total.trim() === ''
                  ? t('bookings.form.totalFromList', { total: formatMoney(fromList.total, money) })
                  : t('bookings.form.totalTyped', { total: formatMoney(fromList.total, money) }))
                : null}
              onChange={value => { update({ total: value }); }}
            />
            <TextField
              id={domId('deposit')}
              label={t('bookings.form.deposit', { symbol: money.symbol })}
              value={draft.deposit}
              inputMode="decimal"
              autoComplete="off"
              error={errorOn('deposit')}
              onChange={value => { update({ deposit: value }); }}
            />
          </div>
          {fromList.total !== null && fromList.unpriced > 0
            ? <p className={styles.warnHint}>{t('bookings.form.unpricedLines', { n: fromList.unpriced })}</p>
            : null}
          <p className={styles.toPay} aria-live="polite">
            {due !== null ? <><span>{t('bookings.form.toPay')}</span> <strong>{formatMoney(due, money)}</strong></> : ''}
          </p>
        </fieldset>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${ids}-notes`}>{t('bookings.form.notes')}</label>
          <p id={`${ids}-notes-hint`} className={styles.warnHint}>{t('bookings.form.notesHint')}</p>
          <textarea
            id={`${ids}-notes`}
            className={`${styles.input} ${styles.textarea}`}
            value={draft.notes}
            maxLength={LIMITS.notes}
            rows={3}
            aria-describedby={`${ids}-notes-hint`}
            onChange={event => { update({ notes: event.currentTarget.value }); }}
          />
        </div>

        {!isNew ? (
          <div className={styles.foot}>
            <Button variant="bare" className={styles.delete} aria-label={t('bookings.delete')} onPress={() => { void remove(); }}>
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        ) : null}
      </form>
      {confirmDialog}
    </section>
  );
}

// The words of a field, for «Check “…”.».
function fieldName(t: ReturnType<typeof useT>['t'], field: DraftField): string {
  if (typeof field !== 'string') {
    return `${t('bookings.form.item', { n: field.line + 1 })} — ${field.part === 'name' ? t('bookings.form.itemName') : t('bookings.form.qty')}`;
  }
  const words: Record<Exclude<DraftField, object>, MessageKey> = {
    customerName: 'bookings.form.name',
    phone: 'bookings.form.phone',
    mode: 'bookings.form.mode',
    address: 'bookings.form.address',
    date: 'bookings.form.date',
    time: 'bookings.form.time',
    deposit: 'bookings.slip.deposit',
    total: 'bookings.slip.total',
  };
  return t(words[field]);
}

// The published price list, live while the editor is open. `unavailable`: refused or broken (free text still works).
function usePriceList(): { readonly list: PriceList; readonly unavailable: boolean; readonly loaded: boolean } {
  const services = useDataServices();
  const { locationId } = useSession();
  const [state, setState] = useState<{ list: PriceList; unavailable: boolean; loaded: boolean }>(
    { list: { items: [], publishedAtMs: null }, unavailable: false, loaded: false },
  );
  useEffect(() => {
    if (!locationId) return undefined;
    return services.bookings(locationId).watchPriceList(
      list => { setState({ list, unavailable: false, loaded: true }); },
      () => { setState({ list: { items: [], publishedAtMs: null }, unavailable: true, loaded: true }); },
    );
  }, [services, locationId]);
  return state;
}

// «12,00 € al kg», «2,50 € al pezzo», «3,50 € a confezione»: what an item costs, in the interface's words and the venue's money.
function priceWords(t: ReturnType<typeof useT>['t'], item: PriceItem, money: ReturnType<typeof useMoney>): string {
  const price = formatMoney(item.price, money);
  if (item.per === 'kg') return t('bookings.price.perKg', { price });
  if (item.per === 'piece') return t('bookings.price.perPiece', { price });
  return t('bookings.price.perPack', { price });
}

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error: string | null;
  placeholder?: string;
  maxLength?: number;
  type?: 'text' | 'tel' | 'date' | 'time';
  inputMode?: 'text' | 'tel' | 'decimal';
  autoComplete?: string;
  min?: string;
  list?: string;
  // A sentence under the box, read with it.
  hint?: string | null;
};

function TextField({ id, label, value, onChange, error, placeholder, maxLength, type = 'text', inputMode, autoComplete, min, list, hint = null }: TextFieldProps) {
  const described = [error !== null ? `${id}-error` : null, hint !== null ? `${id}-hint` : null].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>{label}</label>
      <input
        id={id}
        className={styles.input}
        type={type}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        inputMode={inputMode}
        autoComplete={autoComplete}
        min={min}
        list={list}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={described === '' ? undefined : described}
        onChange={event => { onChange(event.currentTarget.value); }}
      />
      {error !== null ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}
      {hint !== null ? <p id={`${id}-hint`} className={styles.hint}>{hint}</p> : null}
    </div>
  );
}

// Pickup or delivery: two radio buttons, none chosen on a new booking (it starts empty), required.
function ModeChoice({ id, value, error, onChange }: { id: string; value: BookingMode | null; error: string | null; onChange: (mode: BookingMode) => void }) {
  const { t } = useT();
  return (
    <div
      className={styles.field}
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      aria-invalid={error !== null ? true : undefined}
      aria-describedby={error !== null ? `${id}-error` : undefined}
    >
      <span id={`${id}-label`} className={styles.label}>{t('bookings.form.mode')}</span>
      <div className={styles.modes}>
        {BOOKING_MODES.map((mode, index) => (
          <label key={mode} className={styles.mode} data-checked={value === mode ? 'true' : undefined}>
            <input
              // The first radio carries the field's id, so Save's jump lands on the group.
              id={index === 0 ? id : undefined}
              type="radio"
              name={id}
              className={styles.radio}
              checked={value === mode}
              onChange={() => { onChange(mode); }}
            />
            <span>{t(mode === 'delivery' ? 'bookings.mode.delivery' : 'bookings.mode.pickup')}</span>
          </label>
        ))}
      </div>
      {error !== null ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}
    </div>
  );
}

type LineProps = {
  index: number;
  line: DraftLine;
  listId: string;
  price: ReturnType<typeof linePrice>;
  amount: number | null;
  nameId: string;
  qtyId: string;
  nameError: string | null;
  qtyError: string | null;
  canRemove: boolean;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
};

// One product: the name (the price list's names suggested, or free text), the quantity and its unit, an optional note; its price
// and what the line comes to, when it has one.
function LineFields({ index, line, listId, price, amount, nameId, qtyId, nameError, qtyError, canRemove, onChange, onRemove }: LineProps) {
  const { t, locale } = useT();
  const money = useMoney();
  const n = index + 1;
  const tag = price.kind === 'listed'
    ? t('bookings.form.fromList', { price: priceWords(t, price.item, money) })
    : price.kind === 'frozen'
      ? t('bookings.form.keptPrice', {
        price: t(line.unit === 'kg' ? 'bookings.price.perKg' : 'bookings.price.perPiece', { price: formatMoney(price.unitPrice, money) }),
      })
      : null;
  // ⚠️ THE UNIT IS LOCKED WHILE THE LINE HAS A PRICE (review, 18 Nov 2026): a listed product's price is for a piece (a pack) or a
  // kilo, and a saved line's price was agreed for its unit — changing it would quietly re-price the line. The tag says why.
  const locked = price.kind === 'listed' || price.kind === 'frozen';
  const pack = linePack(price);
  const packSizeText = (p: { packSize: number; packUnit: string }) =>
    `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(p.packSize)} ${p.packUnit === 'pcs' ? t('bookings.unit.pcs') : p.packUnit}`;
  const tagId = `${nameId}-price`;
  return (
    <div className={styles.line} role="group" aria-label={t('bookings.form.item', { n })}>
      <div className={styles.lineHead}>
        <span className={styles.lineTitle}>{t('bookings.form.item', { n })}</span>
        {tag !== null ? <span id={tagId} className={styles.fromBook}>{tag}</span> : null}
        {canRemove ? (
          <Button variant="bare" className={styles.removeLine} aria-label={t('bookings.form.removeItem', { n })} onPress={onRemove}>
            <X aria-hidden="true" />
          </Button>
        ) : null}
      </div>
      <TextField
        id={nameId}
        label={t('bookings.form.itemName')}
        value={line.name}
        placeholder={t('bookings.form.itemPlaceholder')}
        maxLength={LIMITS.lineName}
        autoComplete="off"
        list={listId}
        error={nameError}
        onChange={value => { onChange({ name: value }); }}
      />
      <div className={styles.qtyRow}>
        <TextField
          id={qtyId}
          label={t('bookings.form.qty')}
          value={line.qty}
          inputMode="decimal"
          autoComplete="off"
          error={qtyError}
          onChange={value => { onChange({ qty: value }); }}
        />
        <div className={styles.field}>
          <label className={styles.label} htmlFor={`${qtyId}-unit`}>{t('bookings.form.unit')}</label>
          {/* ⚠️ LOCKED for a product on the price list: its price is for a piece, a pack or a kilo, never another. A line of packs
              says «confezioni (250 g)» (the owner's choice, 18 Nov 2026); its quantity is a number of packs. */}
          <select
            id={`${qtyId}-unit`}
            className={styles.input}
            value={pack !== null ? 'pack' : price.kind === 'listed' ? price.unit : line.unit}
            disabled={locked}
            aria-describedby={locked ? tagId : undefined}
            onChange={event => { onChange({ unit: event.currentTarget.value === 'kg' ? 'kg' : 'pcs' as BookingUnit }); }}
          >
            <option value="pcs">{t('bookings.form.unitPcs')}</option>
            <option value="kg">{t('bookings.form.unitKg')}</option>
            {pack !== null ? <option value="pack">{t('bookings.form.unitPacks', { size: packSizeText(pack) })}</option> : null}
          </select>
        </div>
      </div>
      {amount !== null ? <p className={styles.amount}>{t('bookings.form.lineAmount', { amount: formatMoney(amount, money) })}</p> : null}
      <TextField
        id={`${nameId}-note`}
        label={t('bookings.form.itemNote')}
        value={line.note}
        placeholder={t('bookings.form.itemNotePlaceholder')}
        maxLength={LIMITS.lineNote}
        autoComplete="off"
        error={null}
        onChange={value => { onChange({ note: value }); }}
      />
    </div>
  );
}
