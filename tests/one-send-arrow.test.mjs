// One send arrow, one sheet behind it, everywhere in the app.
//
// Federico, 24 Aug 2026: «togli la casella whatsapp e email e metti una freccia per
// inviare che poi mi fa scegliere come inviarlo», and «usa le stesse frecce di invio
// uguali in tutta l'app».
//
// ⚠️⚠️ THE ARROW WAS ALREADY CHOSEN — by him, on 14 Aug, from three mounted side by side
// in the Orders header and screenshotted. What was missing was that it existed in ONE
// place while five other glyphs did the same job elsewhere. These guards are about the
// ones, not about the shape: one definition, one sheet, one word.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SEND_PATHS, WHATSAPP_PATHS, EMAIL_PATHS, svgFrom, sendIconSvg } from '../js/send-icon.js';
import { _dictionaries } from '../js/i18n.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
// Comments name the very things these tests forbid. Judge the CODE.
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'vendor' || name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { walk(full, out); continue; }
    if (/\.(js|html|css)$/.test(name)) out.push(full);
  }
  return out;
}

const APP_FILES = [
  ...walk(join(ROOT, 'js')),
  ...readdirSync(ROOT).filter(n => /\.(html|css)$/.test(n)).map(n => join(ROOT, n)),
].map(f => [f.slice(ROOT.length + 1).replace(/\\/g, '/'), readFileSync(f, 'utf8')]);

// ── 1. One shape, and the two it replaced are GONE ───────────────────────────

// ⚠️ A RULE, NOT A LIST. Every file in the app is read, so a screen added tomorrow that
// hand-copies a glyph fails the build rather than being noticed on a phone.
test('⚠️⚠️ the paper plane Federico rejected is nowhere in the app', () => {
  // «questa non mi piace», 14 Aug 2026. It survived in TWO places: an unused entry in
  // js/calculator-icons.js, and a hand-copy of the same path in calculator.html which
  // was the one actually on screen.
  const PLANE = 'M22 2l-7 20-4-9-9-4 20-7z';
  const offenders = APP_FILES.filter(([, src]) => src.includes(PLANE)).map(([rel]) => rel);
  assert.deepEqual(offenders, [], 'the rejected glyph must not come back');
});

test('⚠️⚠️ the WhatsApp brand mark is on no button anywhere', () => {
  // Three copies of the same long filled path — the Calculator header, the per-recipe
  // share button, and both History buttons. A brand glyph on a control with more than
  // one destination names exactly ONE of them, which is how somebody learns the wrong
  // thing about their own app: the argument written in orders.html the day the arrow
  // was chosen.
  const offenders = APP_FILES.filter(([, src]) => src.includes('M17.472')).map(([rel]) => rel);
  assert.deepEqual(offenders, [], 'the brand mark must not name one road on a send button');
});

test('⚠️ and its brand COLOUR went with it, rather than being left defined', () => {
  const offenders = APP_FILES.filter(([rel, src]) => rel.endsWith('.css') && /--whatsapp/.test(src))
    .map(([rel]) => rel);
  assert.deepEqual(offenders, [],
    'a token nothing paints with is a token somebody paints with by accident');
});

test('⚠️ every send control in the app draws the ONE arrow', () => {
  // The two static copies in markup are legitimate — a page cannot import a module for
  // its own header — but they must be the SAME shape, so they are compared to the
  // module's own list rather than trusted.
  const markup = APP_FILES.filter(([rel]) => rel.endsWith('.html'));
  const carrying = markup.filter(([, src]) => src.includes(SEND_PATHS[0]));
  assert.ok(carrying.length >= 2,
    `the arrow must be in the two headers that draw it in markup — found ${carrying.length}`);
  for (const [rel, src] of carrying) {
    for (const d of SEND_PATHS) {
      assert.ok(src.includes(d), `${rel} draws a DIFFERENT arrow: it is missing "${d}"`);
    }
  }
  // And the factory the Calculator's own icons come from reads the same list.
  assert.match(codeOf(read('js/calculator-icons.js')), /send: SEND_PATHS,/,
    'icon(\'send\') must be the shared arrow, not a second drawing of it');
});

test('the two builders cannot drift into two different arrows', () => {
  // svgFrom() builds markup for el()'s `icon:`; svgElement() builds nodes for the
  // screens whose DOM helper never parses HTML. Both read SEND_PATHS.
  const markup = sendIconSvg(20);
  for (const d of SEND_PATHS) assert.ok(markup.includes(d), `the markup is missing "${d}"`);
  assert.ok(markup.includes('width="20"') && markup.includes('height="20"'),
    'the size must reach the tag');
  assert.ok(markup.includes('aria-hidden="true"'),
    'it is decoration — every button that carries it also has a name');
  assert.ok(svgFrom(WHATSAPP_PATHS, 22).includes(WHATSAPP_PATHS[0])
    && svgFrom(EMAIL_PATHS, 22).includes(EMAIL_PATHS[1]),
  'the sheet\'s two road glyphs come from the same file');
});

// ── 2. The sheet, and the styles that must reach every page ──────────────────

