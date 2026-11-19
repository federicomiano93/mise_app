import type { ReactNode } from 'react';
import type { BookingLine } from './bookingModel';
import { lineQtyText } from './bookingWords';
import type { UnitWords } from './bookingWords';
import styles from './BookingLines.module.css';

// A booking's products, ONE PER LINE (bookings rebuild step 3, the owner's design), the same in the list's rows and on the
// booking's page: a black numbered circle (1, 2, 3 — the numbers of the form's cards), the quantity in normal weight, the product's
// name in bold. A weighed line reads «3 pz (1,5 kg)» (bookingWords.ts lineQtyText, step 2). `end` draws what goes at the line's
// right edge (the page's price); `note` the line's own note under its name.
export function BookingLines({ lines, locale, words, end, notes = false }: {
  readonly lines: readonly BookingLine[];
  readonly locale: string;
  readonly words: UnitWords;
  readonly end?: (line: BookingLine) => ReactNode;
  readonly notes?: boolean;
}) {
  return (
    <ol className={styles.lines}>
      {lines.map((line, index) => (
        <li key={index} className={styles.line}>
          <span className={styles.number} aria-hidden="true">{index + 1}</span>
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
