// The phone's half of "photograph the packet": the screen, the button that opens it,
// and the switch that decides whether the button exists at all.
//
// ⚠️⚠️ WHAT THESE GUARD IS WHAT THE SCREEN CANNOT SHOW. That the button is hidden when
// the switch is off is visible; that `packPhotoOn` is CALLED rather than read once at
// build time is not, and the difference only appears when somebody throws the switch on
// another phone. That the promise always settles is invisible until a person backs out
// and finds the button dead for the rest of the form. And that no path here writes the
// verification stamp is invisible by definition — the whole point is that it looks
// exactly like typing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { _dictionaries, DEFAULT_LANGUAGE } from '../js/i18n.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
// Comments are where this project explains itself, and they name the very things these
// tests forbid. Judge the CODE. (Three guards in this repo have gone green on their own
// warning; two of them were fixed the same day as this file was written.)
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const CAPTURE = codeOf(read('js/orders/photo-capture.js'));
const FORM = codeOf(read('js/orders/ingredient-form.js'));
const REGISTRY = codeOf(read('js/orders/registry.js'));
const FEATURES = codeOf(read('js/orders/firebase-features.js'));
const SETTINGS = codeOf(read('js/orders/registry-settings.js'));
const DATA = codeOf(read('js/orders/firebase-photo.js'));

// ── 1. It proposes; it never declares ────────────────────────────────────────

test('⚠️⚠️ nothing on the way in from a photograph writes the verification stamp', () => {
  for (const [name, src] of [['the capture screen', CAPTURE], ['the data layer', DATA]]) {
    assert.ok(!src.includes('allergensCheckedAt'),
      `${name} must never touch the stamp — a transcription is a suggestion, and a `
      + 'suggestion that stamps itself as checked is a false declaration');
  }
  // The form DOES know the stamp — it is the screen where a person sets it — so the
  // guard here is narrower: the photograph handler must not go near it.
  const start = FORM.indexOf('photoBtn.addEventListener');
  assert.notEqual(start, -1, 'the photo handler must exist to be guarded');
  const handler = FORM.slice(start, FORM.indexOf('\n  });', start));
  assert.ok(handler.length > 100, 'the slice must actually contain the handler');
  assert.ok(!/allergensCheckedAt|checked\.checked\s*=/.test(handler),
    'the photograph fills the box and nothing else: the ticks move because the TEXT '
    + 'moved, through the same suggest() a typed character goes through');
});

