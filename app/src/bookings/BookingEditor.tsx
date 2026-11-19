import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
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
  BOOKING_MODES, LIMITS, draftFrom, emptyDraft, fieldId, firstProblem, nextNumber, parseMoney, pickedLine, sameDraft,
  chosenSlot, draftLineAmount, effectiveTotal, keepsStoredTime, linePrice, listTotal, toBookingData, toPay,
} from './bookingModel';
import type { Booking, BookingMode, BookingStatus, Draft, DraftField, DraftLine, DraftProblem, FormRules } from './bookingModel';
import { onlyMode, placesLeft, slotFromValue, slotValue, slotsOf } from './bookingSettings';
import type { BookingSettings, Slot } from './bookingSettings';
import type { PriceList } from '@mise/shared/price-list';
import { spellDate } from './bookingWords';
import { useBookingSettings, useBookings, useBookingsStore } from './BookingsContext';
import { afterSave, cameFromBooking, cameFromList, newBookingDateOf, restoresRefused } from './bookingsNav';
import { BOOKINGS_PATH, bookingPath } from './bookingsPath';
import type { RefusedSave } from './bookingsStore';
import { ProductCard } from './ProductCard';
import { ProductPicker } from './ProductPicker';
import type { Picked } from './ProductPicker';
import styles from './BookingEditor.module.css';

const PROBLEM_TEXT: Readonly<Record<DraftProblem['reason'], MessageKey>> = {
  required: 'bookings.err.required',
  phone: 'bookings.err.phone',
  noLines: 'bookings.err.noLines',
  qty: 'bookings.err.qty',
  money: 'bookings.err.money',
  pastDate: 'bookings.err.pastDate',
  tooHigh: 'bookings.err.tooHigh',
  slotFull: 'bookings.err.slotFull',
};

