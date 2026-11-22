import { useEffect, useRef, useState } from 'react';
import type { MouseEvent, RefObject } from 'react';
import { ChevronDown, Ellipsis } from 'lucide-react';
import { Link, NavLink, Outlet, useHref, useLocation, useNavigate } from 'react-router';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { clearParkedCakes } from '../cakes/cakeParking';
import { useSession } from '../session/SessionContext';
import { SwitchVenueButton } from '../session/SwitchVenueButton';
import { AwayProvider } from './away/AwayContext';
import { announceScreen } from '../telemetry/usage';
import { AwayReminder } from './AwayReminder';
import { AwayRefusalAlert } from './away/AwayRefusalAlert';
import { MORE, moreIsCurrent, screenNameFor, titleKeyFor } from './sections';
import type { Section } from './sections';
import { useOnline } from './useOnline';
import { useToday } from './useToday';
import { ScrollAreaContext, useScrollAreaState } from './scrollArea';
import { useVisibleSections } from './useVisibleSections';
import { useKioskSettings } from '../kiosk/kioskSettings';
import { AccountMenu } from './AccountMenu';
import { KioskPills } from './KioskPills';
import { TitleSlotContext } from './titleSlot';
import styles from './AppShell.module.css';

// The section an address belongs to: its first segment («stocktake» for /stocktake/2026-10).
const sectionOf = (pathname: string): string => pathname.split('/')[1] ?? '';

// The frame around every screen: a rail on a tablet, a tab bar on a phone, ONE top bar on a tablet's every section (the section's title and
// gear, the venue and the date, «Standby» on a kiosk Home, the connection and the account's letter; and on a kiosk phone's Home, for «Standby»
// and the account menu), and the section itself in the middle.
//
// ⚠️ BOTH NAVIGATIONS ARE ALWAYS IN THE DOM; CSS MEDIA QUERIES DECIDE WHICH ONE SHOWS. No
// script measures the width or the height: a tablet turned from landscape to portrait, or a window resized,
// changes the layout with no render at all, and `display: none` keeps the hidden one out of the tab order and away from screen readers. The same
// goes for the rail's «More» item: the data says which links CAN spill
// (`data-spill`, and `data-items` on the rail), the stylesheet decides WHEN, by window height. (The one script choice is Page's: from 700px the
// title is drawn into the bar's slot, see titleSlot.ts.)
// This person's holiday is held here, at the venue level, so the Home's band, Settings' row and the once-a-day reminder agree.
export function AppShell() {
  return (
    <AwayProvider>
      <ShellFrame />
    </AwayProvider>
  );
}

