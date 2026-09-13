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
import { buildAwayButton } from './away-screen.js';

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

// One row: what it is, and one sentence saying what is behind it. The same shape as
// the Calculator's Settings hub (.settings-menu-btn), so the app has one kind of menu.
function item(title, sub, onClick) {
  const btn = node('button', 'settings-menu-btn');
  btn.type = 'button';
  btn.append(node('span', 'settings-menu-title', title), node('span', 'settings-menu-sub', sub));
  btn.addEventListener('click', onClick);
  return btn;
}

export function openHomeSettings(session) {
  const options = session.options || [];

  const back = node('button', 'orders-icon-btn');
  back.type = 'button';
  back.setAttribute('aria-label', t('auth.back'));
  back.appendChild(backIcon());
  back.addEventListener('click', close);

  const titleWrap = node('div', 'orders-header-title');
  titleWrap.appendChild(node('h1', '', t('ui.settings')));
  const spacer = node('span');
  spacer.style.width = '36px';
  spacer.style.flexShrink = '0';

  const header = node('header', 'orders-header');
  header.append(back, titleWrap, spacer);

  const scroll = node('div', 'people-scroll');
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
    scroll.append(awayRow);

    // ⚠️ OWNER AND MANAGER, which includes a head chef — Federico's rule: everybody
    // else uses the app's language and cannot change it.
    if (session.canManage) {
      scroll.append(item(t('lang.title'), t('lang.intro'), async () => {
        const { openLanguage } = await import('./staff/language.js');
        openLanguage(session);
      }));
    }

    // ⚠️ OWNER AND MANAGER — who decides which cards the employees see. The server
    // refuses everybody else too (setStaffCard).
    if (session.canManage) {
      scroll.append(item(t('homeCards.title'), t('homeCards.intro'), async () => {
        const { openHomeCards } = await import('./staff/home-cards-screen.js');
        openHomeCards(session);
      }));
    }

    // ⚠️ OWNERS ONLY. Hiring is the one power a manager does not have, and drawing
    // this for them would be an invitation to a screen where every button is refused.
    if (session.isOwner) {
      scroll.append(item(t('people.title'), t('settings.people.sub'), async () => {
        const { openPeople } = await import('./staff/people.js');
        // The whole session: the screen needs the venue's NAME as well as who is
        // looking, because an invitation that does not say where it lets somebody
        // in reads exactly like a scam.
        openPeople(session);
      }));
    }

    // ⚠️ FOR SOMEBODY WITH VENUES BUT NO BACK OFFICE. With exactly two venues it jumps
    // STRAIGHT to the other one; with more, it forgets the remembered one so the
    // reload comes back to the picker. The app's administrator steps up with the
    // header arrow instead.
    if (!session.isAppAdmin && options.length > 1) {
      scroll.append(item(t('home.switch'), t('settings.switch.sub'), async () => {
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
        if (other.length === 1) switchLocation(other[0]);
        else forgetLocation();
      }));
    }

    const logout = node('button', 'session-logout', t('auth.logOut'));
    logout.type = 'button';
    logout.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: t('auth.logOut.title'),
        message: t('auth.logOut.message'),
        okLabel: t('auth.logOut'),
        cancelLabel: t('ui.cancel'),
        danger: true,
      });
      if (ok) signOutNow();
    });
    scroll.append(logout);
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
    if (!btn) { awayRow?.remove(); awayRow = null; return; }
    const away = btn.classList.contains('session-away');
    const label = btn.textContent;
    btn.className = `settings-menu-btn${away ? ' settings-menu-btn--away' : ''}`;
    btn.textContent = '';
    btn.append(node('span', 'settings-menu-title', label), node('span', 'settings-menu-sub', t('settings.away.sub')));
    // IN PLACE — the row takes the slot it was holding, so nothing below it moves.
    if (awayRow?.isConnected) awayRow.replaceWith(btn);
    else scroll.prepend(btn);
    awayRow = btn;
  }
  const onAwayChanged = () => {
    addAway().catch(err => console.warn('The holiday row is not available:', err));
  };

  function close() {
    window.removeEventListener('away-changed', onAwayChanged);
    overlay.remove();
  }

  paint();
  window.addEventListener('away-changed', onAwayChanged);
  onAwayChanged();
  document.body.appendChild(overlay);
  return { close };
}
