import { useId } from 'react';
import type { ReactNode } from 'react';
import { HelpHead } from '../ui/HelpToggle';
import styles from './CardSection.module.css';

// A card's content that takes the card's whole width (the card centres nothing: its other children sit at their own size).
export function CardStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>;
}

// One section of the product's screen (Product, Made of, Baking, Packaging, Work, Price), in the order they are filled in: a card of
// its own, its title with a «?» that opens what the section is for (11 Nov 2026). The title names the region, so a screen reader
// can jump between sections.
export function CardSection({ title, help, children }: { title: string; help: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <HelpHead title={title} help={help} titleId={titleId} />
      {children}
    </section>
  );
}
