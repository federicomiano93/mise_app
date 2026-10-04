// home-settings.js — the Home's one «Settings» door, and everything that used to line
// the bottom of the Home.
//
// Federico, 13 Sep 2026: «io metterei solo un tasto settings perche' senno' diventano
// troppe scritte in fondo alla pagina». Holiday, App language, Home cards, Who can get
// in, Switch location and Log out were up to six underlined lines under the cards;
// they are rows on this screen now.
//
// ⚠️ NOTHING HERE CHANGES WHO MAY DO WHAT. Every gate below is the one the strip had —
// canManage, isOwner, more than one venue — and every row opens the same screen,
// which asks the server the same question. Hiding a row is courtesy, never security (P2).
//
// ⚠️ LOG OUT STAYS LOW-KEY AND LAST (P20): a quiet underlined line under the rows,
// never a row dressed like the others, and it still asks first.

import { t } from './i18n.js';
import { confirmDialog } from './confirm-dialog.js';
import { signOutNow, switchLocation, forgetLocation } from './firebase.js';
import { mayLeaveWithUnsent } from './unsent-guard.js';
import { buildAwayButton } from './away-screen.js';
import { versionNumber, versionState } from './app-version.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

function node(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

// The app's Back chevron, built as nodes rather than parsed from a string.
function backIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', width: '22', height: '22', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M15 18l-6-6 6-6');
  svg.appendChild(path);
  return svg;
}

// One row: what it is, and one sentence saying what is behind it — a door to another
// screen, in the app's ONE settings look (tokens.css .set-*, 28 Sep 2026).
function rowText(btn, title, sub) {
  const text = node('span', 'set-text');
  text.append(node('span', 'set-title', title), node('span', 'set-sub', sub));
  btn.textContent = '';
  btn.append(text);
}

function item(title, sub, onClick) {
  const btn = node('button', 'set-row set-door');
  btn.type = 'button';
  rowText(btn, title, sub);
  btn.addEventListener('click', onClick);
  return btn;
}

// A card of rows under one title. A card with no rows is not drawn.
function section(title, rows) {
  const inner = rows.filter(Boolean);
  if (!inner.length) return null;
  const card = node('section', 'set-section');
  const head = node('div', 'set-head');
  head.append(node('h3', '', title));
  card.append(head, ...inner);
  return card;
}

