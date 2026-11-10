import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '../i18n/useT';
import styles from './FullCard.module.css';

type BoxProps = {
  // The read view: a native details, closed until pressed — unless there is no summary above it, when it is the only thing
  // to see and starts open. The form: the same box as a plain section that cannot be closed, so a field Save checks (the
  // name, a number) can never sit hidden inside a closed box.
  read: boolean;
  // Read only: open from the start. ⚠️ Decided ONCE, when the box mounts (a later change must not close or open it under
  // somebody who has already pressed it).
  startOpen?: boolean;
  children: ReactNode;
};

// «Full card» (Federico, 7 Nov 2026; current app 18679a38): ONE box under the summary, holding a framed card per section —
// Product, Made of, Packaging, Labour, Price, Calculated costs — in the order they are filled in, results last.
export function FullCard({ read, startOpen = false, children }: BoxProps) {
  const { t } = useT();
  const [open] = useState(startOpen);
  if (!read) {
    return (
      <div className={styles.full}>
        <p className={styles.label}>{t('fc.fullCard')}</p>
        <div className={styles.body}>{children}</div>
      </div>
    );
  }
  return (
    <details className={styles.full} open={open}>
      <summary className={styles.summary}>
        <span>{t('fc.fullCard')}</span>
        <ChevronDown aria-hidden="true" className={styles.chevron} />
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
}

// A smaller heading inside a card («Weight and oven loss» in Made of).
export function SubHeading({ children }: { children: ReactNode }) {
  return <h4 className={styles.subTitle}>{children}</h4>;
}

// A card's content that takes the card's whole width (the card centres nothing: its other children sit at their own size).
export function CardStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

// One framed card of the box. The title names the region, so a screen reader can jump between cards.
export function CardSection({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.cardTitle}>{title}</h3>
      {children}
    </section>
  );
}
