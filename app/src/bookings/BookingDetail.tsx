import { useEffect, useId, useRef, useState } from 'react';
import { MessageCircle, Pencil, Printer, Trash2 } from 'lucide-react';
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
import type { Booking, BookingStatus } from './bookingModel';
import { CustomerSlip, LabSlip } from './BookingSlips';
import type { SlipWords } from './BookingSlips';
import { slipLocale, slipUnitWords, spellDate } from './bookingWords';
import { BookingLines } from './BookingLines';
import type { UnitWords } from './bookingWords';
import { useBookingSettings, useBookings, useBookingsStore } from './BookingsContext';
import { reminderOn } from './bookingSettings';
import { STATUS_WORD } from './BookingsList';
import { cameFromList, editFromBooking } from './bookingsNav';
import { BOOKINGS_PATH, editBookingPath } from './bookingsPath';
import { printSlip } from './slipHost';
import { PRINT_TIMEOUT_MS, readPrinterSetting, sendToPrinter } from './receiptPrinter';
import { printOutcomeText } from './printWords';
import { customerSlipLines, labSlipLines } from './slipText';
import { countryOf } from '@mise/shared/market';
import { reminderMessage, reminderUrl, wantsReminder, whatsappNumber } from './reminderText';
import styles from './BookingDetail.module.css';

// One booking (18 Nov 2026): its status (a tap saves it), when, who, what, the money, the two slips and the bin.
//
// ⚠️ THE BIN IS ALSO HOW A CUSTOMER'S «DELETE MY DATA» IS HONOURED: the booking goes for good, with the name, phone and address.
export function BookingDetail({ id }: { id: string }) {
  const { t } = useT();
  const { status, items } = useBookings();
  const booking = items.find(item => item.id === id) ?? null;
  const navigate = useNavigate();
  const { state } = useLocation();
  // A booking opened from the list goes back by the browser's Back (the list is the entry behind it); opened by its address it
  // replaces itself with the list.
  const back = () => {
    if (cameFromList(state)) void navigate(-1);
    else void navigate(BOOKINGS_PATH, { replace: true });
  };

  if (booking === null) {
    return (
      <section className={styles.card} aria-busy={status === 'loading'}>
        {/* The page draws no h1 for a booking (its h1 is the customer's name): until there is one, the section's name is it. */}
        <FormBar backLabel={t('ui.back')} onBack={back} title={t('section.bookings')} level={1} />
        <div className={styles.body}>
          {status === 'loading' ? <p className={styles.muted}>{t('bookings.loading')}</p> : (
            <>
              <p>{t('bookings.notFound')}</p>
              <Link to={BOOKINGS_PATH} replace className={styles.link}>{t('bookings.backToList')}</Link>
            </>
          )}
        </div>
      </section>
    );
  }
  return <Shown booking={booking} onBack={back} />;
}

