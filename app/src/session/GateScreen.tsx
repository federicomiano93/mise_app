import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useT } from '../i18n/useT';
import { Mark } from './Mark';
import styles from './GateScreen.module.css';

type Props = {
  // The screen's own title, its h1. Left out, the product's name IS the h1 (the sign-in screen,
  // which has nothing else to be called).
  title?: string;
  subtitle?: string;
  children: ReactNode;
};

// The layout every screen ABOVE the app shares — sign in, choose a venue, no access, "could not
// check": a card in the middle of an empty page, with the mark and the product's name over it.
// None of these has the rail, the tab bar or a venue's name: nobody is inside yet (a venue's
// name on the sign-in screen told every other customer's staff they were signing in to
// somebody else's business).
//
// «Mise» is the product's name, written the same in every language; the one h1 is the screen's
// title, or «Mise» itself when it has none.
export function GateScreen({ title, subtitle, children }: Props) {
  const { t } = useT();

  // Inside the app, Page sets the tab's title; out here nothing else does.
  useEffect(() => {
    document.title = title === undefined ? t('app.name') : t('page.title', { title });
  }, [t, title]);

  const Name = title === undefined ? 'h1' : 'p';

  return (
    <main className={styles.screen}>
      <div className={styles.card}>
        <div className={styles.head}>
          <Mark />
          <Name className={title === undefined ? styles.heading : styles.name}>{t('app.name')}</Name>
          {title === undefined ? null : <h1 className={styles.heading}>{title}</h1>}
          {subtitle === undefined ? null : <p className={styles.subtitle}>{subtitle}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}
