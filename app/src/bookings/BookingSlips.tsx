import { formatMoney } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { lineAmount } from '@mise/shared/price-list';
import { toPay } from './bookingModel';
import type { Booking, BookingUnit } from './bookingModel';
import { qtyText, shortDate, spellDate } from './bookingWords';
import './booking-slip.css';

// The two slips a booking prints (18 Nov 2026), drawn into the print host (slipHost.tsx), never on screen.
//
// ⚠️ PLAIN CLASS NAMES FROM A GLOBAL STYLESHEET (booking-slip.css), like the label's paper: the host lives outside the app's
// tree and the print rule finds it by id. Black on white: a receipt printer prints nothing else.
//
// The words are handed in already translated (the interface's t(), the venue's language); the unit word and the locale of
// numbers and dates follow the venue's COUNTRY (bookingWords.ts slipUnitWord / slipLocale); money follows it too (formatMoney
// with the venue's Money).

export type SlipWords = {
  readonly number: string;
  readonly mode: string;
  readonly labTitle: string;
  readonly notes: string;
  readonly total: string;
  readonly deposit: string;
  readonly toPay: string;
  readonly privacy: string;
};

type SlipProps = {
  readonly booking: Booking;
  readonly words: SlipWords;
  readonly locale: string;
  readonly unitWord: (unit: BookingUnit) => string;
};

// `money`: given on the customer's slip only, which shows what each priced line comes to (bookings step 2); the lab's has no prices.
function Lines({ booking, locale, unitWord, money }: Omit<SlipProps, 'words'> & { money?: Money }) {
  return (
    <ul className="bk-slip-lines">
      {booking.lines.map((line, index) => (
        <li key={index} className="bk-slip-line">
          <span className="bk-slip-qty">{qtyText(line.qty, line.unit, locale, unitWord)}</span>
          <span className="bk-slip-name">
            {line.name}
            {money !== undefined && line.unitPrice !== null
              ? <span className="bk-slip-amount">{formatMoney(lineAmount(line.qty, line.unitPrice), money)}</span>
              : null}
          </span>
          {line.note !== '' ? <span className="bk-slip-linenote">{line.note}</span> : null}
        </li>
      ))}
    </ul>
  );
}

// «Foglio laboratorio»: what to make and when. ⚠️ NO PHONE, NO ADDRESS AND NO NAME (the owner's plan): the lab needs none of
// them, and a sheet left on the bench is read by anybody.
export function LabSlip({ booking, words, locale, unitWord }: SlipProps) {
  return (
    <div className="bk-slip">
      <div className="bk-slip-head">
        <span className="bk-slip-title">{words.labTitle}</span>
        <span className="bk-slip-number">{words.number}</span>
      </div>
      <p className="bk-slip-when">{spellDate(booking.date, locale)} · {booking.time}</p>
      <p className="bk-slip-mode">{words.mode}</p>
      <hr className="bk-slip-rule" />
      <Lines booking={booking} locale={locale} unitWord={unitWord} />
      {booking.notes !== '' ? (
        <>
          <hr className="bk-slip-rule" />
          <p className="bk-slip-notes"><span className="bk-slip-label">{words.notes}:</span> {booking.notes}</p>
        </>
      ) : null}
    </div>
  );
}

// «Biglietto cliente»: the venue, the number, the name, what was ordered, when, and the money; the privacy line at the foot.
export function CustomerSlip({ booking, words, locale, unitWord, venueName, money }: SlipProps & { venueName: string; money: Money }) {
  const due = toPay(booking.total, booking.deposit);
  return (
    <div className="bk-slip">
      {venueName !== '' ? <p className="bk-slip-venue">{venueName}</p> : null}
      <p className="bk-slip-number bk-slip-number--big">{words.number}</p>
      <p className="bk-slip-customer">{booking.customerName}</p>
      <p className="bk-slip-when">{words.mode}: {shortDate(booking.date, locale)} {booking.time}</p>
      <hr className="bk-slip-rule" />
      <Lines booking={booking} locale={locale} unitWord={unitWord} money={money} />
      {booking.total !== null || booking.deposit !== null ? (
        <>
          <hr className="bk-slip-rule" />
          <dl className="bk-slip-money">
            {booking.total !== null ? <><dt>{words.total}</dt><dd>{formatMoney(booking.total, money)}</dd></> : null}
            {booking.deposit !== null ? <><dt>{words.deposit}</dt><dd>{formatMoney(booking.deposit, money)}</dd></> : null}
            {due !== null ? <><dt className="bk-slip-due">{words.toPay}</dt><dd className="bk-slip-due">{formatMoney(due, money)}</dd></> : null}
          </dl>
        </>
      ) : null}
      <hr className="bk-slip-rule" />
      <p className="bk-slip-privacy">{words.privacy}</p>
    </div>
  );
}