test('⚠️⚠️ the chooser\'s styles live in tokens.css, the one sheet every page loads', () => {
  const tokens = read('tokens.css');
  const orders = read('orders.css');
  assert.match(tokens, /\.send-route \{/,
    'catalogue.html loads neither orders.css nor style.css: a look that must be '
    + 'identical everywhere cannot live in one feature\'s stylesheet');
  assert.ok(!/^\.send-route \{/m.test(orders),
    'and it must not be left behind in orders.css as a second copy');
});

test('⚠️⚠️ every variable those rules use is DEFINED in tokens.css', () => {
  // The rules arrived carrying var(--accent) and var(--text3), which are defined in
  // STYLE.CSS — a file the Catalogue does not load. The icon and the note would have
  // rendered with no colour at all, on the one screen in this app that can send
  // somebody to hospital, and nothing anywhere would have warned. Three undefined
  // custom properties and one undefined class name have already shipped for exactly
  // this reason.
  const tokens = read('tokens.css');
  const defined = new Set([...tokens.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gmi)].map(m => m[1]));
  const block = tokens.slice(tokens.indexOf('.send-routes {'));
  assert.ok(block.length > 200, 'the slice must actually contain the rules');
  const used = [...new Set([...block.matchAll(/var\((--[a-z0-9-]+)/gi)].map(m => m[1]))];
  assert.ok(used.length >= 5, `only ${used.length} variables found — the slice is wrong`);
  const missing = used.filter(v => !defined.has(v));
  assert.deepEqual(missing, [],
    'an undefined custom property is dropped in SILENCE: no error, no warning, and a '
    + 'colour that simply is not there');
});

test('⚠️ the sheet closes BEFORE it opens a window, and never on an empty message', () => {
  const sheet = codeOf(read('js/send-sheet.js'));
  const at = sheet.indexOf('b.addEventListener');
  assert.notEqual(at, -1, 'the road buttons must be wired to be guarded');
  const body = sheet.slice(at, sheet.indexOf('cancel.addEventListener', at));
  assert.ok(body.length > 60, 'the slice must not be empty');
  assert.ok(body.indexOf('done(road.id)') < body.indexOf('sendOnWhatsApp'),
    'both roads open a new window and on a phone that leaves the app entirely — coming '
    + 'back to a dialog still sitting open reads as a send that did not happen');
  assert.match(sheet, /if \(!String\(text\)\.trim\(\)\) return Promise\.resolve\(null\);/,
    'never open an empty chat');
});

test('⚠️ it answers Escape and gives focus back — which the chooser it copies does not', () => {
  const sheet = codeOf(read('js/send-sheet.js'));
  assert.match(sheet, /e\.key === 'Escape'/, 'Escape must close it');
  assert.match(sheet, /prevFocus\.focus\(\)/, 'and focus must go back where it was');
  assert.match(sheet, /if \(e\.key !== 'Tab'\) return;/, 'Tab must stay inside the dialog');
});

// ── 3. The two bans this release is allowed to state ─────────────────────────

test('⚠️⚠️ no navigator.share, anywhere in the app', () => {
  // ⚠️ REPO-WIDE, NOT TWO FILES. Until 24 Aug 2026 this was asserted about js/share.js
  // and one screen; a third file could have reached for the platform API and nothing
  // would have said so. Federico was asked between the phone's own share sheet and the
  // app's and chose the app's: the phone's looks different on every device, is absent
  // in some desktop browsers, and would stand beside the one Orders already uses.
  const offenders = APP_FILES.filter(([rel, src]) => rel.endsWith('.js') && /navigator\.share/.test(codeOf(src)))
    .map(([rel]) => rel);
  assert.deepEqual(offenders, [], 'one mechanism, or the same errand behaves two ways on '
    + 'the same phone');
});

test('⚠️ every clipboard write is raced against a clock, in ONE place', () => {
  // navigator.clipboard.writeText() can sit there and never settle — the page losing
  // focus is enough. js/calc.js awaited one on its own until 24 Aug 2026, which would
  // have left the button saying «Copy the recipe» for ever with no error anywhere.
  const offenders = APP_FILES
    .filter(([rel, src]) => rel.endsWith('.js') && rel !== 'js/share.js'
      && /clipboard\.writeText/.test(codeOf(src)))
    .map(([rel]) => rel);
  assert.deepEqual(offenders, [],
    'copyToClipboard() owns the two-second race; a fifth hand-rolled copy is a fifth '
    + 'thing that can hang');
});

// ── 4. One word for one action ───────────────────────────────────────────────

test('⚠️ the app has ONE word for «send», and six keys that named a destination are gone', () => {
  const dicts = _dictionaries();
  assert.equal(dicts.en['ui.send'], 'Send');
  assert.equal(dicts.it['ui.send'], 'Manda',
    '«Manda» is what the app says in a dozen other places; «Invia» was the outlier');
  for (const dead of ['orders.send.button', 'cat.decl.whatsapp', 'cat.decl.email',
    'cat.decl.mailNote', 'help.sendOnWhatsapp', 'calc.sendOnWhatsapp',
    'calc.shareViaWhatsapp']) {
    for (const lang of ['en', 'it']) {
      assert.ok(!(dead in dicts[lang]),
        `${dead} named a destination the button no longer commits to (${lang})`);
    }
  }
  for (const key of ['send.how', 'send.whatsapp', 'send.email', 'send.emailOpensApp']) {
    for (const lang of ['en', 'it']) {
      assert.ok(dicts[lang][key], `${key} is missing in ${lang}`);
    }
  }
});

test('⚠️ the sheet\'s keys are `send.`, not `orders.send.`', () => {
  // It is opened from the Catalogue, the Calculator and «Who can get in» too, and a key
  // named after the one feature that happened to need it first is the next reader's trap.
  const sheet = codeOf(read('js/send-sheet.js'));
  assert.ok(!/t\('orders\./.test(sheet), 'a root module must not ask for a feature\'s keys');
  assert.match(sheet, /t\('send\.how'\)/, 'it asks its own question');
});

test('⚠️ a hint that sent somebody looking for a button removed in v1.55.0', () => {
  const dicts = _dictionaries();
  for (const lang of ['en', 'it']) {
    assert.ok(!/WhatsApp button|tasto WhatsApp/.test(dicts[lang]['orders.request.noneHint']),
      `the Orders header has carried a send ARROW since v1.55.0, not a WhatsApp button (${lang})`);
  }
});