export function openHomeSettings(session) {
  const options = session.options || [];

  const back = node('button', 'app-icon-btn orders-icon-btn');
  back.type = 'button';
  back.setAttribute('aria-label', t('auth.back'));
  back.appendChild(backIcon());
  back.addEventListener('click', close);

  const titleWrap = node('div', 'app-header-title orders-header-title');
  titleWrap.appendChild(node('h1', '', t('ui.settings')));
  const leftSlot = node('span', 'app-header-slot');
  leftSlot.appendChild(back);

  const header = node('header', 'app-header orders-header');
  header.append(leftSlot, titleWrap, node('span', 'app-header-slot'));

  const scroll = node('div', 'people-scroll set-screen');
  const overlay = node('div', 'people-overlay');
  overlay.append(header, scroll);

  function paint() {
    scroll.textContent = '';

    // ⚠️ THE HOLIDAY ROW'S PLACE IS HELD FROM THE FIRST PAINT. Its real button arrives
    // after a read; prepended then, it pushed every row down under a finger already on
    // its way to «App language», and the tap landed on the holiday instead. Found by
    // the driven run, where the Italian owner's rows were read before it had arrived.
    awayRow = item(t('away.title'), t('settings.away.sub'), () => {});
    awayRow.disabled = true;

    // Three cards, by WHO a row is about (Federico, 28 Sep 2026: «migliora la UX di
    // tutte le impostazioni»): you, the venue, your account.
    scroll.append(...[
      section(t('settings.home.you'), [awayRow]),
      section(t('settings.home.venue'), [
        // ⚠️ OWNER AND MANAGER, which includes a head chef — Federico's rule: everybody
        // else uses the app's language and cannot change it.
        session.canManage ? item(t('lang.title'), t('lang.intro'), async () => {
          const { openLanguage } = await import('./staff/language.js');
          openLanguage(session);
        }) : null,
        // ⚠️ OWNER AND MANAGER — who decides which cards the employees see. The server
        // refuses everybody else too (setStaffCard).
        session.canManage ? item(t('homeCards.title'), t('homeCards.intro'), async () => {
          const { openHomeCards } = await import('./staff/home-cards-screen.js');
          openHomeCards(session);
        }) : null,
        // ⚠️ OWNERS ONLY. Hiring is the one power a manager does not have, and drawing
        // this for them would be an invitation to a screen where every button is refused.
        // The whole session goes in: an invitation that does not say where it lets
        // somebody in reads exactly like a scam.
        session.isOwner ? item(t('people.title'), t('settings.people.sub'), async () => {
          const { openPeople } = await import('./staff/people.js');
          openPeople(session);
        }) : null,
      ]),
      // ⚠️ FOR SOMEBODY WITH VENUES BUT NO BACK OFFICE. With exactly two venues it jumps
      // STRAIGHT to the other one; with more, it forgets the remembered one so the
      // reload comes back to the picker. The app's administrator steps up with the
      // header arrow instead.
      section(t('settings.home.account'), [
        !session.isAppAdmin && options.length > 1 ? item(t('home.switch'), t('settings.switch.sub'), switchVenue) : null,
      ]),
      section(t('settings.home.app'), [versionRow()]),
    ].filter(Boolean));

    // Log out: the quiet destructive action at the foot, never a row (P20).
    const logout = node('button', 'set-danger', t('auth.logOut'));
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('auth.logOut.title'),
        message: t('auth.logOut.message'),
        okLabel: t('auth.logOut'),
        cancelLabel: t('ui.cancel'),
        danger: true,
      });
      if (ok && await mayLeaveWithUnsent(confirmDialog)) signOutNow();
    });
    scroll.append(logout);
  }

  async function switchVenue() {
    const other = options.filter(id => id !== session.locationId);
    const names = session.optionNames || {};
    const cleared = t('home.switch.cleared');
    const ok = await confirmDialog({
      title: t('home.switch.title'),
      message: other.length === 1
        ? `${t('home.switch.toOne', { other: names[other[0]] || other[0], here: session.name })}\n\n${cleared}`
        : `${t('home.switch.toMany')}\n\n${cleared}`,
      okLabel: t('home.switch.ok'),
      cancelLabel: t('ui.cancel'),
    });
    if (!ok) return;
    // Switching clears this phone's offline copy, and a change still waiting for
    // signal is waiting in it.
    if (!await mayLeaveWithUnsent(confirmDialog)) return;
    if (other.length === 1) switchLocation(other[0]);
    else forgetLocation();
  }

  // ── The holiday row ─────────────────────────────────────────────────────────
  //
  // ⚠️ OFFERED TO EVERYBODY, not only to managers: an employee's phone rings too.
  // It arrives after the rest (it reads the person's own holiday first), so it puts
  // itself FIRST when it lands rather than holding the screen up. The button is
  // js/away-screen.js's own — its click, its dialogs, its write — dressed as a row.
  let awayRow = null;
  let awaySeq = 0;
  async function addAway() {
    const mine = ++awaySeq;
    const btn = await buildAwayButton();
    if (mine !== awaySeq || !overlay.isConnected) return;
    // Nobody signed in to be on holiday: the held place is given back.
    if (!btn) { (awayRow?.closest('.set-section') || awayRow)?.remove(); awayRow = null; return; }
    const away = btn.classList.contains('session-away');
    const label = btn.textContent;
    btn.className = `set-row set-door${away ? ' set-row--away' : ''}`;
    rowText(btn, label, t('settings.away.sub'));
    // IN PLACE — the row takes the slot it was holding, so nothing below it moves.
    if (awayRow?.isConnected) awayRow.replaceWith(btn);
    else scroll.prepend(section(t('settings.home.you'), [btn]));
    awayRow = btn;
  }
  const onAwayChanged = () => {
    addAway().catch(err => console.warn('The holiday row is not available:', err));
  };

  // ── The App version row ─────────────────────────────────────────────────────
  //
  // Each device answers for itself — the app records no version on the server (P8).
  // It is a plain row, not a door: it opens nothing. The state is read from this
  // device's own service worker and registration, then a fresh check is started so
  // a release that landed a minute ago shows up without leaving the screen.
  let versionCleanup = () => {};
  function versionRow() {
    const sub = node('span', 'set-sub');
    sub.setAttribute('aria-live', 'polite');
    const text = node('span', 'set-text');
    text.append(node('span', 'set-title', t('settings.app.title')), sub);
    const row = node('div', 'set-row');
    row.append(text);

    let version;          // undefined = still asking
    let waiting = false;
    let action = null;

    function paintVersion() {
      const state = versionState({ version, waiting });
      const number = versionNumber(version) || '—';
      const phrase = {
        checking: t('settings.app.checking', { n: number }),
        unknown: t('settings.app.unknown'),
        waiting: t('settings.app.waiting', { n: number }),
        current: t('settings.app.current', { n: number }),
      }[state];
      sub.textContent = phrase;
      if (state === 'waiting' && !action) {
        action = node('button', 'btn-primary set-action', t('settings.app.update'));
        action.type = 'button';
        action.addEventListener('click', async () => {
          const { updateNow } = await import('./sw-update.js');
          updateNow(action);
        });
        row.append(action);
      } else if (state !== 'waiting' && action) {
        action.remove();
        action = null;
      }
    }

    paintVersion();

    const watched = [];
    versionCleanup();
    versionCleanup = () => {
      for (const [target, type, fn] of watched) target.removeEventListener(type, fn);
      watched.length = 0;
    };
    const listen = (target, type, fn) => { target.addEventListener(type, fn); watched.push([target, type, fn]); };

    (async () => {
      const { askRunningVersion } = await import('./sw-update.js');
      version = await askRunningVersion();
      const reg = ('serviceWorker' in navigator)
        ? await navigator.serviceWorker.getRegistration().catch(() => null) : null;
      if (!overlay.isConnected) return;
      // A waiting worker only counts when this page is controlled by an older one.
      const controlled = () => !!navigator.serviceWorker?.controller;
      waiting = !!(reg && reg.waiting && controlled());
      paintVersion();
      if (!reg) return;

      const markWaiting = () => {
        if (!overlay.isConnected || !controlled()) return;
        waiting = true;
        paintVersion();
      };
      const watch = worker => {
        if (!worker) return;
        const onState = () => { if (worker.state === 'installed') markWaiting(); };
        listen(worker, 'statechange', onState);
        onState();
      };
      listen(reg, 'updatefound', () => watch(reg.installing));
      watch(reg.installing);
      reg.update().catch(() => {});
    })().catch(err => console.warn('The app version is not available:', err));

    return row;
  }

  function close() {
    window.removeEventListener('away-changed', onAwayChanged);
    versionCleanup();
    overlay.remove();
  }

  paint();
  window.addEventListener('away-changed', onAwayChanged);
  onAwayChanged();
  document.body.appendChild(overlay);
  return { close };
}
