// reset-password-boot.js — what reset-password.html loads, instead of the page's real script.
//
// ⚠️ WHY A SECOND, TINY FILE. js/reset-password.js imports the dictionary, credentials.js and
// (through start) firebase.js. A phone whose installed app is older than this page serves those
// three from its OLD precache — no `reset.*` words, no confirmProblem, no checkResetCode —
// while reset-password.html itself, absent from that old precache, comes fresh from the network.
// A static import of a name the old file does not export fails the whole module, and the person
// who just tapped «reset my password» met a blank page. This file imports nothing that can be
// out of date but firebase-target.js's long-standing configForHost, draws the card at once, and
// loads the real script dynamically. Whatever then goes wrong — a failed load, a missing export,
// a missing word, a rejected start — the link is handed on to Firebase's own page, which needs no
// SDK from us and always works. The same hand-over serves every email action that is not a
// password reset.
//
// ⚠️ ITS TWO SENTENCES ARE A TABLE OF ITS OWN, not t(): the dictionary it may be running beside is
// the old one. Nothing here is logged, and the query string (it carries the one-time code) goes
// nowhere but to Firebase's own address.

import { configForHost } from './firebase-target.js';

const WORDS = {
  en: {
    checking: 'Checking your link…',
    broken: 'Something went wrong opening this page. Please try again in a moment.',
  },
  it: {
    checking: 'Controllo del link…',
    broken: 'Qualcosa è andato storto aprendo questa pagina. Riprova tra un momento.',
  },
};

// The same four names js/firebase.js sends to the emulator. There is no hosted handler there.
const LOCAL = ['localhost', '127.0.0.1', '::1', '[::1]'];

export function wordsFor(tag) {
  const base = String(tag || '').toLowerCase().split('-')[0];
  return WORDS[base] || WORDS.en;
}

// Firebase's default handler, with the query string the link already had — or null where no
// such page exists (the local emulator). `search` keeps its leading «?».
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

export async function boot({ doc, loc, nav, load = () => import('./reset-password.js') }) {
  const words = wordsFor(nav && nav.language);
  const checking = element(doc, 'p', 'auth-sub', words.checking);
  checking.setAttribute('role', 'status');
  draw(doc, [checking]);

  const forward = () => {
    const url = forwardUrl(loc.hostname, loc.search);
    if (url) { loc.replace(url); return; }
    const broken = element(doc, 'p', 'auth-status auth-status--bad', words.broken);
    broken.setAttribute('role', 'alert');
    draw(doc, [broken]);
  };

  const mode = new URLSearchParams(String(loc.search || '')).get('mode') || '';
  if (mode && mode !== 'resetPassword') { forward(); return; }

  try {
    const page = await load();
    await page.start();
  } catch {
    forward();
  }
}

if (typeof document !== 'undefined' && typeof location !== 'undefined') {
  boot({ doc: document, loc: location, nav: navigator });
}
