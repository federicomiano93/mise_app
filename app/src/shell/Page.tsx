import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import styles from './Page.module.css';

// Put in a navigation's `state` to say «this move is the app arranging itself, not the person
// going somewhere»: the page then keeps the focus where it is. See the focus effect below.
export const KEEP_FOCUS = { keepFocus: true } as const;

function keepsFocus(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'keepFocus' in state;
}

type Props = {
  title: string;
  children: ReactNode;
};

// Every screen is a Page: one h1 (the screen's name), the browser tab's title, and the
// focus moved onto the new screen after a client-side navigation.
export function Page({ title, children }: Props) {
  const { t } = useT();
  const location = useLocation();
  const navigationType = useNavigationType();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    document.title = t('page.title', { title });
  }, [t, title]);

  // ⚠️ A single-page app does not reload, so a screen-reader or keyboard user gets no sign
  // that the screen changed: focus stays on the link just pressed, now pointing at nothing
  // new. Moving it to the h1 reads the new screen's name out and puts the next Tab at its
  // first control. NOT on first load or on Back (POP): there the person has not asked for a
  // move, and on first load the skip link must stay the first Tab stop. The `/` → `/orders`
  // redirect is a REPLACE, hence the KEEP_FOCUS marker. Keyed on the location, not the mount:
  // two sections share this component, so React keeps one Page alive between them.
  useEffect(() => {
    if (navigationType === 'POP' || keepsFocus(location.state)) return;
    headingRef.current?.focus();
  }, [location.key]);

  return (
    <>
      <header className={styles.head}>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>{title}</h1>
      </header>
      <div className={styles.body}>{children}</div>
    </>
  );
}