function ShellFrame() {
  const { t } = useT();
  const { user, locationId } = useSession();
  // ⚠️ AN UNSAVED CAKE SET ASIDE FOR THE RECIPES BELONGS TO ONE PERSON IN ONE VENUE (cakes/cakeParking.ts): when either changes — or the shell
  // goes away because the session left the ready state — the shelf is emptied. A sign-out or a venue switch does not always reload the page.
  const uid = user?.uid ?? null;
  useEffect(() => () => { clearParkedCakes(); }, [uid, locationId]);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const contentRef = useRef<HTMLElement>(null);
  const { area, isOwned } = useScrollAreaState(contentRef);
  const lastPathname = useRef<string | null>(null);
  // ⚠️ THE TOP BAR IS ON EVERY SECTION from 700px (Federico, 21 Nov 2026: the bar everywhere), and since 22 Nov 2026 it is the ONLY bar: the section's
  // title and gear sit in it too. On 16 Nov it was the Home's only («too many elements» on the lab tablet); his later word wins, so the lab tablet
  // loses 60px of height in every section again — his choice. The offline strip under a title (Page) is hidden from 700px for the same reason: the
  // bar says it. On a phone the bar stays hidden, except on a kiosk device's Home (below).
  const onHome = sectionOf(pathname) === 'home';
  // On a kiosk device the Home's bar also carries «Standby» and the account menu (with «Exit»), so on a phone (where the bar is otherwise hidden) it
  // shows too. Only the Home: the kiosk controls never appear on the other sections, and a kiosk phone shows no bar there.
  const kioskOn = useKioskSettings().enabled;
  const kioskBar = onHome && kioskOn;
  // The cell at the left of the bar where a Page draws its title (titleSlot.ts). A state, not a ref object: a Page that mounts in the same render as
  // the bar has to hear when the cell arrives.
  const [titleSlot, setTitleSlot] = useState<HTMLElement | null>(null);

  // One scroll area serves every section, so without this a long Orders list scrolled to the
  // bottom would open Recipes halfway down.
  //
  // ⚠️ EXCEPT INSIDE A SECTION THAT OWNS THE SCROLL (scrollArea.tsx): its list and its detail are
  // separate addresses, and resetting at every one would lose the place in the list. The shell then
  // resets only when the SECTION changes — leaving an owner for another section resets as ever —
  // and the owner handles every move within itself.
  useEffect(() => {
    const before = lastPathname.current;
    lastPathname.current = pathname;
    if (before !== null && isOwned() && sectionOf(before) === sectionOf(pathname)) return;
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [pathname, isOwned]);

  // Tells the usage record and the error report which screen this is (telemetry/usage.ts). On
  // every move, but not for `/`: that redirects at once and the section it lands on announces
  // itself.
  useEffect(() => {
    const name = screenNameFor(pathname);
    if (name !== null) announceScreen(name);
  }, [pathname]);

  return (
    // Lets React Aria components that take an `href` navigate through the router instead of
    // reloading the page.
    <AriaRouterProvider navigate={to => navigate(to)} useHref={useHref}>
      <div className={styles.shell} data-kiosk={kioskBar ? 'on' : undefined}>
        <SkipLink target={contentRef} />
        <Rail />
        <div className={styles.main}>
          <TitleSlotContext.Provider value={titleSlot}>
            <TopBar kiosk={kioskBar} onHome={onHome} titleSlot={setTitleSlot} />
            <main id="main" ref={contentRef} tabIndex={-1} className={styles.content}>
              {/* ⚠️ The holiday reminder and refusal live HERE, not straight under the shell: each boundary is a <div>, and
                  a <div> under the shell's grid takes a cell — the rail and the screen sat low and jumped when the holiday
                  data landed (drive of 9 Nov 2026). Both only open dialogs, drawn over the page from <body>, so here they are
                  0px tall; a part that fails to draw shows its notice at the top of the content, covering nothing. Outside the
                  section's boundary, so moving section does not ask again. */}
              <PartBoundary>
                <AwayReminder />
              </PartBoundary>
              {/* Its own boundary: a reminder that fails to draw must not take the one «Not saved» of the holiday with it. */}
              <PartBoundary>
                <AwayRefusalAlert />
              </PartBoundary>
              {/* Keyed on the section, so moving to another one clears a failure. A section that
                  fails never got to print its own title, so the shell names it from the address:
                  the fallback then has an h1 and the tab title of the screen it replaces. */}
              <PartBoundary resetKey={sectionOf(pathname)} title={t(titleKeyFor(pathname))}>
                <ScrollAreaContext.Provider value={area}>
                  <Outlet />
                </ScrollAreaContext.Provider>
              </PartBoundary>
            </main>
          </TitleSlotContext.Provider>
        </div>
        <TabBar pathname={pathname} />
      </div>
    </AriaRouterProvider>
  );
}

function SkipLink({ target }: { target: RefObject<HTMLElement | null> }) {
  const { t } = useT();

  // ⚠️ preventDefault: the address is a HASH ROUTE (GitHub Pages cannot rewrite deep links).
  // Following href="#main" would put "#main" in the address, the router would read it as the
  // page "/main", and a keyboard user skipping the menu would land on «Page not found». The
  // href stays for what it says to assistive technology.
  const skip = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    target.current?.focus();
  };

  return (
    <a className={styles.skip} href="#main" onClick={skip}>
      {t('nav.skip')}
    </a>
  );
}

// The rail is a plain box holding the navigation: the sections, evenly spread over its height, then a thin rule and Settings at the foot. The
// account's letter is no longer here (22 Nov 2026): it is the last thing of the top bar, and the rail holds sections only.
function Rail() {
  const { t } = useT();
  const { pathname } = useLocation();
  const { railTop, railBottom, railSpill } = useVisibleSections();

  return (
    <div className={styles.rail} data-items={railTop.length + railBottom.length}>
      <nav className={styles.railNav} aria-label={t('nav.rail')}>
        {/* The places spread over the height that is left (space-between), so a tall window has even gaps and a short one sits at its minimum. */}
        <div className={styles.railGroup}>
          {railTop.map(section => <RailLink key={section.id} section={section} spill={railSpill.includes(section)} />)}
          {/* Hidden by CSS until a short window hides the spilled links (AppShell.module.css, the last step). A plain Link: «More»
              also stands for every section it holds here. */}
          {railSpill.length === 0 ? null : (
            <Link
              to={MORE.path}
              className={`${styles.railItem} ${styles.railMore}`}
              aria-current={moreIsCurrent(pathname, railSpill) ? 'page' : undefined}
            >
              <Ellipsis className={styles.railIcon} />
              <span>{t(MORE.label)}</span>
            </Link>
          )}
        </div>
        {/* A divider above Settings: decoration only. */}
        <div className={styles.railRule} aria-hidden="true" />
        {railBottom.map(section => <RailLink key={section.id} section={section} spill={false} />)}
      </nav>
    </div>
  );
}

