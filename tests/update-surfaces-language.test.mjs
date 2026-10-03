// The update banner and modal follow the venue's language, even when they were drawn
// before it arrived.
//
// WHAT IT PREVENTS, seen on the emulator (Panificio Miano, Italian, 3 Oct 2026): the
// compulsory modal said «Update the app to carry on … Update now» in English. The
// update is noticed at page load, before the session brings the venue's language, and
// the modal wrote its words once and never again.
//
// A tiny stand-in for the page: js/sw-update.js only ever looks its surfaces up by id,
// so a map of ids is all the "DOM" it needs. The surfaces are the real ones' ids.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const byId = new Map();
function surface(id, extra = {}) {
  const el = { id, textContent: '', disabled: false, dataset: {}, ...extra };
  byId.set(id, el);
  return el;
}

let paintWords;
let setLanguage;

before(async () => {
  globalThis.document = { getElementById: id => byId.get(id) ?? null };
  ({ setLanguage } = await import('../js/i18n.js'));
  ({ paintWords } = await import('../js/sw-update.js'));
});

function reset() {
  byId.clear();
  setLanguage('en');
}

test('⚠️ a modal drawn in English turns Italian when the venue language arrives', () => {
  reset();
  const title = surface('sw-update-gate-title');
  const msg = surface('sw-update-gate-msg');
  const go = surface('sw-update-gate-go');
  surface('sw-update-gate');
  paintWords();
  assert.equal(title.textContent, 'Update the app to carry on');
  assert.equal(go.textContent, 'Update now');

  setLanguage('it');   // what js/firebase.js does once the venue is open
  assert.equal(title.textContent, 'Aggiorna l’app per continuare');
  assert.equal(go.textContent, 'Aggiorna ora');
  assert.equal(msg.textContent, 'Una nuova versione è pronta e ci mette un momento a installarsi. Quello che hai scritto è già salvato.');
});

test('the banner follows the language too', () => {
  reset();
  const banner = surface('sw-update-banner');
  paintWords();
  assert.equal(banner.textContent, 'New version available — tap to update');
  setLanguage('it');
  assert.equal(banner.textContent, 'Nuova versione disponibile — tocca per aggiornare');
});

test('the modal after two failed attempts keeps its own words, with its quiet way out', () => {
  reset();
  surface('sw-update-gate', { dataset: { escape: 'yes' } });
  const go = surface('sw-update-gate-go');
  const carryOn = surface('sw-update-gate-carry-on');
  setLanguage('it');
  paintWords();
  assert.equal(go.textContent, 'Riprova');
  assert.equal(carryOn.textContent, 'Continua senza aggiornare');
});

test('a button already updating keeps saying so in the new language', () => {
  reset();
  surface('sw-update-gate');
  const go = surface('sw-update-gate-go', { disabled: true });
  paintWords();
  assert.equal(go.textContent, 'Updating…');
  setLanguage('it');
  assert.equal(go.textContent, 'Aggiornamento…');
});

test('no surface on the page: nothing happens, nothing throws', () => {
  reset();
  assert.doesNotThrow(() => paintWords());
  assert.doesNotThrow(() => setLanguage('it'));
});

test('a banner already updating keeps saying so in the new language', () => {
  reset();
  const banner = surface('sw-update-banner', { disabled: true });
  paintWords();
  assert.equal(banner.textContent, 'Updating…');
  setLanguage('it');
  assert.equal(banner.textContent, 'Aggiornamento…');
});

// ⚠️ The surfaces no longer carry words when they are built: paintWords() writes them.
// On a phone whose language already matches the venue's, no language change ever comes,
// so without these two calls the compulsory modal would appear EMPTY — a screen with no
// title and a blank button that cannot be dismissed. The tests above call paintWords()
// directly and would stay green, so the calls themselves are pinned here.
test('⚠️ both surfaces write their words the moment they appear', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../js/sw-update.js', import.meta.url), 'utf8');
  assert.match(src, /document\.body\.appendChild\(host\);\s*\r?\n\s*keepAboveBottomBar\(host\);\s*\r?\n\s*paintWords\(\);/,
    'showBanner must call paintWords() right after placing the banner');
  assert.match(src, /document\.body\.appendChild\(gate\);\s*\r?\n\s*paintWords\(\);\s*\r?\n\s*updateBtn\.focus\(\);/,
    'showGate must call paintWords() before focusing the button');
});