// The editor of a booking, new (id null) or existing (18 Nov 2026).
//
// ⚠️ IT COPIES THE BOOKING ONCE AND NEVER REPAINTS, so an existing booking's editor waits for the bookings to arrive (opened by
// its address on a device with nothing stored, a copy taken at once would be empty, and a Save would write that over the real
// one). A booking another device deleted meanwhile is said, not edited.
export function BookingEditor({ id }: { id: string | null }) {
  const { t } = useT();
  const { status, items } = useBookings();
  // The venue's settings (bookings settings, 18 Nov 2026): the form is drawn only once they have answered, so a form copied before
  // them never asks for a phone the venue does not want, nor offers a time the venue takes in slots.
  const { status: settingsStatus, settings } = useBookingSettings();
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

  if (start === null && status !== 'loading' && settingsStatus === 'ready') {
    const booking = id === null ? null : items.find(item => item.id === id) ?? null;
    if (id === null || booking !== null || refused !== null) setStart({ booking });
  }

  if (start === null) {
    const gone = status !== 'loading' && settingsStatus === 'ready';
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
  return <EditorForm id={id} booking={start.booking} refused={refused} settings={settings} />;
}

type FormProps = { id: string | null; booking: Booking | null; refused: RefusedSave | null; settings: BookingSettings };

function EditorForm({ id, booking, refused, settings }: FormProps) {
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

  // What the venue's settings ask of this form (bookings settings, 18 Nov 2026).
  const only = onlyMode(settings);
  const slots = slotsOf(settings);
  const { items: bookings } = useBookings();
  // The working copy (P20): nothing touches the stored booking until Save is pressed and confirmed. A new booking starts on the day
  // the list was showing, and in the venue's only mode when it takes one only (then there is nothing to choose).
  const [initial] = useState<Draft>(() => (booking !== null
    ? draftFrom(booking, nextKey, decimal)
    : emptyDraft(nextKey, { date: newBookingDateOf(arrivedWith), mode: only })));
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
  // A card changes only its quantity and its note (the product, its unit and weight come from the window).
  const updateLine = (key: number, patch: Partial<DraftLine>) => {
    setDraft(current => ({ ...current, lines: current.lines.map(line => (line.key === key ? { ...line, ...patch } : line)) }));
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

  // «+ Aggiungi un prodotto» opens the product window (bookings rebuild step 2): one product per opening, one card per «Aggiungi».
  const addId = `${ids}-add`;
  const [picking, setPicking] = useState(false);
  const addPicked = (picked: Picked) => {
    setPicking(false);
    if (draft.lines.length >= LIMITS.lines) return;
    const lines = [...draft.lines, pickedLine(nextKey(), picked)];
    update({ lines });
    say(t('bookings.picker.added', { name: picked.name }));
    // ⚠️ THE LAST PLACE TAKEN: «Aggiungi», where the window gives the focus back, is gone with it (review); the new card takes it,
    // after the window's own hand-back (a frame later).
    if (lines.length >= LIMITS.lines) {
      const target = domId({ line: lines.length - 1, part: 'name' });
      requestAnimationFrame(() => { requestAnimationFrame(() => { document.getElementById(target)?.focus(); }); });
    }
  };
  // A card taken away: the focus goes to the card now in its place (the one after, else the one before), or to «Aggiungi».
  const removeLine = (index: number) => {
    const lines = draft.lines.filter((_, i) => i !== index);
    pendingFocus.current = lines.length === 0 ? addId : domId({ line: Math.max(0, Math.min(index, lines.length - 1)), part: 'name' });
    update({ lines });
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

  const rules: FormRules = {
    askPhone: settings.askPhone,
    slots,
    slotLimit: settings.slotLimit,
    bookings,
    editing: booking === null ? null : { id: booking.id, date: booking.date, time: booking.time, slotEnd: booking.slotEnd ?? '' },
  };

  // ── Saving ──
  const asking = useRef(false);
  async function save() {
    if (asking.current) return;
    const found = firstProblem(draft, { today, isNew, items, rules });
    if (found !== null) {
      setProblem(found);
      // Block, jump to the first problem and say it; the box is marked until it is put right. No product at all: «Aggiungi».
      document.getElementById(found.reason === 'noLines' ? addId : domId(found.field))?.focus();
      say(t('bookings.err.check', { field: fieldName(t, found.field, slots !== null) }));
      return;
    }
    setProblem(null);
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('bookings.save.title'),
        // A time slot reads «tra le 10:00 e le 11:00», as in the WhatsApp reminder, never «alle 10:00–11:00».
        message: draft.slotEnd === ''
          ? t('bookings.save.body', { name: draft.customerName.trim(), date: spellDate(draft.date, locale), time: draft.time })
          : t('bookings.save.bodySlot', {
            name: draft.customerName.trim(), date: spellDate(draft.date, locale), time: draft.time, end: draft.slotEnd,
          }),
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
  const live = problem === null ? null : firstProblem(draft, { today, isNew, items, rules });
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
        {/* The owner's order (bookings rebuild step 2): the customer's name, the most visible words of the form; the day and the
            slot side by side; how it is handed over; the products; the money; the notes. The two group headings are for screen
            readers only: the big labels say it on screen. */}
        <fieldset className={styles.group}>
          <legend className="visually-hidden">{t('bookings.form.customer')}</legend>
          <TextField
            id={domId('customerName')}
            label={t('bookings.form.name')}
            big
            value={draft.customerName}
            placeholder={t('bookings.form.namePlaceholder')}
            maxLength={LIMITS.customerName}
            autoComplete="off"
            error={errorOn('customerName')}
            onChange={value => { update({ customerName: value }); }}
          />
          {/* Only where the venue asks for the phone (bookings settings): otherwise the form neither asks nor shows it. */}
          {settings.askPhone ? (
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
          ) : null}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className="visually-hidden">{t('bookings.form.when')}</legend>
          <div className={styles.when}>
            <TextField
              id={domId('date')}
              label={t('bookings.form.date')}
              big
              value={draft.date}
              type="date"
              min={isNew ? today : undefined}
              error={errorOn('date')}
              onChange={value => { update({ date: value }); }}
            />
            {slots === null ? (
              <TextField
                id={domId('time')}
                label={t('bookings.form.time')}
                big
                value={draft.time}
                type="time"
                error={errorOn('time')}
                // An exact time is not a slot: an old slot's end goes with it.
                onChange={value => { update({ time: value, slotEnd: '' }); }}
              />
            ) : (
              <SlotField
                id={domId('time')}
                draft={draft}
                slots={slots}
                rules={rules}
                error={errorOn('time')}
                onChange={(time, slotEnd) => { update({ time, slotEnd }); }}
              />
            )}
          </div>
          {/* A venue that takes one mode only has nothing to choose: a quiet grey line says which. An old booking in the other mode
              keeps the choice, so it is seen and can be put right. */}
          {/* ⚠️ DECIDED ON THE COPY AS IT OPENED, never on the typing: a tap on the venue's mode must not take the choice away. */}
          {only !== null && initial.mode === only ? (
            <p className={styles.onlyMode}>{t(only === 'delivery' ? 'bookings.form.onlyDelivery' : 'bookings.form.onlyPickup')}</p>
          ) : (
            <ModeChoice
              id={domId('mode')}
              value={draft.mode}
              error={errorOn('mode')}
              onChange={mode => { update({ mode }); }}
            />
          )}
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
          <legend className={styles.legend}>{t('bookings.form.items')}</legend>
          {draft.lines.length === 0 ? <p className={styles.hint}>{t('bookings.form.noProducts')}</p> : (
            <ol className={styles.cards}>
              {draft.lines.map((line, index) => (
                <li key={line.key} className={styles.cardItem}>
                  <ProductCard
                    index={index}
                    line={line}
                    price={linePrice(line, items)}
                    amount={draftLineAmount(line, items)}
                    cardId={domId({ line: index, part: 'name' })}
                    qtyId={domId({ line: index, part: 'qty' })}
                    nameError={errorOn({ line: index, part: 'name' })}
                    qtyError={errorOn({ line: index, part: 'qty' })}
                    onChange={patch => { updateLine(line.key, patch); }}
                    onRemove={() => { removeLine(index); }}
                  />
                </li>
              ))}
            </ol>
          )}
          {errorOn({ line: 0, part: 'name' }) !== null && draft.lines.length === 0
            ? <p id={`${addId}-error`} className={styles.error}>{errorOn({ line: 0, part: 'name' })}</p>
            : null}
          {draft.lines.length < LIMITS.lines ? (
            <Button
              id={addId}
              variant="secondary"
              className={styles.addLine}
              aria-describedby={draft.lines.length === 0 && errorOn({ line: 0, part: 'name' }) !== null ? `${addId}-error` : undefined}
              onPress={() => { setPicking(true); }}
            >
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
      {picking ? (
        <ProductPicker
          items={items}
          extras={settings.extras}
          unavailable={unavailable}
          loaded={loaded}
          onClose={() => { setPicking(false); }}
          onAdd={addPicked}
        />
      ) : null}
      {confirmDialog}
    </section>
  );
}

// The words of a field, for «Check “…”.».
function fieldName(t: ReturnType<typeof useT>['t'], field: DraftField, inSlots: boolean): string {
  if (typeof field !== 'string') {
    return `${t('bookings.form.item', { n: field.line + 1 })} — ${field.part === 'name' ? t('bookings.form.itemName') : t('bookings.form.qty')}`;
  }
  const words: Record<Exclude<DraftField, object>, MessageKey> = {
    customerName: 'bookings.form.name',
    phone: 'bookings.form.phone',
    mode: 'bookings.form.mode',
    address: 'bookings.form.address',
    date: 'bookings.form.date',
    time: inSlots ? 'bookings.form.slot' : 'bookings.form.time',
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
  // The form's main fields (the name, the day, the slot): their label in the big type of the owner's design.
  big?: boolean;
};

function TextField({ id, label, value, onChange, error, placeholder, maxLength, type = 'text', inputMode, autoComplete, min, list, hint = null, big = false }: TextFieldProps) {
  const described = [error !== null ? `${id}-error` : null, hint !== null ? `${id}-hint` : null].filter(Boolean).join(' ');
  return (
    <div className={styles.field}>
      <label className={big ? `${styles.label} ${styles.bigLabel}` : styles.label} htmlFor={id}>{label}</label>
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

// «Fascia oraria» (bookings settings, 18 Nov 2026): the venue's slots, «Scegli la fascia» first. Each says how many places it has
// left when the venue set a limit («09:00–10:00 · 3 left»); a full one says so and cannot be chosen. The booking being edited keeps
// its own time as an extra choice when it is on no slot (an exact time from before slots), so nothing is lost.
// ⚠️ THE PLACES ARE COUNTED ON THIS DEVICE (the owner accepted it): two tablets taking the last place at the same moment, or one
// offline, can put one booking more in a slot than its limit. bookingSettings.ts placesLeft says how the count is made.
function SlotField({ id, draft, slots, rules, error, onChange }: {
  id: string;
  draft: Draft;
  slots: readonly Slot[];
  rules: FormRules;
  error: string | null;
  onChange: (time: string, slotEnd: string) => void;
}) {
  const { t } = useT();
  const chosen = chosenSlot(draft, slots);
  const keptValue = rules.editing === null ? null : `kept:${rules.editing.time}-${rules.editing.slotEnd}`;
  // The stored time, when it is on none of the venue's slots — offered on its own day only: moved to another day, a booking takes
  // a slot like any other.
  const keptOff = rules.editing !== null && chosenSlot(rules.editing, slots) === null && rules.editing.date === draft.date;
  const value = chosen !== null ? slotValue(chosen) : keptOff && keepsStoredTime(draft, rules.editing) && keptValue !== null ? keptValue : '';
  const editingId = rules.editing?.id ?? null;
  return (
    <div className={styles.field}>
      <label className={`${styles.label} ${styles.bigLabel}`} htmlFor={id}>{t('bookings.form.slot')}</label>
      <select
        id={id}
        className={styles.input}
        value={value}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={error !== null ? `${id}-error` : undefined}
        onChange={event => {
          const picked = event.currentTarget.value;
          if (picked.startsWith('kept:') && rules.editing !== null) { onChange(rules.editing.time, rules.editing.slotEnd); return; }
          const slot = slotFromValue(picked);
          onChange(slot?.start ?? '', slot?.end ?? '');
        }}
      >
        <option value="">{t('bookings.form.slotChoose')}</option>
        {keptOff && rules.editing !== null && keptValue !== null ? (
          <option value={keptValue}>
            {t('bookings.form.slotKept', { time: rules.editing.slotEnd === '' ? rules.editing.time : `${rules.editing.time}–${rules.editing.slotEnd}` })}
          </option>
        ) : null}
        {slots.map(slot => {
          const isChosen = chosen !== null && slotValue(chosen) === slotValue(slot);
          const left = placesLeft(rules.bookings, { date: draft.date, slot, limit: rules.slotLimit, editingId, chosen: isChosen });
          // The booking already in this slot (stored on this day) keeps it, whatever the count says.
          const alreadyThere = rules.editing !== null && rules.editing.date === draft.date
            && rules.editing.time >= slot.start && rules.editing.time < slot.end;
          const label = `${slot.start}–${slot.end}`;
          const full = left !== null && left <= 0;
          return (
            <option key={slotValue(slot)} value={slotValue(slot)} disabled={full && !isChosen && !alreadyThere}>
              {left === null ? label : full ? t('bookings.form.slotFull', { slot: label }) : t('bookings.form.slotLeft', { slot: label, n: left })}
            </option>
          );
        })}
      </select>
      {error !== null ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}
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