function RailLink({ section, spill }: { section: Section; spill: boolean }) {
  const { t } = useT();
  const Icon = section.icon;

  return (
    <NavLink to={section.path} className={styles.railItem} data-spill={spill ? '' : undefined}>
      <Icon className={styles.railIcon} />
      <span>{t(section.label)}</span>
    </NavLink>
  );
}

// The ONE bar, left to right: [the section's title and gear (a Page draws them into the slot, from 700px)] · [venue and date, centred] ·
// [«Standby» on a kiosk Home] [connection] [the account's letter]. A grid with a `1fr` cell at each side, so the middle is truly centred when
// there is room and shifts, never overlaps, when a long title needs more (AppShell.module.css).
function TopBar({ kiosk, onHome, titleSlot }: { kiosk: boolean; onHome: boolean; titleSlot: (node: HTMLElement | null) => void }) {
  const { t, locale } = useT();
  const today = useToday(locale);
  const online = useOnline();

  return (
    <header className={styles.topbar}>
      <div className={styles.barLeft} ref={titleSlot} />
      <div className={styles.barMiddle}>
        <Venue switchable={onHome} />
        <p className={styles.date}>{today}</p>
      </div>
      <div className={styles.barRight}>
        {/* The Home's kiosk pill only; in its own part, so a failure there cannot break the bar. */}
        {kiosk ? <PartBoundary><KioskPills /></PartBoundary> : null}
        <p className={styles.sync} role="status">
          {/* The dot is decoration: the words carry the meaning, so colour is never the only signal. */}
          <span className={styles.dot} data-online={online} aria-hidden="true" />
          <span className={styles.syncText}>{online ? t('status.online') : t('status.offline')}</span>
        </p>
        <PartBoundary><AccountMenu kiosk={kiosk} /></PartBoundary>
      </div>
    </header>
  );
}

// The venue this person is working on, in the middle of the bar. ⚠️ A SWITCH IS A HOME (AND SETTINGS) ACTION ONLY: it reloads the app, and an editor open
// in another section would lose its unsaved edits without the router ever asking (the blocker never sees a reload). So off the Home it is the name alone.
// On the Home, with more than one venue it is a button
// that opens the list of the others; with one it is just its name.
function Venue({ switchable }: { switchable: boolean }) {
  const { t } = useT();
  const { name, options } = useSession();
  const label = <span className={styles.venueName}>{name}</span>;

  if (options.length < 2 || !switchable) return <p className={styles.venueStatic}>{label}</p>;

  return (
    <SwitchVenueButton variant="bare" className={styles.venue} aria-label={t('account.switchVenueChip', { name })}>
      {label}
      <ChevronDown className={styles.venueChevron} aria-hidden="true" />
    </SwitchVenueButton>
  );
}

function TabBar({ pathname }: { pathname: string }) {
  const { t } = useT();
  const { tabs, more } = useVisibleSections();
  const MoreIcon = MORE.icon;

  return (
    <nav className={styles.tabbar} aria-label={t('nav.tabs')}>
      {tabs.map(section => {
        const Icon = section.icon;
        return (
          <NavLink key={section.id} to={section.path} className={styles.tab}>
            <Icon className={styles.tabIcon} />
            <span>{t(section.label)}</span>
          </NavLink>
        );
      })}
      {/* A plain Link, not a NavLink: NavLink marks only the page it points at as current, and
          «More» also stands for every section it holds. It is there only when it holds
          something (Settings is always in it, so in practice always). */}
      {more.length === 0 ? null : (
        <Link
          to={MORE.path}
          className={styles.tab}
          aria-current={moreIsCurrent(pathname, more) ? 'page' : undefined}
        >
          <MoreIcon className={styles.tabIcon} />
          <span>{t(MORE.label)}</span>
        </Link>
      )}
    </nav>
  );
}