test('⚠️ the text goes through suggest(), and the debounce is cleared first', () => {
  assert.match(FORM, /packBox\.value = answer\.text;[\s\S]{0,400}?clearTimeout\(pending\);\s*suggest\(\);/,
    'a synthetic input event would only restart the 450ms timer, and the boxes would '
    + 'move a moment after the person had started reading them');
  assert.ok(!/dispatchEvent\(new Event\('input'/.test(FORM),
    'and it must not fake a keystroke to get there');
});

test('⚠️⚠️ replacing or keeping, and never «add to the end»', () => {
  assert.match(FORM, /if \(packBox\.value\.trim\(\)\) \{[\s\S]*?confirmDialog\(/,
    'a box that already has a list must ask before it is overwritten');
  const start = FORM.indexOf('photoBtn.addEventListener');
  const handler = FORM.slice(start, FORM.indexOf('\n  });', start));
  assert.ok(!/packBox\.value\s*\+=|`\$\{packBox\.value\}/.test(handler),
    '⚠️ two ingredient lists run together are ONE product\'s list as far as the '
    + 'matcher is concerned, and it would propose the allergens of both on a record '
    + 'that names one product');
  const dicts = _dictionaries();
  for (const lang of Object.keys(dicts)) {
    assert.ok(dicts[lang]['orders.pack.photo.keepMine'], `the second answer needs words in ${lang}`);
  }
});

test('⚠️ a truncated read is said NOW, not discovered on save', () => {
  assert.match(FORM, /notes && answer\.notes\.truncated[\s\S]{0,200}?alertDialog\(t\('orders\.pack\.photo\.truncated'\)\)/,
    'buildAllergenFields cuts at 4000 in silence, which is the wrong moment to learn '
    + 'that the end of a long list is missing');
});

// ── 2. The switch ────────────────────────────────────────────────────────────

test('⚠️⚠️ packPhoto defaults OFF, and only a literal true counts', () => {
  assert.match(FEATURES, /location\.packPhoto === true/,
    'it spends money per tap on an account nobody in the venue owns: a venue that has '
    + 'never heard of it must never find it already running');
  assert.ok(!/packPhoto\s*!==\s*false/.test(FEATURES),
    '⚠️ that is the direction of the two SAFETY switches beside it, and it is the '
    + 'opposite of what this one needs');
});

test('⚠️ the button asks the switch on every draw, never once at build time', () => {
  assert.match(FORM, /typeof actions\.packPhotoOn !== 'function' \|\| !actions\.packPhotoOn\(\)/,
    'packPhotoOn is CALLED — a value read once would be stale for the life of the '
    + 'form the moment the switch moved on the settings screen behind it');
  assert.match(REGISTRY, /packPhotoOn: \(\) => ingredientPanels\(\)\.packPhoto/,
    'and what it calls is the live read, not a captured snapshot');
});

test('⚠️⚠️ the money switch and the safety switches take different callables', () => {
  assert.match(REGISTRY, /if \(key === 'packPhoto'\) await setPackPhoto\(on\);\s*else await setIngredientPanel\(key, on\);/,
    'setIngredientPanels writes two fields whose ABSENCE MEANS YES; setPackPhoto writes '
    + 'one whose absence means NO. One code path for both is how a money switch ends up '
    + 'defaulting on');
});

test('⚠️ the switch confirms on the way IN, which is the opposite of the other two', () => {
  assert.match(SETTINGS, /key: 'packPhoto',[\s\S]*?confirmOn: \{/,
    'switching a safety feature OFF needs a sentence; switching a paid one ON needs '
    + 'one, and this is the only switch on the page that starts spending');
  assert.match(SETTINGS, /const ask = wanted \? confirmOn : confirmOff;/,
    'and the toggle must be able to ask in either direction');
  assert.match(SETTINGS, /if \(!ok\) \{ cb\.checked = !wanted; return; \}/,
    '⚠️ a refused confirmation must put the box back to what is STORED, in both '
    + 'directions — `= true` was right while only the off-path could ask');
  assert.match(SETTINGS, /const FIELD = \{/,
    '⚠️ with three switches, `key === \'showAllergens\' ? a : b` files the third one '
    + 'under the second');
});

test('the note says what it costs before it is thrown', () => {
  const dicts = _dictionaries();
  for (const lang of Object.keys(dicts)) {
    const note = dicts[lang]['orders.settings.packPhotoNote'];
    assert.ok(note, `missing in ${lang}`);
    assert.match(note, /centesimi|pence/i, `${lang} must name the cost, not imply it`);
  }
});

// ── 3. The promise the form is waiting on ────────────────────────────────────

test('⚠️⚠️ backing out of the photo screen resolves, it does not hang', () => {
  assert.match(REGISTRY, /return overlay\(\s*t\('orders\.pack\.photo\.title'\),[\s\S]*?\(\) => settle\(null\),/,
    'Back must settle the promise: one that never resolves leaves the button that '
    + 'opened it disabled for the life of the form, with nothing on screen saying why');
  assert.match(REGISTRY, /function overlay\(title, body, onBack = pop\)/,
    'and the overlay has to allow that, rather than always popping silently');
  assert.match(REGISTRY, /let settled = false;[\s\S]*?if \(settled\) return;/,
    'and it settles once: a second answer must not pop a screen that is already gone');
});

test('⚠️ the form is left mounted underneath, so nothing typed is lost', () => {
  assert.match(REGISTRY, /if \(top\.overlay\.querySelector\('\.mgmt-form'\)\) return;/,
    'refresh() already refuses to redraw a form — that is what makes an overlay safe '
    + 'here where the Catalogue needed a one-shot marker and a leave-guard');
  assert.ok(!/backToEditor|backToForm/.test(REGISTRY),
    '⚠️ none of the Catalogue\'s return machinery is copied, because its swap() '
    + 'DESTROYS the editor and push()/pop() does not');
});

// ── 4. The words ─────────────────────────────────────────────────────────────

test('every code the screen can produce maps to a phrase both dictionaries hold', () => {
  const dicts = _dictionaries();
  const keys = [...CAPTURE.matchAll(/'(orders\.pack\.photo\.[a-zA-Z.]+)'/g)].map(m => m[1]);
  assert.ok(keys.length > 15, `the extractor found only ${keys.length} keys — it is broken`);
  for (const key of new Set(keys)) {
    for (const lang of Object.keys(dicts)) {
      assert.ok(dicts[lang][key], `${key} is missing in ${lang}`);
    }
  }
});

test('⚠️ only the offline answer may mention the connection', () => {
  const en = _dictionaries()[DEFAULT_LANGUAGE];
  const guilty = Object.entries(en)
    .filter(([k]) => k.startsWith('orders.pack.photo.err.'))
    .filter(([k, v]) => k !== 'orders.pack.photo.err.offline' && /connection|online|internet/i.test(v));
  assert.deepEqual(guilty.map(([k]) => k), [],
    'telling somebody with full signal to check their connection sends them to fix '
    + 'the one thing that is working');
});

test('⚠️ no phrase is resolved at module load', () => {
  assert.ok(!/^const .*=.*\bt\(/m.test(CAPTURE),
    'a t() at module load runs before a venue is open and freezes in whatever language '
    + 'the app started in — fourteen constants in this app did exactly that');
  assert.match(CAPTURE, /function paint\(\) \{[\s\S]*?lead\.textContent = t\('orders\.pack\.photo\.lead'\)/,
    'every phrase is set in paint()');
  assert.match(CAPTURE, /onLanguageChange\(\(\) => \{ if \(root\.isConnected\) paint\(\); \}\);/,
    'and the screen answers a language change itself, guarded against outliving its view');
});

test('⚠️ the note tells the truth about what a photograph does and does not do', () => {
  const dicts = _dictionaries();
  for (const lang of Object.keys(dicts)) {
    const note = dicts[lang]['orders.pack.photo.note'];
    assert.ok(note, `missing in ${lang}`);
    assert.match(note, /dichiarat|declared/i,
      `${lang}: the one thing this note exists to say is that nothing is DECLARED `
      + 'until a person ticks the box');
  }
});

// ── 5. The wiring nothing can execute ────────────────────────────────────────

test('⚠️ the classes this screen writes are Orders classes, not the Catalogue\'s', () => {
  assert.ok(!/class: '[^']*\bcat-/.test(CAPTURE),
    'catalogue.css is not loaded on suppliers.html: a copied cat-* name renders as a '
    + 'bare grey browser rectangle, with no error anywhere');
});

test('⚠️ the location is read at CALL time, never captured while rendering', () => {
  assert.match(DATA, /await sessionReady;\s*const locationId = currentLocationId\(\);/,
    'currentLocationId() is null before a location is open, and a screen that freezes '
    + 'that null refuses every read for its whole life — a RACE, which read perfectly '
    + 'on one run and refused on the next in the Catalogue\'s copy');
  assert.ok(!/function readPackFromPhotos\(locationId/.test(DATA),
    'and it is not passed in from the screen');
});

test('⚠️ the busy marker is set and cleared in a finally', () => {
  assert.match(CAPTURE, /root\.classList\.add\('alg-photo-busy'\)/);
  assert.match(CAPTURE, /finally \{[\s\S]*?root\.classList\.remove\('alg-photo-busy'\)/,
    'a read that throws must not leave the update gate blocked for ever');
  assert.match(codeOf(read('js/update-gate.js')), /'\.alg-photo-busy'/,
    'and the gate has to know the marker, or a compulsory update reloads the page and '
    + 'throws away a read that has already been paid for');
});

test('⚠️ the offline check stays, and stays BEFORE the call', () => {
  assert.match(CAPTURE, /if \(navigator\.onLine === false\) \{[\s\S]{0,200}?return;\s*\}[\s\S]{0,400}?await readPackFromPhotos/,
    '`unavailable` from a callable is also what a broken function looks like; this is '
    + 'the one case where «check your connection» is the truth rather than a guess');
});

test('⚠️ HEIC has no fallback decoder, deliberately', () => {
  assert.match(CAPTURE, /createImageBitmap\(file, \{ imageOrientation: 'from-image' \}\)/,
    'EXIF rotation, and no blob: URL — the CSP allows img-src \'self\' data: and nothing else');
  assert.match(CAPTURE, /throw new Error\('undecodable'\)/,
    'a second decoder that works on one platform is a defect that exists only on the other');
});
