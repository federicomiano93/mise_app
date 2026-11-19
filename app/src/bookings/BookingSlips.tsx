import { formatMoney } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { lineAmount } from '@mise/shared/price-list';
import { toPay } from './bookingModel';
import type { Booking, BookingLine } from './bookingModel';
import { slipLineParts } from './bookingWords';
import type { UnitWords } from './bookingWords';
import { noteParts } from './labSlips';
import './booking-slip.css';

// The slips a booking prints, drawn into the print host (slipHost.tsx), never on screen. Redrawn in bookings rebuild step 4
// (19 Nov 2026) from the mockups the owner approved on the tablet.
//
// ⚠️ PLAIN CLASS NAMES FROM A GLOBAL STYLESHEET (booking-slip.css), like the label's paper: the host lives outside the app's
// tree and the print rule finds it by id. Black on white: a receipt printer prints nothing else.
//
// ⚠️ THE SAME CONTENT AS THE TEXT SLIPS FOR THE RECEIPT PRINTER (slipText.ts), line for line: change one, change the other.
//
// The words are handed in already translated (the interface's t(), the venue's language); the unit word and the locale of
// numbers and dates follow the venue's COUNTRY (bookingWords.ts slipUnitWords / slipLocale); money follows it too (formatMoney
// with the venue's Money).

// The customer slip's words, each already a whole phrase: «Prenotazione N. 12», «Ritiro: gio 24 dic», «dalle 09:00 alle 10:00».
export type CustomerSlipWords = {
  readonly title: string;
  readonly when: string;
  readonly time: string;
  readonly total: string;
  readonly deposit: string;
  readonly toPay: string;
  readonly privacy: string;
};

type Paper = {
  readonly locale: string;
  readonly unitWord: UnitWords;
};

// ── The lab ──

// One lab slip, exactly what the owner's paper slips carry and nothing more: the customer's name big with [N] (how many pieces
// they have), a dashed line, then each product — the quantity when more than one, the name bold, the weight — and under it the
// line's note, each comma-separated piece highlighted white on black around its words only. ⚠️ NO DATE, NO TIME, NO NUMBER, NO
// PRICE, NO PHONE, NO ADDRESS: it is stuck on the piece in the oven, and only has to say whose it is and how it is made.
function LabSlip({ who, lines, locale, unitWord, generalNote }: Paper & { who: string; lines: readonly BookingLine[]; generalNote: string }) {
  const general = noteParts(generalNote);
  return (
    <div className="bk-slip bk-slip--lab">
      <p className="bk-slip-who">{who}</p>
      <hr className="bk-slip-rule" />
      <ul className="bk-slip-items">
        {lines.map((line, index) => {
          const parts = slipLineParts(line, locale, unitWord, 'many');
          const notes = noteParts(line.note);
          return (
            <li key={index} className="bk-slip-item">
              <p className="bk-slip-product">
                {parts.qty !== '' ? <span className="bk-slip-qty">{parts.qty} </span> : null}
                <strong>{parts.name}</strong>
                {parts.size !== '' ? <span className="bk-slip-size"> {parts.size}</span> : null}
              </p>
              {notes.length > 0 ? (
                <p className="bk-slip-changes">
                  {notes.map((note, n) => (
                    <span key={n}>
                      {n > 0 ? ' ' : null}
                      <span className="bk-slip-hl">{note}</span>
                    </span>
                  ))}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {/* The booking's general note at the foot of EVERY lab slip (the owner's decision, 19 Nov 2026), highlighted like a line's. */}
      {general.length > 0 ? (
        <p className="bk-slip-changes bk-slip-general">
          {general.map((note, n) => (
            <span key={n}>
              {n > 0 ? ' ' : null}
              <span className="bk-slip-hl">{note}</span>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}

// Every lab slip of one print, each on a page of its own (booking-slip.css breaks the page between them), so «Uno per pezzo»
// comes out of the printer as separate slips. `who` is «Anna Finta [3]», the same on every slip; `generalNote` the booking's note.
export function LabSlips({ who, slips, locale, unitWord, generalNote = '' }: Paper & {
  who: string; slips: readonly (readonly BookingLine[])[]; generalNote?: string;
}) {
  return (
    <>
      {slips.map((lines, index) => <LabSlip key={index} who={who} lines={lines} locale={locale} unitWord={unitWord} generalNote={generalNote} />)}
    </>
  );
}

// ── The customer ──

// «Biglietto cliente» on 80 mm paper: the venue, «Prenotazione N. 12», the name big, «Ritiro: gio 24 dic» and «dalle 09:00 alle
// 10:00», the lines numbered with what each priced one comes to and its note under it, Totale / Acconto / Da pagare (big), and the
// privacy line at the foot.
export function CustomerSlip({ booking, words, locale, unitWord, venueName, money }: Paper & {
  booking: Booking; words: CustomerSlipWords; venueName: string; money: Money;
}) {
  const due = toPay(booking.total, booking.deposit);
  return (
    <div className="bk-slip">
      {venueName !== '' ? <p className="bk-slip-venue">{venueName}</p> : null}
      <p className="bk-slip-number">{words.title}</p>
      <p className="bk-slip-customer">{booking.customerName}</p>
      <p className="bk-slip-when">{words.when}</p>
      <p className="bk-slip-time">{words.time}</p>
      <hr className="bk-slip-rule" />
      <ol className="bk-slip-lines">
        {booking.lines.map((line, index) => {
          const parts = slipLineParts(line, locale, unitWord, 'always');
          return (
            <li key={index} className="bk-slip-line">
              <span className="bk-slip-index">{index + 1}.</span>
              <span className="bk-slip-name">
                <span>
                  {parts.qty} <strong>{parts.name}</strong>{parts.size !== '' ? ` ${parts.size}` : ''}
                </span>
                {line.unitPrice !== null
                  ? <span className="bk-slip-amount">{formatMoney(lineAmount(line.qty, line.unitPrice), money)}</span>
                  : null}
              </span>
              {line.note !== '' ? <span className="bk-slip-linenote">{line.note}</span> : null}
            </li>
          );
        })}
      </ol>
      {/* The booking's general note, plain, after the lines and before the money. */}
      {booking.notes.trim() !== '' ? <p className="bk-slip-notes">{booking.notes.trim()}</p> : null}
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
