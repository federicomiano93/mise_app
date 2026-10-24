// The Home's one «Settings» door.
//
// Federico, 13 Sep 2026: «io metterei solo un tasto settings perche' senno' diventano
// troppe scritte in fondo alla pagina». The rows moved; the GATES must not have. These
// read the source, because the only other witness is a signed-in browser — which the
// driven run on the emulators is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { missingFromPrecache } from './helpers/precache.mjs';

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = p => read(p).split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

const HOME = code('js/home-session.js');
const SETTINGS = code('js/home-settings.js');

function bodyOf(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf('\nfunction ', start + 10);
  return next === -1 ? src.slice(start) : src.slice(start, next);
}

test('⚠️ the bottom of the Home carries «Settings» and ONE small «Log out», nothing else', () => {
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /t\('ui\.settings'\)/);
  assert.match(strip, /t\('auth\.logOut'\)/);
  assert.equal((strip.match(/createElement\('button'\)/g) || []).length, 2,
    'exactly two buttons are built for the bottom of the Home');
  for (const key of ['lang.title', 'people.title', 'home.switch', 'homeCards.title']) {
    assert.ok(!HOME.includes(`t('${key}')`), `«${key}» lives in Settings now, not under the cards`);
  }
});

test('⚠️ the Home «Log out» asks first, then asks again if something is unsent, then signs out', () => {
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /className = 'home-signout'/);
  // The kiosk toggle finds the button by this selector: renaming the class must fail here, not
  // silently leave the Home «Log out» on a kiosk tablet.
  assert.match(read('js/home-session.js'), /querySelector\('#session-logout-host \.home-signout'\)/);
  assert.match(strip, /title: t\('auth\.logOut\.title'\)[\s\S]*message: t\('auth\.logOut\.message'\)/);
  assert.match(strip, /okLabel: t\('auth\.logOut'\),\s*cancelLabel: t\('ui\.cancel'\),\s*danger: true,\s*\}\);\s*if \(ok && await mayLeaveWithUnsent\(confirmDialog\)\) signOutNow\(\);/);
  assert.match(HOME, /import \{ confirmDialog \} from '\.\/confirm-dialog\.js';/);
  assert.match(HOME, /import \{ mayLeaveWithUnsent \} from '\.\/unsent-guard\.js';/);
  assert.match(HOME, /import \{[^}]*signOutNow[^}]*\} from '\.\/firebase\.js';/);
});

test('⚠️ the Home «Log out» is not shown on a kiosk device, and follows kiosk mode being switched', () => {
  // On a kiosk device the Home has a red «Exit» that closes the app; two «Exit»s are a trap.
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /signOut\.hidden = kioskIsOn\(\);/);
  assert.match(HOME, /kioskBandVisible\(localStorage\.getItem\(KIOSK_STORAGE_KEY\)\)/);
  assert.match(HOME, /addEventListener\('kiosk-settings-changed', syncSignOut\)/);
  assert.match(HOME, /addEventListener\('storage'/);
});

