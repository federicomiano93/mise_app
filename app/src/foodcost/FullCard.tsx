import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '../i18n/useT';
import styles from './FullCard.module.css';

type BoxProps = {
  // The read view: a native details, closed until pressed — unless there is no summary above it, when it is the only thing
  // to see and starts open. The form: the same box as a plain section that cannot be closed, so a field Save checks (the
  // name, a number) can never sit hidden inside a closed box.
  read: boolean;
  // Read only: open while there is no summary above it. It opens when the box mounts like that, and again when it BECOMES so
  // (the product stops being costed while it is read); while it stays so, or is false, a person pressing the box is not argued with.
  openNow?: boolean;
  children: ReactNode;
};

// «Full card» (Federico, 7 Nov 2026; current app 18679a38): ONE box under the summary, holding a framed card per section —
// Product, Made of, Packaging, Labour, Price, Calculated costs — in the order they are filled in, results last.
export function FullCard({ read, openNow = false, children }: BoxProps) {
  const { t } = useT();
  const [open] = useState(openNow);
  const box = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (openNow && box.current) box.current.open = true;
  }, [openNow]);
  if (!read) {
    return (
      <div className={styles.full}>
        <p className={styles.label}>{t('fc.fullCard')}</p>
        <div className={styles.body}>{children}</div>
      </div>
    );
  }
  return (
    <details ref={box} className={styles.full} open={open}>
      <summary className={styles.summary}>
        <span>{t('fc.fullCard')}</span>
        <ChevronDown aria-hidden="true" className={styles.chevron} />
      </summary>
      <div className={styles.body}>{children}</div>
    </details>
  );
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
