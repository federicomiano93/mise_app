import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { useMediaQuery } from '../ui/useMediaQuery';
import { OfflineBanner } from './OfflineBanner';
import { PageMountedContext } from './pageMounted';
import { useTitleSlot } from './titleSlot';
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
  // A small control on the title's own line, at the far right (Settings' «Log out»). From 700px, with the title in the top bar, it stays in
  // the page, on a row of its own at the right, above the content.
  action?: ReactNode;
  // The ONE control that sits right beside the title: a section's settings gear. From 700px it moves into the top bar with the title; on a
  // phone it is drawn after the title, in the title bar. `null` (not `undefined`) says «a gear that is not shown now» and keeps the phone's
  // title bar the same white band without it.
  gear?: ReactNode;
  // A section's own title BAND (Orders, 16 Nov 2026): the OTHER controls of the title line — History, the bell, the lists, send. On a phone they
  // follow the title (and the gear) on its line, the bar white, with no line under it, and stuck to the top of the scroll area on the split. From
  // 700px, with the title in the top bar, they are a white row under it. Instead of `action`, never with it.
  band?: ReactNode;
  // The band sticks to the top of the scroll area on the split (Orders, whose pane and search box stick under it). The other
  // sections' bands scroll away: their panes stick at the very top, and a stuck band would cover them.
  stickyBand?: boolean;
  // The band's controls drop to a line of their own on a narrow phone (Orders: five of them do not fit beside «Orders» at 296px).
  // Every other title bar holds one gear: it stays beside the title, and a long title («Ingredienti e fornitori») wraps on itself.
  bandWraps?: boolean;
  // The screen draws its OWN h1 (a booking, whose h1 is the customer's name: bookings rebuild step 3) and moves the focus to it
  // itself: the page then draws no title bar, and `title` names only the browser tab (and, from 700px, the plain words in the top bar).
  ownHeading?: boolean;
};

// Every screen is a Page: one h1 (the screen's name), the browser tab's title, and the
// focus moved onto the new screen after a client-side navigation.
//
// ⚠️ FROM 700px THE TITLE LIVES IN THE TOP BAR (the single bar, 22 Nov 2026): the page draws its title and its gear into the shell's title slot
// (titleSlot.ts) through a portal, and the h1 is still ONE, still the element that takes the focus after a navigation. Two things must hold:
// the choice is made by script (the same 700px as the stylesheets), so a Page outside the shell (no slot) or under 700px draws everything in
// the page exactly as before; and only ONE Page is mounted at a time (two would put two titles in the same slot). No ROUTE mounts two, and a
// PartBoundary with a `title` inside a Page draws its notice without a Page of its own (pageMounted.ts).
export function Page({ title, children, action, gear, band, stickyBand = false, bandWraps = false, ownHeading = false }: Props) {
  const { t } = useT();
  const location = useLocation();
  const navigationType = useNavigationType();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const slot = useTitleSlot();
  const wide = useMediaQuery('(min-width: 700px)');

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

  const bar = wide && slot !== null;
  const headingClass = bar ? `${styles.title} ${styles.barTitle}` : styles.title;
  const heading = <h1 ref={headingRef} tabIndex={-1} className={headingClass}>{title}</h1>;

  // ⚠️ ONE RETURN, THE BODY ALWAYS THIRD: the page's content must keep its position in the tree when the window crosses 700px (a tablet turned,
  // a window resized), or React unmounts it and mounts it again — an input half typed in, a list's scroll, an open editor would be thrown away.
  // So the two layouts fill the same three places: [the title (a portal into the bar, or the page's own header)] [the row under it (Orders'
  // other controls, Settings' action; or the offline strip)] [the body]. Page.bar.spec.tsx types into an input and flips the window.
  let first: ReactNode = null;
  let second: ReactNode = null;
  if (bar && slot !== null) {
    // Under the bar: Orders' other controls as a white row, or Settings' action alone on a row at the right; nothing at all for a page with
    // neither (its content then starts a little lower: `.bodyTop`). A page that draws its own h1 has no row either, as on a phone.
    first = createPortal(
      <div className={styles.cluster}>
        {/* A booking opened full screen has its own h1 (the customer's name): the section's name is then plain words, and no gear. */}
        {ownHeading ? <p className={styles.barTitle}>{title}</p> : <>{heading}{gear ?? null}</>}
      </div>,
      slot,
    );
    if (!ownHeading) {
      if (band !== undefined && band !== null) {
        const classes = [styles.barRow, bandWraps ? styles.barRowWraps : '', stickyBand ? styles.stickyBand : ''].filter(Boolean).join(' ');
        second = <div className={classes}>{band}</div>;
      } else if (action) {
        second = <div className={styles.actionRow}><div className={styles.action}>{action}</div></div>;
      }
    }
  } else {
    const banded = band !== undefined || gear !== undefined;
    const headClass = banded
      ? `${styles.head} ${styles.band}${bandWraps ? ` ${styles.bandWraps}` : ''}${stickyBand ? ` ${styles.stickyBand}` : ''}${action ? ` ${styles.bandAction}` : ''}`
      : action ? `${styles.head} ${styles.withAction}` : styles.head;
    if (!ownHeading) {
      first = (
        <header className={headClass}>
          {heading}
          {gear ?? null}
          {band ?? null}
          {action ? <div className={styles.action}>{action}</div> : null}
        </header>
      );
    }
    // Under the title of every screen while the device is offline (from 700px the top bar says it instead; CSS hides the strip).
    second = <OfflineBanner />;
  }
  const bodyClass = bar && second === null ? `${styles.body} ${styles.bodyTop}` : styles.body;

  return (
    <PageMountedContext.Provider value>
      {first}
      {second}
      <div className={bodyClass}>{children}</div>
    </PageMountedContext.Provider>
  );
}