test('⚠️ the Home «Log out» is small and quiet, but its tap area is still 44px tall', () => {
  const css = read('orders.css');
  const start = css.indexOf('#session-logout-host .home-signout {');
  assert.ok(start >= 0, 'the Home sign-out has its own rule');
  const rule = css.slice(start, css.indexOf('}', start));
  assert.match(rule, /min-height:\s*44px/);
  assert.match(rule, /font-size:\s*13px/);
  assert.match(rule, /color:\s*var\(--text-2\)/);
  assert.match(rule, /white-space:\s*nowrap/);
  assert.match(css, /#session-logout-host \.home-signout:focus-visible\s*\{[^}]*outline/);
  assert.doesNotMatch(rule, /#[0-9a-fA-F]{3,6}\b/, 'tokens only');
});

test('the Settings button is the app\'s bottom-bar button, icon and label in a row', () => {
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /className = 'recipe-footer'/);
  assert.match(strip, /className = 'recipe-footer-btn'/);
  assert.match(strip, /import\('\.\/home-settings\.js'\)[\s\S]{0,80}openHomeSettings\(session\)/);
});

test('⚠️ the bottom of the Home never carries the holiday — that is a band at the top', () => {
  // Federico, 13 Sep 2026: «voglio solo un tasto impostazioni».
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.doesNotMatch(strip, /away-screen|session-away|buildAwayButton/);
  assert.match(HOME, /import \{ refreshAway, wireAwayReminder \} from '\.\/home-away\.js';/);
});

test('⚠️⚠️ every row keeps exactly the gate it had under the cards', () => {
  // Since 28 Sep 2026 the rows sit in three cards (you, the venue, the account), and
  // each gate is a conditional on the row itself.
  assert.match(SETTINGS, /session\.canManage \? item\(t\('lang\.title'\)/);
  assert.match(SETTINGS, /session\.canManage \? item\(t\('homeCards\.title'\)/);
  assert.match(SETTINGS, /session\.isOwner \? item\(t\('people\.title'\)/,
    'hiring is the one power a manager does not have');
  assert.match(SETTINGS, /!session\.isAppAdmin && options\.length > 1 \? item\(t\('home\.switch'\)/);
  assert.equal((SETTINGS.match(/ \? item\(/g) || []).length, 4,
    'a fifth row would be a row nobody decided the gate for');
});

test('⚠️ Settings keeps Log out ONLY on a kiosk device, last, low-key, and asks first', () => {
  // Since 15 Oct 2026 it lives on the Home; here it is the kiosk device's way out.
  assert.match(SETTINGS, /logout\.hidden = !kioskOn\(\);/);
  assert.match(SETTINGS, /kioskBandVisible\(localStorage\.getItem\(KIOSK_STORAGE_KEY\)\)/);
  assert.match(SETTINGS, /addEventListener\('kiosk-settings-changed', onKioskChanged\)/);
  assert.match(SETTINGS, /removeEventListener\('kiosk-settings-changed', onKioskChanged\)/);
  assert.match(SETTINGS, /const logout = node\('button', 'set-danger', t\('auth\.logOut'\)\);/,
    'a quiet underlined line, never a row dressed like the others (P20)');
  assert.match(read('tokens.css'), /\.set-danger\s*\{[^}]*text-decoration:\s*underline/,
    'and the shared quiet-danger look is an underlined line');
  assert.match(SETTINGS, /\n {4}scroll\.append\(logout\);/, 'not inside any gate');
  assert.ok(SETTINGS.lastIndexOf(' ? item(') < SETTINGS.indexOf('scroll.append(logout)'),
    'and after every row');
  // …and, since 23 Sep 2026, asks a second time only when something typed is still
  // waiting for signal: signing out now clears the offline copy it waits in.
  assert.match(SETTINGS, /danger: true,\s*\}\);\s*if \(ok && await mayLeaveWithUnsent\(confirmDialog\)\) signOutNow\(\);/);
});

test('the holiday row follows the holiday, and stops listening when the screen closes', () => {
  assert.match(SETTINGS, /window\.addEventListener\('away-changed', onAwayChanged\)/);
  assert.match(SETTINGS, /window\.removeEventListener\('away-changed', onAwayChanged\)/);
  assert.match(SETTINGS, /if \(mine !== awaySeq \|\| !overlay\.isConnected\) return;/,
    'two answers arriving out of order must not draw two holiday rows');
});

test('⚠️⚠️ the holiday row holds its place from the first paint, so no row jumps under a finger', () => {
  const paint = SETTINGS.slice(SETTINGS.indexOf('function paint()'), SETTINGS.indexOf("t('lang.title')"));
  assert.match(paint, /awayRow = item\(t\('away\.title'\), t\('settings\.away\.sub'\), \(\) => \{\}\);\s*awayRow\.disabled = true;/,
    'the placeholder is built before any other row');
  assert.match(paint, /scroll\.append\(\.\.\.\[\s*section\(t\('settings\.home\.you'\), \[awayRow\]\),/,
    'and it is the FIRST card painted, so no row jumps under a finger');
  assert.match(SETTINGS, /if \(awayRow\?\.isConnected\) awayRow\.replaceWith\(btn\);/,
    'the real row replaces the placeholder in place; a prepend is what pushed the list down');
});

test('⚠️ the sentence under a Settings row is in the same typeface as its title', () => {
  // Both spans live inside a <button>, which takes the SYSTEM font unless a rule names
  // one. Since 28 Sep 2026 every settings row is the shared .set-row (tokens.css), which
  // names the app's font once; the title and the line under it inherit it together.
  const css = read('tokens.css');
  assert.match(css, /\.set-row\s*\{[^}]*font-family:\s*var\(--font\)/,
    '.set-row names the family, so a row can never be set in two typefaces');
  assert.doesNotMatch(css, /\.set-(title|sub)\s*\{[^}]*font-family/,
    'and neither line overrides it on its own');
});

test('the Settings screen is precached', () => {
  assert.deepEqual(missingFromPrecache(['js/home-settings.js']), []);
});

test('Settings follows kiosk mode switched in another tab, and stops listening when it closes', () => {
  const src = read('js/home-settings.js');
  assert.match(src, /window\.addEventListener\('storage', onKioskChanged\);/);
  assert.match(src, /window\.removeEventListener\('storage', onKioskChanged\);/);
});
