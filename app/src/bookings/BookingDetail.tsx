import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Check, MessageCircle, Pencil, Printer, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate, useNavigationType } from 'react-router';
import { formatMoney } from '@mise/shared/price-model';
import { todayISO } from '@mise/shared/day';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { lineAmount } from '@mise/shared/price-list';
import { bookingTimeLabel, toPay } from './bookingModel';
import type { Booking } from './bookingModel';
import { CustomerSlip, LabSlips } from './BookingSlips';
import type { CustomerSlipWords } from './BookingSlips';
import { slipDay, slipLocale, slipUnitWords, spellDate } from './bookingWords';
import { BookingLines } from './BookingLines';
import type { UnitWords } from './bookingWords';
import { useBookingSettings, useBookings, useBookingsStore } from './BookingsContext';
import { reminderOn } from './bookingSettings';
import { STATUS_WORD } from './BookingsList';
import { cameFromList, editFromBooking } from './bookingsNav';
import { BOOKINGS_PATH, editBookingPath } from './bookingsPath';
import { printSlip } from './slipHost';
import { PRINT_TIMEOUT_MS, readPrinterSetting, sendToPrinter } from './receiptPrinter';
import type { PrintOutcome, SlipLine } from './receiptPrinter';
import { printOutcomeText } from './printWords';
import { customerSlipLines, labSlipDocuments } from './slipText';
import { SLIPS_ASK_ABOVE, SLIPS_REFUSE_ABOVE, asksSlipChoice, labSlips, perPieceProducts, pieceCount, slipCount } from './labSlips';
import type { LabSlipMode } from './labSlips';
import { SlipChoice } from './SlipChoice';
import { usePriceList } from './usePriceList';
import { countryOf } from '@mise/shared/market';
import { reminderMessage, reminderUrl, wantsReminder, whatsappNumber } from './reminderText';
import { useTapLockout } from './tapLockout';
import styles from './BookingDetail.module.css';

// One booking (18 Nov 2026): its status (a tap saves it), when, who, what, the money, the two slips and the bin.
//
// ⚠️ THE BIN IS ALSO HOW A CUSTOMER'S «DELETE MY DATA» IS HONOURED: the booking goes for good, with the name, phone and address.
// The loading line's title (one booking page at a time): the name takes the focus over from it.
const WAITING_TITLE_ID = 'booking-waiting-title';

// `inPlace` (the tablet, 19 Nov 2026): the booking is a card opened IN the day's list, in place of its row, closed by an X (and
// by Escape) instead of left by Back. `onClose` is what that does.
type Placing = { readonly inPlace?: boolean; readonly onClose?: () => void };

// Escape closes a card opened in place. ⚠️ Only a key pressed INSIDE the card (a dialog opened from it draws in a portal, whose
// events still bubble through React's tree: its own Escape must close the dialog alone).
function closeOnEscape(onClose: (() => void) | undefined) {
  return (event: KeyboardEvent<HTMLElement>) => {
    if (onClose === undefined || event.key !== 'Escape' || event.defaultPrevented) return;
    if (!event.currentTarget.contains(event.target as Node)) return;
    event.stopPropagation();
    onClose();
  };
}