function Shown({ booking, onBack }: { booking: Booking; onBack: () => void }) {
  const { t, locale } = useT();
  const store = useBookingsStore();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const money = useMoney();
  const { location, name: venueName } = useSession();
  // The venue's settings (bookings settings, 18 Nov 2026): without the phone asked, no phone and no reminder on this page.
  const { settings } = useBookingSettings();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const number = t('bookings.number', { n: booking.number });
  const title = useRef<HTMLHeadingElement>(null);
  const { state } = useLocation();
  const navigationType = useNavigationType();
  // ⚠️ THE PAGE DRAWS NO h1 HERE (Page `ownHeading`), so the move of the focus a page makes is this booking's to make: on its
  // title, the customer's name, as the page would on its own h1 — opened from the list, from the Home, or after its loading line.
  // Not on Back (POP) nor on the first load, as the page (the skip link stays the first Tab stop), unless the list sent it here.
  useEffect(() => {
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (cameFromList(state) || navigationType !== 'POP' || lost) title.current?.focus({ preventScroll: true });
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

  // Two choices only, Collected and Cancelled (bookings rebuild step 3): a tap on the one already on puts the booking back to open
  // (`todo`). The stored `ready` reads as open.
  async function changeStatus(pressed: 'collected' | 'cancelled') {
    const next: BookingStatus = booking.status === pressed ? 'todo' : pressed;
    if (next === 'cancelled') {
      const ok = await confirm({
        title: t('bookings.cancel.title'),
        message: t('bookings.cancel.body'),
        okLabel: t('bookings.cancel.ok'),
        cancelLabel: t('bookings.cancel.keep'),
        danger: true,
      });
      if (!ok) return;
    }
    store.setStatus(booking.id, next);
    say(next === 'todo' ? t('bookings.reopened') : t('bookings.statusSaved', { status: t(STATUS_WORD[next]) }));
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
    if (sending !== null) return;
    const words: SlipWords = {
      number,
      mode: modeWord,
      labTitle: t('bookings.slip.labTitle'),
      notes: t('bookings.slip.notes'),
      total: t('bookings.slip.total'),
      deposit: t('bookings.slip.deposit'),
      toPay: t('bookings.slip.toPay'),
      privacy: t('bookings.slip.privacy'),
    };
    const paperLocale = slipLocale(location, locale);
    const paperUnit = slipUnitWords(location);
    const throughBrowser = () => {
      printSlip(kind === 'lab'
        ? <LabSlip booking={booking} words={words} locale={paperLocale} unitWord={paperUnit} />
        : <CustomerSlip booking={booking} words={words} locale={paperLocale} unitWord={paperUnit} venueName={venueName ?? ''} money={money} />);
    };
    const printer = readPrinterSetting();
    if (printer === null) {
      throughBrowser();
      return;
    }
    const common = { booking, words, locale: paperLocale, units: paperUnit, plain: printer.plain };
    const lines = kind === 'lab' ? labSlipLines(common) : customerSlipLines({ ...common, venueName: venueName ?? '', money });
    const slipName = t(kind === 'lab' ? 'bookings.print.lab' : 'bookings.print.customer');
    setSending(kind);
    // Shown for as long as the printer may take to answer, not the default few seconds.
    say(t('bookings.print.sending'), PRINT_TIMEOUT_MS + 1000);
    const outcome = await sendToPrinter(printer, lines);
    if (!shown.current) {
      say(outcome.ok
        ? t('bookings.print.doneAway', { slip: slipName, number })
        : t('bookings.print.failedAway', { slip: slipName, number, reason: printOutcomeText(t, outcome) }), outcome.ok ? undefined : 12000);
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
      message: printOutcomeText(t, outcome),
      okLabel: t('bookings.print.browser'),
      cancelLabel: t('common.cancel'),
    });
    if (fallback) throughBrowser();
  }

  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      {/* The title (h1) is the CUSTOMER'S NAME, «Booking No. 12» small and grey under it; Edit is the pencil alone (bookings rebuild
          step 3, the owner's design). */}
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        level={1}
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
        <div role="group" aria-label={t('bookings.status.label')} className={styles.statuses}>
          {(['collected', 'cancelled'] as const).map(value => (
            <button
              key={value}
              type="button"
              className={styles.statusChoice}
              data-status={value}
              aria-pressed={booking.status === value}
              onClick={() => { void changeStatus(value); }}
            >
              {t(STATUS_WORD[value])}
            </button>
          ))}
        </div>

        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{t('bookings.detail.when')}</dt>
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

        <div className={styles.prints} role="group" aria-label={t('bookings.detail.print')}>
          {/* «Lab» / «Customer» with the printer (bookings rebuild step 3); each name says the whole of it and holds the word drawn.
              What they print is unchanged until step 4. */}
          <Button
            variant="secondary"
            className={styles.print}
            aria-label={t('bookings.print.labFull')}
            isPending={sending === 'lab'}
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

        <div className={styles.foot}>
          <Button variant="bare" className={styles.delete} aria-label={t('bookings.delete')} onPress={() => { void remove(); }}>
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      </div>
      {confirmDialog}
    </section>
  );
}
