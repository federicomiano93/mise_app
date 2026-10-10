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
import { confirmDialog, alertDialog } from './confirm-dialog.js';
import {
  KIOSK_STORAGE_KEY, REST_MINUTES_CHOICES, NIGHT_HOURS_CHOICES,
  readKioskSettings, serializeKioskSettings,
} from './kiosk-model.js';
import { signOutNow, switchLocation, forgetLocation } from './firebase.js';
import { mayLeaveWithUnsent } from './unsent-guard.js';
import { buildAwayButton } from './away-screen.js';
import { versionNumber, versionState, askVersionOf } from './app-version.js';

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

// A card of rows under one title. A card with no rows is not drawn. `headExtra` sits on
// the title line (the kiosk card's one «Saved ✓»).
function section(title, rows, headExtra = null) {
  const inner = rows.filter(Boolean);
  if (!inner.length) return null;
  const card = node('section', 'set-section');
  const head = node('div', 'set-head');
  head.append(node('h3', '', title));
  if (headExtra) head.append(headExtra);
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
      // «This device»: what is true of THIS tablet or phone, not of a person or a venue.
      section(t('settings.home.device'), [versionRow(), ...kioskRows()], kioskSaved),
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
    // ⚠️ The row is as tall as it will be WITH its button from the first paint, so the
    // button arriving late does not push «Log out» under a finger.
    const row = node('div', 'set-row set-row--version');
    row.append(text);

    let version;          // undefined = still asking
    let waiting = false;
    let phase = 'checking';
    let action = null;

    function paintVersion() {
      const state = versionState({ version, waiting, phase });
      const number = versionNumber(version) || '—';
      const phrase = {
        checking: t('settings.app.checking', { n: number }),
        downloading: t('settings.app.downloading', { n: number }),
        failed: t('settings.app.failed', { n: number }),
        unknown: t('settings.app.unknown'),
        waiting: t('settings.app.waiting', { n: number }),
        current: t('settings.app.current', { n: number }),
      }[state];
      sub.textContent = phrase;
      if (state === 'waiting' && !action) {
        action = node('button', 'btn-primary set-action', t('settings.app.update'));
        action.type = 'button';
        action.addEventListener('click', async () => {
          if (action.disabled) return;
          action.disabled = true;   // before the import: a second tap must find it off
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

    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    // A waiting worker only counts when this page is controlled by an older one.
    const controlled = () => !!sw?.controller;
    const alive = () => overlay.isConnected;

    const markWaiting = () => {
      if (!alive() || !controlled()) return;
      waiting = true;
      phase = 'done';
      paintVersion();
    };
    const watch = worker => {
      if (!worker) return;
      const onState = () => {
        if (!alive()) return;
        if (worker.state === 'installed') markWaiting();
        else if (worker.state === 'redundant') { phase = 'failed'; paintVersion(); }
      };
      listen(worker, 'statechange', onState);
      if (worker.state === 'installed') onState();
    };

    (async () => {
      if (!sw) { version = null; phase = 'done'; paintVersion(); return; }
      version = await askVersionOf(sw.controller);
      const reg = await sw.getRegistration().catch(() => null);
      if (!alive()) return;
      if (!reg) { phase = 'done'; paintVersion(); return; }
      listen(reg, 'updatefound', () => {
        if (!alive() || !reg.installing) return;
        phase = 'downloading';
        paintVersion();
        watch(reg.installing);
      });
      // The first visit: once the worker claims the page, ask again.
      listen(sw, 'controllerchange', async () => {
        version = await askVersionOf(sw.controller);
        if (alive()) paintVersion();
      });
      if (reg.waiting && controlled()) { markWaiting(); return; }
      paintVersion();
      try {
        await reg.update();
      } catch {
        if (alive() && !waiting) { phase = 'failed'; paintVersion(); }
        return;
      }
      if (!alive() || waiting) return;
      if (reg.installing) {
        phase = 'downloading';
        paintVersion();
        watch(reg.installing);
      } else if (reg.waiting && controlled()) {
        markWaiting();
      } else {
        phase = 'done';
        paintVersion();
      }
    })().catch(err => console.warn('The app version is not available:', err));

    return row;
  }

  // ── Kiosk mode (this device only) ───────────────────────────────────────────
  //
  // EVERYBODY CAN CHANGE IT (Federico, 7 Oct 2026): the lab tablet signs in with an employee
  // account, and it is the people at that tablet who must be able to switch kiosk mode on
  // or off (first read-only for employees, 5 Oct 2026). Stored in THIS device's
  // localStorage (js/kiosk-model.js), never in Firestore; js/kiosk.js listens for the
  // event below and switches on or off at once. A switch or single choice saves on the
  // tap with «Saved ✓»; the two choices appear and vanish in place (hidden), so the rows
  // above never move.
  //
  // ⚠️ ONE «Saved ✓», ON THE CARD'S TITLE LINE. Placed in a row or beside a choice's label it
  // covered «Tablet del laboratorio» and «Spegni lo schermo dopo» at 296px (measured, 4 Oct
  // 2026), and in the flow it would make the row taller for two seconds under a moving
  // finger. The title line has free room on the right in both languages.
  let kioskSaved = null;
  function kioskRows() {
    const read = () => { try { return localStorage.getItem(KIOSK_STORAGE_KEY); } catch { return null; } };
    // False when the device refused the write; the caller puts its control back.
    function store(change) {
      try {
        localStorage.setItem(KIOSK_STORAGE_KEY, serializeKioskSettings(read(), change));
      } catch {
        alertDialog(t('kiosk.settings.notSaved'));
        return false;
      }
      window.dispatchEvent(new Event('kiosk-settings-changed'));
      return true;
    }
    kioskSaved = node('span', 'set-saved', t('settings.saved'));
    kioskSaved.setAttribute('role', 'status');
    kioskSaved.hidden = true;
    let savedTimer = null;
    const flash = () => {
      kioskSaved.hidden = false;
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { kioskSaved.hidden = true; }, 2000);
    };

    const current = readKioskSettings(read());

    // The switch row.
    const cb = node('input');
    cb.type = 'checkbox';
    cb.setAttribute('role', 'switch');
    cb.setAttribute('aria-label', t('kiosk.settings.title'));
    cb.checked = current.enabled;
    const text = node('span', 'set-text');
    text.append(node('span', 'set-title', t('kiosk.settings.title')), node('span', 'set-sub', t('kiosk.settings.sub')));
    const track = node('span', 'set-switch-track');
    track.setAttribute('aria-hidden', 'true');
    const switchLabel = node('label', 'set-switch');
    switchLabel.append(cb, track);
    const switchRow = node('div', 'set-row');
    switchRow.append(text, switchLabel);

    // The two choices and the note, one wrapper so they show and hide together.
    const details = node('div');
    details.hidden = !current.enabled;

    function choice(labelKey, subKey, field, options, labelOf) {
      const block = node('div', 'set-block');
      const label = node('p', 'set-label', t(labelKey));
      block.append(label);
      if (subKey) block.append(node('span', 'set-sub', t(subKey)));
      const seg = node('div', 'set-seg');
      seg.setAttribute('role', 'group');
      seg.setAttribute('aria-label', t(labelKey));
      const buttons = options.map(value => {
        const btn = node('button', 'set-seg-btn', labelOf(value));
        btn.type = 'button';
        btn.dataset.value = String(value);
        btn.addEventListener('click', () => {
          const was = readKioskSettings(read())[field];
          if (was === value) return;
          if (!store({ [field]: value })) return;
          paint(value);
          flash();
        });
        seg.append(btn);
        return btn;
      });
      const paint = value => buttons.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === String(value))));
      paint(current[field]);
      block.append(seg);
      return block;
    }

    details.append(
      choice('kiosk.settings.dimAfter', null, 'restMinutes', REST_MINUTES_CHOICES,
        n => t('kiosk.settings.minutes', { n })),
      choice('kiosk.settings.offAfter', 'kiosk.settings.offAfter.sub', 'nightHours', NIGHT_HOURS_CHOICES,
        n => (n === 0 ? t('kiosk.settings.never') : t('kiosk.settings.hours', { n }))),
    );
    // The note tells whoever SETS the tablet up what to do in Android — everybody may.
    const noteBlock = node('div', 'set-block');
    noteBlock.append(node('p', 'set-note', t('kiosk.settings.note')));
    details.append(noteBlock);

    cb.addEventListener('change', () => {
      const wanted = cb.checked;
      if (!store({ enabled: wanted })) { cb.checked = !wanted; return; }
      details.hidden = !wanted;
      flash();
    });

    return [switchRow, details];
  }

  function close() {
    window.removeEventListener('away-changed', onAwayChanged);
    versionCleanup();
    overlay.remove();
    globalThis.window?.dispatchEvent(new CustomEvent('mise:screen', { detail: '' }));
  }

  paint();
  window.addEventListener('away-changed', onAwayChanged);
  onAwayChanged();
  document.body.appendChild(overlay);
  globalThis.window?.dispatchEvent(new CustomEvent('mise:screen', { detail: 'settings' }));
  return { close };
}
