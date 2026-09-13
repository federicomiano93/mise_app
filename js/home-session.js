// home-session.js — the Home screen's session strip, and the card filter.
//
// Two jobs:
//   1. Say WHICH LOCATION you are working on, always, in words. With more than
//      one location, placing an order for the wrong one is the worst mistake
//      this app can let a person make, and it is invisible until the delivery
//      turns up somewhere else.
//   2. Show only the cards that location uses. The rules refuse the rest
//      anyway; this is so nobody taps into a screen that will only ever show
//      permission errors.
//
// ⚠️ THE BOTTOM OF THE HOME IS ONE BUTTON, «Settings». Federico, 13 Sep 2026: «io
// metterei solo un tasto settings perche' senno' diventano troppe scritte in fondo alla
// pagina». Holiday, App language, Home cards, Who can get in, Switch location and Log
// out are rows of js/home-settings.js now, each behind exactly the gate it had here.
// A holiday is shown at the TOP instead, and reminded once a day (js/home-away.js).

import { t } from './i18n.js';
import { onSession, openVenuePicker } from './firebase.js';
import { sectionsFor, hasLevelAbove } from './sections.js';
import { cardVisibleTo } from './home-cards.js';
import { refreshAway, wireAwayReminder } from './home-away.js';

const logoutHost = document.getElementById('session-logout-host');
const upBtn = document.getElementById('home-up-btn');

const SVG_NS = 'http://www.w3.org/2000/svg';

// Hide the cards this location does not use. The cards are static HTML with a
// data-section, so this only ever REMOVES — a location with everything on gets
// the markup exactly as written.
function filterCards({ location, role, canManage }) {
  // ⚠️ THE ROLE NARROWS THIS TOO, so a card is not drawn for a screen the person
  // would be refused on. It is still only courtesy — the rules refuse the data
  // itself — but a card that opens onto permission errors teaches people the app
  // is broken rather than that they lack the permission.
  const allowed = sectionsFor(location, role);
  document.querySelectorAll('.home-card[data-section]').forEach(card => {
    if (allowed[card.dataset.section] === false) card.remove();
    // ⚠️ A THIRD, PURELY VISUAL LAYER: the cards the venue chose to hide from its
    // employees (js/home-cards.js). It can only remove more, never bring back a
    // card either check above removed — and it never removes one from an owner, a
    // manager or a head chef.
    else if (!cardVisibleTo(location, canManage, card.dataset.card)) card.remove();
  });
}

// The gear, built as nodes — the same drawing as the Settings button at the bottom
// of Orders, so the app has one picture for «Settings».
function gearIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  const attrs = {
    viewBox: '0 0 24 24', width: '20', height: '20', fill: 'none', stroke: 'currentColor',
    'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('cx', '12');
  circle.setAttribute('cy', '12');
  circle.setAttribute('r', '3');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z');
  svg.append(circle, path);
  return svg;
}

// The bottom of the Home, after the cards: the app's bottom-bar button, «Settings».
//
// ⚠️ "Back to Misé" and "Businesses" are deliberately NOT behind it either. The header
// arrow steps up to them (renderUpArrow below) — this bar belongs to ONE customer's
// venue, and the app's own customer list is not a drawer inside it.
function renderSessionActions(session) {
  if (!logoutHost) return;
  logoutHost.textContent = '';

  const label = document.createElement('span');
  label.textContent = t('ui.settings');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'recipe-footer-btn';
  btn.append(gearIcon(), label);
  btn.addEventListener('click', async () => {
    const { openHomeSettings } = await import('./home-settings.js');
    openHomeSettings(session);
  });

  const bar = document.createElement('div');
  bar.className = 'recipe-footer';
  bar.appendChild(btn);
  logoutHost.appendChild(bar);
  // ⚠️ AND NOTHING ELSE, EVER — not even a holiday (Federico: «voglio solo un tasto
  // impostazioni»). Being away is a band at the TOP of the Home: js/home-away.js.
}

// The way up, in the header. Revealed rather than built, so it can appear the moment
// the session says there is a level above without a repaint of anything else.
//
// ⚠️ ONLY WHERE THERE IS SOMEWHERE TO GO. hasLevelAbove() is the whole guard: an
// employee with one venue has no "all my businesses" screen, and an arrow leading to
// a list of one is a control that appears to be broken.
function renderUpArrow(session) {
  if (!upBtn) return;
  const show = hasLevelAbove({ isAppAdmin: session.isAppAdmin, options: session.options });
  upBtn.hidden = !show;
  if (show && !upBtn.dataset.wired) {
    upBtn.dataset.wired = '1';
    // ⚠️ NO CONFIRMATION, and that is checked rather than assumed: stepping UP clears
    // nothing. The local cache is only wiped when a DIFFERENT venue is entered, which
    // enterLocation decides for itself. "Switch location" warns because it really does
    // clear; warning here would teach people to tap through a dialog that never means
    // anything, which is how the one that matters stops being read.
    upBtn.addEventListener('click', () => openVenuePicker());
  }
}

let currentSessionForStrip = null;

onSession(session => {
  if (session.status !== 'ready') return;
  currentSessionForStrip = session;
  filterCards(session);
  // After the filter, so a card the venue removed is never listened to.
  wireAwayReminder();
  refreshAway();
  renderUpArrow(session);
  renderSessionActions(session);
});

// ⚠️ THE BAND IS RE-READ, NOT PATCHED, when the holiday changes. Its words are derived
// from the stored date, so editing the label by hand is how a screen ends up saying
// "On holiday until Friday" about a holiday that was just cancelled.
window.addEventListener('away-changed', () => {
  if (currentSessionForStrip) refreshAway();
});
