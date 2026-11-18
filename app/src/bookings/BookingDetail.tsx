import { useEffect, useId, useRef, useState } from 'react';
import { MessageCircle, Pencil, Printer, Trash2 } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router';
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
import { BOOKING_STATUSES, toPay } from './bookingModel';
import type { Booking, BookingStatus } from './bookingModel';
import { CustomerSlip, LabSlip } from './BookingSlips';
import type { SlipWords } from './BookingSlips';
import { lineQtyText, slipLocale, slipUnitWords, spellDate } from './bookingWords';
import type { UnitWords } from './bookingWords';
import { useBookings, useBookingsStore } from './BookingsContext';
import { STATUS_WORD } from './BookingsList';
import { FROM_BOOKING, cameFromList } from './bookingsNav';
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
        <FormBar backLabel={t('ui.back')} onBack={back} title={t('section.bookings')} />
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
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const number = t('bookings.number', { n: booking.number });
  const title = useRef<HTMLHeadingElement>(null);
  const { state } = useLocation();
  // Opened from the list, the page leaves the focus alone: it goes to this booking's title, so its name is what is heard.
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const words: UnitWords = {
    unit: unit => t(unit === 'kg' ? 'bookings.unit.kg' : 'bookings.unit.pcs'),
    packs: n => t('bookings.unit.packs', { n }),
  };
  const modeWord = t(booking.mode === 'delivery' ? 'bookings.mode.delivery' : 'bookings.mode.pickup');
  const due = toPay(booking.total, booking.deposit);

  // ⚠️ THE WHATSAPP REMINDER (bookings step 4): a link that opens WhatsApp on this device, on the customer's chat, with the
  // message written; the person reads it and sends it. Only while the order is still to come, and only for a phone WhatsApp can
  // open (the venue's country code is added to a number typed without one). Words in the interface's language, as the slips;
  // the date and the money in the venue's country's way.
  const reminder = wantsReminder(booking, todayISO()) ? reminderUrl(whatsappNumber(booking.phone, countryOf(location)), reminderMessage({
    booking,
    locale: slipLocale(location, locale),
    units: slipUnitWords(location),
    money,
    words: {
      hello: t('bookings.reminder.hello', { name: booking.customerName }),
      intro: t(booking.mode === 'delivery' ? 'bookings.reminder.delivery' : 'bookings.reminder.pickup', {
        number, venue: venueName !== null && venueName !== undefined && venueName !== '' ? venueName : t('bookings.reminder.us'),
      }),
      when: (date, time) => t('bookings.reminder.when', { date, time }),
      address: address => t('bookings.reminder.address', { address }),
      toPay: amount => t('bookings.reminder.toPay', { amount }),
      bye: t('bookings.reminder.bye'),
    },
  })) : '';

  async function changeStatus(next: BookingStatus) {
    if (next === booking.status) return;
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
    say(t('bookings.statusSaved', { status: t(STATUS_WORD[next]) }));
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
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        title={t('bookings.detail.title', { number })}
        titleId={`${ids}-title`}
        titleRef={title}
        action={(
          <Button variant="primary" className={styles.edit} onPress={() => { void navigate(editBookingPath(booking.id), { state: FROM_BOOKING }); }}>
            <Pencil aria-hidden="true" />
            <span>{t('ui.edit')}</span>
          </Button>
        )}
      />
      <div className={styles.body}>
        <div role="group" aria-label={t('bookings.status.label')} className={styles.statuses}>
          {BOOKING_STATUSES.map(value => (
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
              <span className={styles.when}>{spellDate(booking.date, locale)} · {booking.time}</span>
              <span className={styles.mode} data-mode={booking.mode}>{modeWord}</span>
            </dd>
          </div>
          <div className={styles.fact}>
            <dt>{t('bookings.detail.customer')}</dt>
            <dd>
              <span className={styles.strong}>{booking.customerName}</span>
              <a className={styles.link} href={`tel:${booking.phone.replace(/\s+/g, '')}`} aria-label={t('bookings.detail.call', { phone: booking.phone })}>
                {booking.phone}
              </a>
              {booking.mode === 'delivery' && booking.address !== '' ? <span>{booking.address}</span> : null}
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
          <div className={styles.fact}>
            <dt>{t('bookings.detail.items')}</dt>
            <dd>
              <ul className={styles.lines}>
                {booking.lines.map((line, index) => (
                  <li key={index} className={styles.line}>
                    <span className={styles.qty}>{lineQtyText(line, locale, words)}</span>
                    <span>
                      <span className={styles.strong}>{line.name}</span>
                      {line.note !== '' ? <span className={styles.lineNote}>{line.note}</span> : null}
                    </span>
                    {line.unitPrice !== null ? <span className={styles.amount}>{formatMoney(lineAmount(line.qty, line.unitPrice), money)}</span> : null}
                  </li>
                ))}
              </ul>
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
          <Button variant="secondary" className={styles.print} isPending={sending === 'lab'} isDisabled={sending === 'customer'} onPress={() => { void print('lab'); }}>
            <Printer aria-hidden="true" />
            <span>{t('bookings.print.lab')}</span>
          </Button>
          <Button variant="secondary" className={styles.print} isPending={sending === 'customer'} isDisabled={sending === 'lab'} onPress={() => { void print('customer'); }}>
            <Printer aria-hidden="true" />
            <span>{t('bookings.print.customer')}</span>
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
