import { useEffect, useRef } from 'react';
import type { MouseEvent, RefObject } from 'react';
import { ChevronDown } from 'lucide-react';
import { Link, NavLink, Outlet, useHref, useLocation, useNavigate } from 'react-router';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { SwitchVenueButton } from '../session/SwitchVenueButton';
import { MORE, moreIsCurrent, sectionById, titleKeyFor } from './sections';
import type { Section } from './sections';
import { useOnline } from './useOnline';
import { useToday } from './useToday';
import { useVisibleSections } from './useVisibleSections';
import styles from './AppShell.module.css';

// The frame around every screen: a rail on a tablet, a tab bar on a phone, a top bar on a
// tablet, and the section itself in the middle.
//
// ⚠️ BOTH NAVIGATIONS ARE ALWAYS IN THE DOM; CSS MEDIA QUERIES DECIDE WHICH ONE SHOWS. No
// script measures the width: a tablet turned from landscape to portrait, or a window resized,
// changes the layout with no render at all, and `display: none` keeps the hidden one out of the
// tab order and away from screen readers.
export function AppShell() {
  const { t } = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const contentRef = useRef<HTMLElement>(null);

  // One scroll area serves every section, so without this a long Orders list scrolled to the
  // bottom would open Recipes halfway down.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [pathname]);

  return (
    // Lets React Aria components that take an `href` navigate through the router instead of
    // reloading the page.
    <AriaRouterProvider navigate={to => navigate(to)} useHref={useHref}>
      <div className={styles.shell}>
        <SkipLink target={contentRef} />
        <Rail />
        <div className={styles.main}>
          <TopBar />
          <main id="main" ref={contentRef} tabIndex={-1} className={styles.content}>
            {/* Keyed on the section, so moving to another one clears a failure. A section that
                fails never got to print its own title, so the shell names it from the address:
                the fallback then has an h1 and the tab title of the screen it replaces. */}
            <PartBoundary resetKey={pathname.split('/')[1] ?? ''} title={t(titleKeyFor(pathname))}>
              <Outlet />
            </PartBoundary>
          </main>
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

// The rail is a plain box holding TWO things: the navigation (sections only) and, under it, the
// account's avatar. The avatar is a link to the person's account but not one of the app's
// sections, so it sits OUTSIDE the `nav` landmark — a screen reader announces «All sections»
// with exactly the sections in it.
function Rail() {
  const { t } = useT();
  const { railTop, railBottom } = useVisibleSections();

  return (
    <div className={styles.rail}>
      <nav className={styles.railNav} aria-label={t('nav.rail')}>
        <div className={styles.mark} aria-hidden="true">{t('app.name').charAt(0)}</div>
        {railTop.map(section => <RailLink key={section.id} section={section} />)}
        <div className={styles.spacer} />
        {railBottom.map(section => <RailLink key={section.id} section={section} />)}
      </nav>
      <AccountAvatar />
    </div>
  );
}

// Who is signed in, as the first letter of their email, under Settings. It leads to the Account
// card in Settings, so the name is «Account», not the letter (which is decoration).
function AccountAvatar() {
  const { t } = useT();
  const { user } = useSession();
  const letter = Array.from(user?.email || user?.uid || '?')[0]?.toUpperCase();
  // The link is 48px so a finger finds it; the circle inside is 40px.
  return (
    <Link to={sectionById('settings').path} className={styles.avatarLink} aria-label={t('account.title')}>
      <span className={styles.avatar} aria-hidden="true">{letter}</span>
    </Link>
  );
}

function RailLink({ section }: { section: Section }) {
  const { t } = useT();
  const Icon = section.icon;

  return (
    <NavLink to={section.path} className={styles.railItem}>
      <Icon className={styles.railIcon} />
      <span>{t(section.label)}</span>
    </NavLink>
  );
}

function TopBar() {
  const { t, locale } = useT();
  const today = useToday(locale);
  const online = useOnline();

  return (
    <header className={styles.topbar}>
      <Venue />
      <p className={styles.date}>{today}</p>
      <div className={styles.grow} />
      <p className={styles.sync} role="status">
        {/* The dot is decoration: the words carry the meaning, so colour is never the only signal. */}
        <span className={styles.dot} data-online={online} aria-hidden="true" />
        {online ? t('status.online') : t('status.offline')}
      </p>
    </header>
  );
}

// The venue this person is working on, left of the date. With more than one venue it is a button
// that opens the list of the others; with one it is just its name.
function Venue() {
  const { name, options } = useSession();
  // The first letter, by code point: a name that starts with an emoji or an accented capital
  // must not be cut in half.
  const initial = Array.from(name)[0]?.toUpperCase() ?? '';
  const label = (
    <>
      <span className={styles.venueDot} aria-hidden="true">{initial}</span>
      <span>{name}</span>
    </>
  );

  if (options.length < 2) return <p className={styles.venueStatic}>{label}</p>;

  return (
    <SwitchVenueButton variant="bare" className={styles.venue}>
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