export function BookingDetail({ id, lookingUp = false, inPlace = false, onClose }: { id: string; lookingUp?: boolean } & Placing) {
  const { t } = useT();
  const { status, items } = useBookings();
  const booking = items.find(item => item.id === id) ?? null;
  const navigate = useNavigate();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  // The loading line's h1 takes the focus as the page's own would (not on Back, not on a first load); the booking's name takes it
  // over when it arrives.
  const waitingTitle = useRef<HTMLHeadingElement>(null);
  const waiting = booking === null;
  useEffect(() => {
    if (waiting && navigationType !== 'POP') waitingTitle.current?.focus({ preventScroll: true });
  }, []);
  // A booking opened from the list goes back by the browser's Back (the list is the entry behind it); opened by its address it
  // replaces itself with the list.
  const back = () => {
    if (inPlace && onClose) onClose();
    else if (cameFromList(state)) void navigate(-1);
    else void navigate(BOOKINGS_PATH, { replace: true });
  };

  if (booking === null) {
    return (
      <section className={styles.card} data-in-place={inPlace ? 'true' : undefined} aria-busy={status === 'loading' || lookingUp} onKeyDown={inPlace ? closeOnEscape(onClose) : undefined}>
        {/* The page draws no h1 for a booking (its h1 is the customer's name): until there is one, the section's name is it. */}
        <FormBar backLabel={t(inPlace ? 'bookings.detail.close' : 'ui.back')} onBack={back} title={t('section.bookings')} level={1} titleRef={waitingTitle} titleId={WAITING_TITLE_ID} backIcon={inPlace ? 'close' : 'back'} />
        <div className={styles.body}>
          {status === 'loading' || lookingUp ? <p className={styles.muted}>{t('bookings.loading')}</p> : (
            <>
              <p>{t('bookings.notFound')}</p>
              <Link to={BOOKINGS_PATH} replace className={styles.link}>{t('bookings.backToList')}</Link>
            </>
          )}
        </div>
      </section>
    );
  }
  return <Shown booking={booking} onBack={back} inPlace={inPlace} onClose={onClose} />;
}

