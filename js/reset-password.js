// reset-password.js — the page «Forgot your password?» lands on (reset-password.html).
//
// Firebase's own hosted page has one password box and a six-character floor. This page asks
// for the new password TWICE and applies the app's own rules (js/credentials.js), the same
// ones the invitation form uses.
//
// ⚠️ THE CUSTOM ACTION URL IS USED FOR EVERY EMAIL FIREBASE SENDS, not only password resets:
// the console has one «Customize action URL» for all of them, and Firebase appends
// `?mode=…&oobCode=…&apiKey=…&lang=…` to it. The app sends no other kind today, but a
// verification or email-change link must not dead-end here, so anything that is not
// `resetPassword` is handed on to Firebase's default handler with the same query string.
//
// ⚠️ THE CODE AND THE EMAIL NEVER LEAVE THIS PAGE: not into a URL we navigate to (the forward
// above is Firebase's own address and carries the query string it already had), not into a
// log (P17). Nothing here signs anybody in — confirmPasswordReset does not, and that stays.
//
// The pure helpers are exported for tests/reset-password.test.mjs; the page only starts when
// there is a document, and Firebase is loaded only then (a dynamic import), so Node can import
// this file.

import { t, setLanguage, languageFromTag, LANGUAGES } from './i18n.js';
import { passwordProblem, confirmProblem, MIN_PASSWORD_LENGTH } from './credentials.js';

// What the link carries. `lang` is Firebase's own tag for the language the email was written
// in; it is used only when it is one the app speaks.
export function readAction(search) {
  const params = new URLSearchParams(String(search || ''));
  return {
    mode: params.get('mode') || '',
    code: params.get('oobCode') || '',
    lang: params.get('lang') || '',
  };
}

// The interface language: the link's, when supported, else the phone's — the same guess the
// sign-in screen makes, because nobody is inside a venue yet.
export function pickLanguage(lang, phoneTag) {
  const base = String(lang || '').toLowerCase().split('-')[0];
  return LANGUAGES.includes(base) ? base : languageFromTag(phoneTag);
}

// Firebase's default handler for an action this page does not own. `search` keeps its leading
// «?», exactly as location.search has it.
export function forwardUrl(authDomain, search) {
  return 'https://' + authDomain + '/__/auth/action' + String(search || '');
}

// Which sentence a Firebase error code gets. The weak-password one is the app's own
// «make it longer» message, since the server's floor is lower than the app's.
export function errorKeyFor(code) {
  switch (code) {
    case 'auth/expired-action-code':
    case 'auth/invalid-action-code':
      return 'reset.badLink';
    case 'auth/user-disabled':
    case 'auth/user-not-found':
      return 'reset.inactive';
    case 'auth/weak-password':
      return 'help.passwordTooShort';
    default:
      return 'reset.failed';
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function field(form, id, labelText, input) {
  const label = el('label', 'auth-label', labelText);
  label.htmlFor = id;
  input.id = id;
  form.append(label, input);
}

function passwordBox(id) {
  const input = el('input', 'auth-input');
  input.type = 'password';
  input.autocomplete = 'new-password';
  input.id = id;
  return input;
}

function openMiseLink(text, primary) {
  const link = el('a', primary ? 'auth-btn auth-btn-link' : 'auth-link', text);
  link.href = 'index.html';
  return link;
}

async function start() {
  const root = document.getElementById('auth-gate');
  const { mode, code, lang } = readAction(location.search);
  setLanguage(pickLanguage(lang, navigator.language));

  const fb = await import('./firebase.js');

  if (mode && mode !== 'resetPassword') {
    location.replace(forwardUrl(fb.firebaseConfig.authDomain, location.search));
    return;
  }

  if (fb.isPreview) {
    const { showPreviewRibbon } = await import('./preview-ribbon.js');
    showPreviewRibbon();
  }

  const card = el('div', 'auth-card');
  card.append(el('h1', 'auth-title', 'Mise'));
  root.append(card);

  // The «link not valid» state: the sentence and the way back to the sign-in page.
  const showBadLink = () => {
    card.textContent = '';
    card.append(el('h1', 'auth-title', 'Mise'));
    const status = el('p', 'auth-status auth-status--bad', t('reset.badLink'));
    status.setAttribute('role', 'alert');
    card.append(status, openMiseLink(t('auth.signIn'), false));
  };

  if (!code) { showBadLink(); return; }

  const checking = el('p', 'auth-sub', t('reset.checking'));
  card.append(checking);

  let email;
  try {
    email = await fb.checkResetCode(code);
  } catch (err) {
    const key = errorKeyFor(err && err.code);
    if (key === 'reset.badLink') { showBadLink(); return; }
    checking.remove();
    const failure = el('p', 'auth-status auth-status--bad',
      t(key === 'help.passwordTooShort' ? 'reset.failed' : key));
    failure.setAttribute('role', 'alert');
    card.append(failure, openMiseLink(t('auth.signIn'), false));
    return;
  }

  card.textContent = '';
  card.append(el('h1', 'auth-title', t('reset.title')));
  card.append(el('p', 'auth-sub', t('reset.for', { email })));

  const form = el('form', 'auth-form');
  form.noValidate = true;

  // The account's email, out of sight, so a password manager saves the new password under the
  // right username. Not focusable and hidden from assistive technology: it says nothing the
  // «For {email}» line above has not.
  const username = el('input', 'auth-hidden-username');
  username.type = 'text';
  username.autocomplete = 'username';
  username.value = email;
  username.readOnly = true;
  username.tabIndex = -1;
  username.setAttribute('aria-hidden', 'true');
  form.append(username);

  const password = passwordBox('reset-password');
  const password2 = passwordBox('reset-password2');
  field(form, 'reset-password', t('join.choosePassword', { n: MIN_PASSWORD_LENGTH }), password);
  field(form, 'reset-password2', t('join.repeatPassword'), password2);

  const submit = el('button', 'auth-btn', t('reset.save'));
  submit.type = 'submit';
  const status = el('p', 'auth-status');
  status.setAttribute('role', 'alert');
  form.append(submit, status);
  card.append(form);

  const setStatus = (text, kind = 'bad') => {
    status.textContent = text;
    status.className = `auth-status auth-status--${kind}`;
  };

  form.addEventListener('submit', async event => {
    event.preventDefault();
    // Every check runs before the network, and the first wrong box gets the cursor.
    const weak = passwordProblem(password.value, email);
    if (weak) { setStatus(weak); password.focus(); return; }
    const mismatch = confirmProblem(password.value, password2.value);
    if (mismatch) { setStatus(mismatch); password2.focus(); return; }

    submit.disabled = true;
    setStatus(t('reset.saving'), 'busy');
    try {
      await fb.setNewPassword(code, password.value);
    } catch (err) {
      const key = errorKeyFor(err && err.code);
      if (key === 'reset.badLink') { showBadLink(); return; }
      setStatus(t(key, { n: MIN_PASSWORD_LENGTH }));
      submit.disabled = false;
      return;
    }
    card.textContent = '';
    card.append(el('h1', 'auth-title', 'Mise'));
    const done = el('p', 'auth-status auth-status--good', t('reset.done'));
    done.setAttribute('role', 'status');
    card.append(done, openMiseLink(t('reset.openMise'), true));
  });

  password.focus();
}

if (typeof document !== 'undefined') start();
