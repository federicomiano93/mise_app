import type { ReactNode } from 'react';
import type { BookingLine } from './bookingModel';
import { lineQtyText } from './bookingWords';
import type { UnitWords } from './bookingWords';
import styles from './BookingLines.module.css';

// A booking's products, ONE PER LINE (bookings rebuild step 3, the owner's design), the same in the list's rows and on the
// booking's page: a black numbered circle (1, 2, 3 — the numbers of the form's cards), the quantity in normal weight, the product's
// name in bold. A weighed line reads «3 pz (1,5 kg)» (bookingWords.ts lineQtyText, step 2). `end` draws what goes at the line's
// right edge (the page's price); `notes` the line's own note under its name.
// `order` (the booking page, 19 Nov 2026): the lines in a box instead — «1.» «2.» in the accent colour, a thin divider between them,
// every other one on a faint ground, the price bold at the right end. Still an ordered list.
export function BookingLines({ lines, locale, words, end, notes = false, order = false }: {
  readonly lines: readonly BookingLine[];
  readonly locale: string;
  readonly words: UnitWords;
  readonly end?: (line: BookingLine) => ReactNode;
  readonly notes?: boolean;
  readonly order?: boolean;
}) {
  return (
    <ol className={order ? styles.order : styles.lines}>
      {lines.map((line, index) => (
        <li key={index} className={styles.line}>
          <span className={order ? styles.numberText : styles.number} aria-hidden="true">{order ? `${index + 1}.` : index + 1}</span>
          <span className={styles.text}>
            <span className={styles.qty}>{lineQtyText(line, locale, words)}</span>
            {' '}
            <span className={styles.name}>{line.name}</span>
            {notes && line.note !== '' ? <span className={styles.note}>{line.note}</span> : null}
          </span>
          {end ? <span className={styles.end}>{end(line)}</span> : null}
        </li>
      ))}
    </ol>
  );
}
