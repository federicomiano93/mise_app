import { useEffect, useRef } from 'react';
import type { MouseEvent, RefObject } from 'react';
import { Link, NavLink, Outlet, useHref, useLocation, useNavigate } from 'react-router';
import { RouterProvider as AriaRouterProvider } from 'react-aria-components';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { MORE, RAIL_BOTTOM, RAIL_TOP, TAB_SECTIONS, moreIsCurrent, titleKeyFor } from './sections';
import type { Section } from './sections';
import { useOnline } from './useOnline';
import { useToday } from './useToday';
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

function Rail() {
  const { t } = useT();

  return (
    <nav className={styles.rail} aria-label={t('nav.rail')}>
      <div className={styles.mark} aria-hidden="true">{t('app.name').charAt(0)}</div>
      {RAIL_TOP.map(section => <RailLink key={section.id} section={section} />)}
      <div className={styles.spacer} />
      {RAIL_BOTTOM.map(section => <RailLink key={section.id} section={section} />)}
    </nav>
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

function TabBar({ pathname }: { pathname: string }) {
  const { t } = useT();
  const MoreIcon = MORE.icon;

  return (
    <nav className={styles.tabbar} aria-label={t('nav.tabs')}>
      {TAB_SECTIONS.map(section => {
        const Icon = section.icon;
        return (
          <NavLink key={section.id} to={section.path} className={styles.tab}>
            <Icon className={styles.tabIcon} />
            <span>{t(section.label)}</span>
          </NavLink>
        );
      })}
      {/* A plain Link, not a NavLink: NavLink marks only the page it points at as current, and
          «More» also stands for every section it holds. */}
      <Link
        to={MORE.path}
        className={styles.tab}
        aria-current={moreIsCurrent(pathname) ? 'page' : undefined}
      >
        <MoreIcon className={styles.tabIcon} />
        <span>{t(MORE.label)}</span>
      </Link>
    </nav>
  );
}
