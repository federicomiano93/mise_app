// The Home's one «Settings» door.
//
// Federico, 13 Sep 2026: «io metterei solo un tasto settings perche' senno' diventano
// troppe scritte in fondo alla pagina». The rows moved; the GATES must not have. These
// read the source, because the only other witness is a signed-in browser — which the
// driven run on the emulators is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('⚠️ the bottom of the Home carries ONE button, «Settings»', () => {
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /t\('ui\.settings'\)/);
  assert.equal((strip.match(/createElement\('button'\)/g) || []).length, 1,
    'exactly one button is built for the bottom of the Home');
  for (const key of ['auth.logOut', 'lang.title', 'people.title', 'home.switch', 'homeCards.title']) {
    assert.ok(!HOME.includes(`t('${key}')`), `«${key}» lives in Settings now, not under the cards`);
  }
});

test('the Settings button is the app\'s bottom-bar button, icon and label in a row', () => {
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /className = 'recipe-footer'/);
  assert.match(strip, /className = 'recipe-footer-btn'/);
  assert.match(strip, /import\('\.\/home-settings\.js'\)[\s\S]{0,80}openHomeSettings\(session\)/);
});

test('⚠️ the holiday notice stays on the Home only while somebody IS on holiday', () => {
  const strip = bodyOf(HOME, 'renderSessionActions');
  assert.match(strip, /b\.classList\.contains\('session-away'\)[\s\S]{0,80}logoutHost\.prepend\(b\)/,
    'a person whose phone has gone quiet must be able to see it without opening a menu');
});

test('⚠️⚠️ every row keeps exactly the gate it had under the cards', () => {
  assert.match(SETTINGS, /if \(session\.canManage\) \{\s*scroll\.append\(item\(t\('lang\.title'\)/);
  assert.match(SETTINGS, /if \(session\.canManage\) \{\s*scroll\.append\(item\(t\('homeCards\.title'\)/);
  assert.match(SETTINGS, /if \(session\.isOwner\) \{\s*scroll\.append\(item\(t\('people\.title'\)/,
    'hiring is the one power a manager does not have');
  assert.match(SETTINGS, /if \(!session\.isAppAdmin && options\.length > 1\) \{\s*scroll\.append\(item\(t\('home\.switch'\)/);
  assert.equal((SETTINGS.match(/scroll\.append\(item\(/g) || []).length, 4,
    'a fifth row would be a row nobody decided the gate for');
});

test('⚠️ Log out is for everybody, last, low-key, and asks first', () => {
  assert.match(SETTINGS, /const logout = node\('button', 'session-logout', t\('auth\.logOut'\)\);/,
    'a quiet underlined line, never a row dressed like the others (P20)');
  assert.match(SETTINGS, /\n {4}scroll\.append\(logout\);/, 'not inside any gate');
  assert.ok(SETTINGS.lastIndexOf('scroll.append(item(') < SETTINGS.indexOf('scroll.append(logout)'),
    'and after every row');
  assert.match(SETTINGS, /danger: true,\s*\}\);\s*if \(ok\) signOutNow\(\);/);
});

test('the holiday row follows the holiday, and stops listening when the screen closes', () => {
  assert.match(SETTINGS, /window\.addEventListener\('away-changed', onAwayChanged\)/);
  assert.match(SETTINGS, /window\.removeEventListener\('away-changed', onAwayChanged\)/);
  assert.match(SETTINGS, /if \(mine !== awaySeq \|\| !overlay\.isConnected\) return;/,
    'two answers arriving out of order must not draw two holiday rows');
});

test('⚠️⚠️ the holiday row holds its place from the first paint, so no row jumps under a finger', () => {
  const paint = SETTINGS.slice(SETTINGS.indexOf('function paint()'), SETTINGS.indexOf("t('lang.title')"));
  assert.match(paint, /awayRow = item\(t\('away\.title'\), t\('settings\.away\.sub'\), \(\) => \{\}\);\s*awayRow\.disabled = true;\s*scroll\.append\(awayRow\);/,
    'the placeholder must be the FIRST thing painted, before any other row');
  assert.match(SETTINGS, /if \(awayRow\?\.isConnected\) awayRow\.replaceWith\(btn\);/,
    'the real row replaces the placeholder in place; a prepend is what pushed the list down');
});

test('⚠️ the sentence under a Settings row is in the same typeface as its title', () => {
  // Both spans live inside a <button>, which takes the SYSTEM font unless the rule names one.
  const css = read('style.css');
  const family = name => (css.match(new RegExp(`\\.${name}\\s*\\{[^}]*font-family:\\s*([^;]+);`)) || [])[1];
  assert.ok(family('settings-menu-title'), '.settings-menu-title names its family');
  assert.equal(family('settings-menu-sub'), family('settings-menu-title'),
    'a row whose two lines are set in two different typefaces reads as broken');
});

test('the Settings screen is precached', () => {
  assert.match(read('sw.js'), /'\.\/js\/home-settings\.js'/);
});
