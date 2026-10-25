import type { ReactNode } from 'react';
import styles from './SettingsScreen.module.css';

type Props = {
  // The id of the screen's title (the FormBar's h2): the region is named by it.
  labelledBy: string;
  // The FormBar: Back, the title and, on a form, Save.
  bar: ReactNode;
  children: ReactNode;
};

// The frame every screen of Settings shares: a card holding the bar and the body. Small screens, so they stay a
// centred column from 1000px rather than a split.
//
// ⚠️ NOTHING ON THE CARD MAY CLIP (no `overflow`): the form bar sticks to the top of the shell's scrolling area,
// and a clipping ancestor would turn it into an ordinary row.
export function SettingsScreen({ labelledBy, bar, children }: Props) {
  return (
    <section className={styles.screen} aria-labelledby={labelledBy}>
      {bar}
      <div className={styles.body}>{children}</div>
    </section>
  );
}