function Shown({ booking, onBack, inPlace = false, onClose }: { booking: Booking; onBack: () => void } & Placing) {
  const { t, locale } = useT();
  const store = useBookingsStore();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const money = useMoney();
  const { location, name: venueName } = useSession();
  // The venue's settings (bookings settings, 18 Nov 2026): without the phone asked, no phone and no reminder on this page.
  const { settings, status: settingsStatus } = useBookingSettings();
  // Which products the venue marked «Chiedi per pezzo» (bookings rebuild step 4): the lab slips go one per piece for those. A
  // list not read yet, refused or broken marks none, and the lab slip prints «Tutto insieme» without asking.
  // ⚠️ «Laboratorio» WAITS FOR THE LIST'S FIRST ANSWER (pending until then): pressed before it, a booking of 3 scacciate would
  // print one slip «[2]» with no question.
  // The settings are waited for too: pressed before them, the default «Biglietti per pezzo: on» would ask a venue that has it off.
  const { list: priceList, loaded: priceListLoaded } = usePriceList();
  const labReady = priceListLoaded && settingsStatus === 'ready';
  const perPiece = useMemo(() => perPieceProducts(priceList.items, settings.perPieceSlips), [priceList, settings.perPieceSlips]);
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const taps = useTapLockout();
  const number = t('bookings.number', { n: booking.number });
  const title = useRef<HTMLHeadingElement>(null);
  const { state } = useLocation();
  const navigationType = useNavigationType();
  // ⚠️ THE PAGE DRAWS NO h1 HERE (Page `ownHeading`), so the move of the focus a page makes is this booking's to make: on its
  // title, the customer's name, as the page would on its own h1 — opened from the list, from the Home, or after its loading line.
  // Not on Back (POP) nor on the first load, as the page (the skip link stays the first Tab stop) — except when the loading line's
  // title held the focus: it hands it on to the name.
  useEffect(() => {
    const fromPlaceholder = document.activeElement?.id === WAITING_TITLE_ID;
    if (navigationType !== 'POP' || fromPlaceholder) title.current?.focus({ preventScroll: true });
  }, []);

  const words: UnitWords = {
    unit: unit => t(unit === 'kg' ? 'bookings.unit.kg' : 'bookings.unit.pcs'),
    packs: n => t('bookings.unit.packs', { n }),
  };
  const modeWord = t(booking.mode === 'delivery' ? 'bookings.mode.delivery' : 'bookings.mode.pickup');
  const due = toPay(booking.total, booking.deposit);
  const phoneShown = booking.phone !== '';
  const addressShown = booking.mode === 'delivery' && booking.address !== '';

  // ⚠️ THE WHATSAPP REMINDER (bookings step 4): a link that opens WhatsApp on this device, on the customer's chat, with the
  // message written; the person reads it and sends it. Only while the order is still to come, and only for a phone WhatsApp can
  // open (the venue's country code is added to a number typed without one). Words in the interface's language, as the slips;
  // the date and the money in the venue's country's way.
  const reminder = reminderOn(settings) && wantsReminder(booking, todayISO()) ? reminderUrl(whatsappNumber(booking.phone, countryOf(location)), reminderMessage({
    booking,
    locale: slipLocale(location, locale),
    units: slipUnitWords(location),
    money,
    words: {
      hello: t('bookings.reminder.hello', { name: booking.customerName }),
      intro: t(booking.mode === 'delivery' ? 'bookings.reminder.delivery' : 'bookings.reminder.pickup', {
        number, venue: venueName !== null && venueName !== undefined && venueName !== '' ? venueName : t('bookings.reminder.us'),
      }),
      when: (date, time, slotEnd) => (slotEnd === null
        ? t('bookings.reminder.when', { date, time })
        : t('bookings.reminder.whenSlot', { date, time, end: slotEnd })),
      address: address => t('bookings.reminder.address', { address }),
      toPay: amount => t('bookings.reminder.toPay', { amount }),
      bye: t('bookings.reminder.bye'),
    },
  })) : '';

  // ⚠️ NO STATUS BUTTONS ON THE PAGE (19 Nov 2026, the owner's design): a tag beside the name says Collected or Cancelled, collecting
  // is the list row's «Mark collected», and the page's one status move is at the foot — «Cancel booking» (asks first) and, on a
  // cancelled booking, «Reopen booking» (no question: a mistaken cancel is undone at once).
  async function cancel() {
    if (taps.locked(`${booking.id}:cancelled`)) return;
    const ok = await confirm({
      title: t('bookings.cancel.title'),
      message: t('bookings.cancel.body'),
      okLabel: t('bookings.cancel.ok'),
      cancelLabel: t('bookings.cancel.keep'),
      danger: true,
    });
    if (!ok) return;
    taps.lock(`${booking.id}:cancelled`);
    store.setStatus(booking.id, 'cancelled');
    say(t('bookings.statusSaved', { status: t(STATUS_WORD.cancelled) }));
  }

  function reopen() {
    // A double tap must not write twice.
    if (taps.locked(`${booking.id}:reopen`)) return;
    taps.lock(`${booking.id}:reopen`);
    store.setStatus(booking.id, 'todo');
    say(t('bookings.reopened'));
  }

  async function remove() {
    const ok = await confirm({
      title: t('bookings.delete.title'),
      message: t('bookings.delete.body', { name: booking.customerName }),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    store.remove(booking.id);
    say(t('bookings.deleted'));
    void navigate(BOOKINGS_PATH, { replace: true });
  }

  // ⚠️ READ WHILE PRINTING, never at module load: the slip's unit word and its numbers follow the venue's country.
  // ⚠️ STRAIGHT TO THE RECEIPT PRINTER when this device has one (bookings step 3, the owner's choice: from the tablet, no computer
  // in between): «Sending to the printer…», then «Printed ✓» — or, when it did not print, the reason and an offer to print through
  // the browser's dialog instead. With no printer set, the browser's dialog as before.
  const [sending, setSending] = useState<'lab' | 'customer' | null>(null);
  // ⚠️ A SEND OUTLIVES THE SCREEN: a person may open the next booking while the printer still has 15 s to answer. Its dialog is
  // drawn here, so once this booking is closed the outcome is SAID instead (the section's status line outlives the screen).
  const shown = useRef(true);
  useEffect(() => {
    shown.current = true;
    return () => { shown.current = false; };
  }, []);
  async function print(kind: 'lab' | 'customer') {
    if (sending !== null || (kind === 'lab' && !labReady)) return;
    const paperLocale = slipLocale(location, locale);
    const paperUnit = slipUnitWords(location);

    // ── «Laboratorio»: one slip per piece, or all together (bookings rebuild step 4) ──
    // ⚠️ ASKED ONLY WHEN IT MEANS SOMETHING: the venue's «Biglietti per pezzo» on and a per-piece product in the booking. Otherwise
    // «Tutto insieme», without a word. The owner's design: no explanation in the dialog, «Uno per pezzo» chosen at the start.
    let mode: LabSlipMode = 'together';
    if (kind === 'lab' && asksSlipChoice(booking, perPiece)) {
      const choice: { current: LabSlipMode } = { current: 'perPiece' };
      const ok = await confirm({
        title: t('bookings.slipChoice.title'),
        body: <SlipChoice choice={choice} />,
        okLabel: t('bookings.slipChoice.print'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      mode = choice.current;
    }
    // «Anna Finta [3]» on every lab slip: how many pieces the customer has — what «Uno per pezzo» would print — on «Tutto insieme» too.
    const who = `${booking.customerName} [${pieceCount(booking, perPiece)}]`;
    // ⚠️ RUNAWAY PRINTING (a mistyped quantity): counted before anything is built. Above 30 the person is asked, above 300 nothing
    // prints. The same on the browser and the direct path.
    if (kind === 'lab') {
      const count = slipCount(booking, perPiece, mode);
      if (count > SLIPS_REFUSE_ABOVE) {
        say(t('bookings.slipMany.refused', { n: count }), 8000);
        return;
      }
      if (count > SLIPS_ASK_ABOVE) {
        const ok = await confirm({
          title: t('bookings.slipMany.title', { n: count }),
          okLabel: t('bookings.slipChoice.print'),
          cancelLabel: t('common.cancel'),
        });
        if (!ok) return;
      }
    }
    const slips = kind === 'lab' ? labSlips(booking, perPiece, mode) : [];

    // ── «Cliente» ──
    // The privacy line names only the name where that is all the booking holds: the venue does not ask for the phone, and the
    // booking has neither a phone (an older one may) nor an address (a delivery).
    const nameOnly = !settings.askPhone && booking.phone === '' && booking.address === '';
    const customerWords: CustomerSlipWords = {
      title: t('bookings.detail.title', { number }),
      when: t('bookings.slip.when', { mode: modeWord, day: slipDay(booking.date, paperLocale) }),
      // An old booking with no slot shows its exact time.
      time: booking.slotEnd !== null
        ? t('bookings.slip.slot', { from: booking.time, to: booking.slotEnd })
        : t('bookings.slip.at', { time: booking.time }),
      total: t('bookings.slip.total'),
      deposit: t('bookings.slip.deposit'),
      toPay: t('bookings.slip.toPay'),
      privacy: t(nameOnly ? 'bookings.slip.privacyName' : 'bookings.slip.privacy'),
    };

    // Through the browser's dialog: every slip of the print in one host, a page each. `from`: the first lab slip still to print
    // (after a direct print that stopped half-way, only the rest).
    const throughBrowser = (from = 0) => {
      if (kind === 'lab') {
        printSlip(
          <LabSlips who={who} generalNote={booking.notes} slips={slips.slice(from)} locale={paperLocale} unitWord={paperUnit} />,
          undefined,
          mode === 'perPiece' ? 'piece' : 'receipt',
        );
      } else {
        printSlip(<CustomerSlip booking={booking} words={customerWords} locale={paperLocale} unitWord={paperUnit} venueName={venueName ?? ''} money={money} />);
      }
    };
    const printer = readPrinterSetting();
    if (printer === null) {
      throughBrowser();
      return;
    }
    const paper = { locale: paperLocale, units: paperUnit, plain: printer.plain };
    // ⚠️ ONE DOCUMENT PER SLIP on the direct path: the printer cuts after each, so the per-piece slips come out separately.
    const documents: SlipLine[][] = kind === 'lab'
      ? labSlipDocuments({ ...paper, who, slips, generalNote: booking.notes })
      : [customerSlipLines({ ...paper, booking, words: customerWords, venueName: venueName ?? '', money })];
    const slipName = t(kind === 'lab' ? 'bookings.print.lab' : 'bookings.print.customer');
    setSending(kind);
    // One after another, each waiting for the printer's answer; the first that does not print stops the rest.
    let printed = 0;
    let outcome: PrintOutcome = { ok: true };
    for (const slipDocument of documents) {
      // Shown for as long as the printer may take to answer, not the default few seconds.
      say(documents.length > 1
        ? t('bookings.print.sendingMany', { current: printed + 1, total: documents.length })
        : t('bookings.print.sending'), PRINT_TIMEOUT_MS + 1000);
      outcome = await sendToPrinter(printer, slipDocument);
      if (!outcome.ok) break;
      printed += 1;
    }
    const reason = outcome.ok ? '' : printOutcomeText(t, outcome);
    const partial = printed > 0 && !outcome.ok ? t('bookings.print.partial', { n: printed, total: documents.length }) : '';
    if (!shown.current) {
      say(outcome.ok
        ? t('bookings.print.doneAway', { slip: slipName, number })
        : t('bookings.print.failedAway', { slip: slipName, number, reason: partial === '' ? reason : `${partial} ${reason}` }), outcome.ok ? undefined : 12000);
      return;
    }
    setSending(null);
    if (outcome.ok) {
      say(t('bookings.print.done'));
      return;
    }
    say('');
    const fallback = await confirm({
      title: t('bookings.print.failedTitle'),
      message: partial === '' ? reason : [partial, reason],
      okLabel: t('bookings.print.browser'),
      cancelLabel: t('common.cancel'),
    });
    // The browser prints what the printer did not.
    if (fallback) throughBrowser(printed);
  }

  return (
    <section className={styles.card} data-in-place={inPlace ? 'true' : undefined} aria-labelledby={`${ids}-title`} onKeyDown={inPlace ? closeOnEscape(onClose) : undefined}>
      {/* The title (h1) is the CUSTOMER'S NAME, «Booking No. 12» small and grey under it; Edit is the pencil alone (bookings rebuild
          step 3, the owner's design). */}
      <FormBar
        backLabel={t(inPlace ? 'bookings.detail.close' : 'ui.back')}
        backIcon={inPlace ? 'close' : 'back'}
        onBack={onBack}
        level={1}
        titleAfter={booking.status === 'collected' ? (
          <span className={styles.tag} data-tag="collected"><Check aria-hidden="true" />{t(STATUS_WORD.collected)}</span>
        ) : booking.status === 'cancelled' ? (
          <span className={styles.tag} data-tag="cancelled">{t(STATUS_WORD.cancelled)}</span>
        ) : undefined}
        title={booking.customerName}
        titleId={`${ids}-title`}
        titleRef={title}
        sub={<p className={styles.sub}>{t('bookings.detail.title', { number })}</p>}
        action={(
          <Button
            variant="secondary"
            className={styles.edit}
            aria-label={t('ui.edit')}
            onPress={() => { void navigate(editBookingPath(booking.id), { state: editFromBooking(booking.date) }); }}
          >
            <Pencil aria-hidden="true" />
          </Button>
        )}
      />
      <div className={styles.body}>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt className="visually-hidden">{t('bookings.detail.when')}</dt>
            <dd>
              <span className={styles.when}>{spellDate(booking.date, locale)} · {bookingTimeLabel(booking)}</span>
              <span className={styles.mode} data-mode={booking.mode}>{modeWord}</span>
            </dd>
          </div>
          {/* ⚠️ NO «CUSTOMER» GROUP WHEN THE PHONE IS OFF (the venue does not ask for it and none is stored) and nothing else is
              to say: the name is already the title. A stored phone is shown even where the venue no longer asks (an old booking). */}
          {phoneShown || addressShown ? (
            <div className={styles.fact}>
              <dt>{t('bookings.detail.customer')}</dt>
              <dd>
                {phoneShown ? (
                  <a className={styles.link} href={`tel:${booking.phone.replace(/\s+/g, '')}`} aria-label={t('bookings.detail.call', { phone: booking.phone })}>
                    {booking.phone}
                  </a>
                ) : null}
                {addressShown ? <span>{booking.address}</span> : null}
                {reminder !== '' ? (
                  <>
                    <a
                      className={styles.reminder}
                      href={reminder}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-describedby={`${ids}-reminder-hint`}
                    >
                      <MessageCircle aria-hidden="true" />
                      <span>{t('bookings.reminder.button')}</span>
                    </a>
                    <span id={`${ids}-reminder-hint`} className={styles.reminderHint}>{t('bookings.reminder.hint')}</span>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
          <div className={styles.fact}>
            <dt>{t('bookings.detail.items')}</dt>
            <dd>
              {/* Numbered as in the list, the price at the right edge. */}
              <BookingLines
                lines={booking.lines}
                locale={locale}
                words={words}
                notes
                order
                end={line => (line.unitPrice !== null ? formatMoney(lineAmount(line.qty, line.unitPrice), money) : null)}
              />
            </dd>
          </div>
          {booking.notes !== '' ? (
            <div className={styles.fact}>
              <dt>{t('bookings.detail.notes')}</dt>
              <dd className={styles.notes}>{booking.notes}</dd>
            </div>
          ) : null}
          {booking.total !== null || booking.deposit !== null ? (
            <div className={styles.fact}>
              <dt>{t('bookings.detail.money')}</dt>
              <dd>
                <dl className={styles.money}>
                  {booking.total !== null ? <><dt>{t('bookings.slip.total')}</dt><dd>{formatMoney(booking.total, money)}</dd></> : null}
                  {booking.deposit !== null ? <><dt>{t('bookings.slip.deposit')}</dt><dd>{formatMoney(booking.deposit, money)}</dd></> : null}
                  {due !== null ? <><dt className={styles.due}>{t('bookings.slip.toPay')}</dt><dd className={styles.due}>{formatMoney(due, money)}</dd></> : null}
                </dl>
              </dd>
            </div>
          ) : null}
        </dl>

        {/* ⚠️ NO PRINT BUTTONS ON A CANCELLED BOOKING (the owner's decision): hidden, not disabled. */}
        {booking.status !== 'cancelled' ? (
          <div className={styles.prints} role="group" aria-label={t('bookings.detail.print')}>
            {/* «Lab» / «Customer» with the printer (bookings rebuild step 3); each name says the whole of it and holds the word drawn.
                «Lab» may first ask one slip per piece or all together (step 4). */}
            <Button
              variant="secondary"
              className={styles.print}
              aria-label={t('bookings.print.labFull')}
              isPending={sending === 'lab' || !labReady}
              isDisabled={sending === 'customer'}
              onPress={() => { void print('lab'); }}
            >
              <Printer aria-hidden="true" />
              <span>{t('bookings.print.labShort')}</span>
            </Button>
            <Button
              variant="secondary"
              className={styles.print}
              aria-label={t('bookings.print.customerFull')}
              isPending={sending === 'customer'}
              isDisabled={sending === 'lab'}
              onPress={() => { void print('customer'); }}
            >
              <Printer aria-hidden="true" />
              <span>{t('bookings.print.customerShort')}</span>
            </Button>
          </div>
        ) : null}

        <div className={styles.foot}>
          {/* Low-key, left of the bin. On a cancelled booking the same spot undoes the cancelling. */}
          {booking.status === 'cancelled' ? (
            <Button variant="bare" className={styles.statusMove} onPress={reopen}>{t('bookings.reopen.button')}</Button>
          ) : (
            <Button variant="bare" className={styles.statusMove} onPress={() => { void cancel(); }}>{t('bookings.cancel.ok')}</Button>
          )}
          <Button variant="bare" className={styles.delete} aria-label={t('bookings.delete')} onPress={() => { void remove(); }}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
