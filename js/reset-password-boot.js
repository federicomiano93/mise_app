// reset-password-boot.js — what reset-password.html loads, instead of the page's real script.
//
// ⚠️ WHY A SECOND, TINY FILE. js/reset-password.js imports the dictionary, credentials.js and
// (through start) firebase.js. A phone whose installed app is older than this page serves those
// three from its OLD precache — no `reset.*` words, no confirmProblem, no checkResetCode —
// while reset-password.html itself, absent from that old precache, comes fresh from the network.
// A static import of a name the old file does not export fails the whole module, and the person
// who just tapped «reset my password» met a blank page. This file imports nothing that can be
// out of date but firebase-target.js's long-standing configForHost, draws the card at once, and
// loads the real script dynamically.
//
// ⚠️ WHEN A PASSWORD RESET FAILS HERE, THE LINK IS NOT HANDED TO FIREBASE'S OWN PAGE. That page
// (<authDomain>/__/auth/action) calls the API with the production key, which is restricted by
// HTTP referrer to github.io + localhost; Google answers «Requests from referer <the auth
// domain> are blocked». So the person is told, in the card,
// the one thing that fixes it: update the app and tap the link again. Every email action that is
// NOT a password reset (verifyEmail, …) is still forwarded — nothing of ours handles those.
//
// ⚠️ ITS SENTENCES ARE A TABLE OF ITS OWN, not t(): the dictionary it may be running beside is
// the old one. tests/reset-password.test.mjs pins them word for word to the dictionary. Nothing
// here is logged, and the query string (it carries the one-time code) goes nowhere but to
// Firebase's own address, and only for the modes above.

import { configForHost } from './firebase-target.js';

const WORDS = {
  en: {
    checking: 'Checking your link…',
    broken: 'Something went wrong opening this page. Please try again in a moment.',
    needsUpdate: 'This link needs the latest version of Mise. Open the Mise app, tap “Update now” if it appears, then tap the link in the email again.',
  },
  it: {
    checking: 'Controllo del link…',
    broken: 'Qualcosa è andato storto aprendo questa pagina. Riprova tra un momento.',
    needsUpdate: 'Questo link richiede la versione più recente di Mise. Apri l’app Mise, tocca “Aggiorna ora” se compare, poi tocca di nuovo il link nell’email.',
  },
};

// The same four names js/firebase.js sends to the emulator. There is no hosted handler there.
const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'];

export function languageOf(tag) {
  const base = String(tag || '').toLowerCase().split('-')[0];
  return WORDS[base] ? base : 'en';
}

export function wordsFor(tag) {
  return WORDS[languageOf(tag)];
}

// Firebase's default handler, with the query string the link already had — or null where no
// such page exists (the local emulator). `search` keeps its leading «?». Used for the modes
// that are not a password reset only.
export function forwardUrl(hostname, search) {
  if (LOCAL.includes(String(hostname || '').toLowerCase())) return null;
  return 'https://' + configForHost(hostname).authDomain + '/__/auth/action' + String(search || '');
}

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function draw(doc, nodes) {
  const root = doc.getElementById('auth-gate');
  if (!root) return;
  const card = element(doc, 'div', 'auth-card', null);
  card.appendChild(element(doc, 'h1', 'auth-title', 'Mise'));
  nodes.forEach(node => card.appendChild(node));
  root.textContent = '';
  root.appendChild(card);
}

// A screen reader reads the page in the page's language: say which one the first text is in.
function setPageLanguage(doc, tag) {
  if (doc.documentElement) doc.documentElement.lang = languageOf(tag);
}

// A sentence that takes the cursor: tabindex -1 so focus() works on a paragraph.
function drawAlert(doc, text) {
  const node = element(doc, 'p', 'auth-status auth-status--bad', text);
  node.setAttribute('role', 'alert');
  node.setAttribute('tabindex', '-1');
  draw(doc, [node]);
  if (typeof node.focus === 'function') node.focus();
}

// The message for «this page cannot run on the files this phone has». It must never throw — it
// is also the last resort when everything else has.
export function showNeedsUpdate(doc, nav) {
  try {
    setPageLanguage(doc, nav && nav.language);
    drawAlert(doc, wordsFor(nav && nav.language).needsUpdate);
  } catch { /* nothing left to try */ }
}

export async function boot({ doc, loc, nav, load = () => import('./reset-password.js') }) {
  const tag = nav && nav.language;
  const words = wordsFor(tag);
  setPageLanguage(doc, tag);
  const checking = element(doc, 'p', 'auth-sub', words.checking);
  checking.setAttribute('role', 'status');
  draw(doc, [checking]);

  const mode = new URLSearchParams(String(loc.search || '')).get('mode') || '';
  if (mode && mode !== 'resetPassword') {
    const url = forwardUrl(loc.hostname, loc.search);
    if (url) { loc.replace(url); return; }
    drawAlert(doc, words.broken);
    return;
  }

  try {
    const page = await load();
    await page.start();
  } catch {
    showNeedsUpdate(doc, nav);
  }
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  boot({ doc: document, loc: location, nav: navigator })
    .catch(() => showNeedsUpdate(document, navigator));
}
