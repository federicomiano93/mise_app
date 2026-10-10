// The ✓ / Done key on every single-line box (js/keyboard-done.js): behaviour
// against a tiny fake document, that every page loads it, and that every number
// box asks for the numeric keypad in its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { missingFromPrecache } from './helpers/precache.mjs';
import { pageScripts } from './helpers/page-scripts.mjs';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { installKeyboardDone } from '../js/keyboard-done.js';

function fakeNode(tag, attrs = {}, { inForm = false } = {}) {
  const a = { ...attrs };
  return {
    tagName: tag.toUpperCase(),
    blurred: 0,
    getAttribute: (k) => (k in a ? a[k] : null),
    setAttribute: (k, v) => { a[k] = String(v); },
    closest: (sel) => (sel === 'form' && inForm ? {} : null),
    blur() { this.blurred += 1; },
  };
}
function fakeDoc() {
  const handlers = {};
  return {
    addEventListener: (type, fn) => { handlers[type] = fn; },
    fire: (type, target, extra = {}) => handlers[type]({ target, ...extra }),
  };
}
test('focusing a box gives it the hint, in the capturing phase, with no observer', () => {
  const calls = [];
  const d = { addEventListener: (type, fn, capture) => calls.push({ type, fn, capture }) };
  installKeyboardDone(d);
  const focusin = calls.find((c) => c.type === 'focusin');
  assert.equal(focusin.capture, true);
  const input = fakeNode('input', { type: 'number' });
  focusin.fn({ target: input });
  assert.equal(input.getAttribute('enterkeyhint'), 'done');
  const area = fakeNode('textarea');
  const next = fakeNode('input', { enterkeyhint: 'next' });
  focusin.fn({ target: area });
  focusin.fn({ target: next });
  assert.equal(area.getAttribute('enterkeyhint'), null);
  assert.equal(next.getAttribute('enterkeyhint'), 'next');
});

test('a pointerdown also gives the hint, capturing and passive, before the keyboard is asked for', () => {
  const calls = [];
  const d = { addEventListener: (type, fn, opts) => calls.push({ type, fn, opts }) };
  installKeyboardDone(d);
  const down = calls.find((c) => c.type === 'pointerdown');
  assert.deepEqual(down.opts, { capture: true, passive: true });
  const input = fakeNode('input', { type: 'text' });
  down.fn({ target: input });
  assert.equal(input.getAttribute('enterkeyhint'), 'done');
  const next = fakeNode('input', { enterkeyhint: 'next' });
  const area = fakeNode('textarea');
  const div = { tagName: 'DIV' };
  for (const n of [next, area, div]) down.fn({ target: n });
  assert.equal(next.getAttribute('enterkeyhint'), 'next');
  assert.equal(area.getAttribute('enterkeyhint'), null);
});

const touch = () => ({ matches: true });
const setup = (media = touch) => { const d = fakeDoc(); installKeyboardDone(d, media); return d; };

test('focus gives text, number and typeless inputs the done key', () => {
  const d = setup();
  for (const attrs of [{ type: 'text' }, { type: 'number' }, {}, { type: 'search' }, { type: 'password' }]) {
    const n = fakeNode('input', attrs);
    d.fire('focusin', n);
    assert.equal(n.getAttribute('enterkeyhint'), 'done', JSON.stringify(attrs));
  }
});

test('focus leaves textareas, checkboxes and an existing enterkeyhint alone', () => {
  const d = setup();
  const area = fakeNode('textarea');
  const box = fakeNode('input', { type: 'checkbox' });
  const next = fakeNode('input', { type: 'text', enterkeyhint: 'next' });
  for (const n of [area, box, next]) d.fire('focusin', n);
  assert.equal(area.getAttribute('enterkeyhint'), null);
  assert.equal(box.getAttribute('enterkeyhint'), null);
  assert.equal(next.getAttribute('enterkeyhint'), 'next');
});

test('Enter blurs a done box outside a form', () => {
  const d = setup();
  const n = fakeNode('input', { type: 'number' });
  d.fire('focusin', n);
  d.fire('keydown', n, { key: 'Enter' });
  assert.equal(n.blurred, 1);
});

test('a box inside a form gets no hint at all', () => {
  const d = setup();
  const n = fakeNode('input', { type: 'text' }, { inForm: true });
  d.fire('focusin', n);
  assert.equal(n.getAttribute('enterkeyhint'), null);
});

test('Enter blurs only on a touch device, never with a hardware keyboard', () => {
  const mouse = setup(() => ({ matches: false }));
  const a = fakeNode('input', { type: 'search' });
  mouse.fire('focusin', a);
  mouse.fire('keydown', a, { key: 'Enter' });
  assert.equal(a.blurred, 0);
  const asked = [];
  const finger = setup((q) => { asked.push(q); return { matches: true }; });
  const b = fakeNode('input', { type: 'search' });
  finger.fire('focusin', b);
  finger.fire('keydown', b, { key: 'Enter' });
  assert.equal(b.blurred, 1);
  assert.deepEqual(asked, ['(pointer: coarse)']);
});

test('Enter does nothing inside a form, while composing, on other keys, on next or textarea', () => {
  const d = setup();
  const inForm = fakeNode('input', { type: 'text', enterkeyhint: 'done' }, { inForm: true });
  d.fire('focusin', inForm);
  d.fire('keydown', inForm, { key: 'Enter' });
  assert.equal(inForm.blurred, 0);

  const composing = fakeNode('input', { type: 'text' });
  d.fire('focusin', composing);
  d.fire('keydown', composing, { key: 'Enter', isComposing: true });
  d.fire('keydown', composing, { key: 'a' });
  assert.equal(composing.blurred, 0);

  const next = fakeNode('input', { type: 'text', enterkeyhint: 'next' });
  d.fire('focusin', next);
  d.fire('keydown', next, { key: 'Enter' });
  assert.equal(next.blurred, 0);

  const area = fakeNode('textarea', { enterkeyhint: 'done' });
  d.fire('keydown', area, { key: 'Enter' });
  assert.equal(area.blurred, 0);
});

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('every precached page loads the module through the shared entry', () => {
  assert.match(read('js/i18n-dom.js'), /import '\.\/keyboard-done\.js'/);
  assert.deepEqual(missingFromPrecache(['js/keyboard-done.js']), []);
  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'home.html');
  assert.ok(pages.length >= 9);
  for (const page of pages) {
    const html = read(page);
    const scripts = pageScripts(html);
    const direct = scripts.includes('js/i18n-dom.js');
    const viaMain = scripts.some(src => /import '(?:\.\.?\/)+i18n-dom\.js'/.test(read(src)));
    assert.ok(direct || viaMain, `${page} never loads js/i18n-dom.js`);
  }
});

function walk(dir, out = []) {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === 'vendor') continue;
    const rel = `${dir}/${name}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (name.endsWith('.js')) out.push(rel);
  }
  return out;
}

// Every type: 'number' match, bounded to ITS OWN object literal (balanced braces),
// so a neighbouring input's inputmode in the same statement cannot satisfy it.
// Returns the 1-based line of each one lacking an inputmode.
export function numberInputsWithoutInputmode(src) {
  const lacking = [];
  const re = /type: ?'number'/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 0; let start = -1;
    for (let k = m.index; k >= 0; k -= 1) {
      if (src[k] === '}') depth += 1;
      else if (src[k] === '{') { if (depth === 0) { start = k; break; } depth -= 1; }
    }
    let end = src.length; depth = 0;
    for (let k = start; k < src.length; k += 1) {
      if (src[k] === '{') depth += 1;
      else if (src[k] === '}') { depth -= 1; if (depth === 0) { end = k; break; } }
    }
    const literal = src.slice(start, end + 1);
    // calculator-render sets attrs.inputmode right after `const attrs = {…}`.
    const viaAttrs = /const attrs = \{$/.test(src.slice(Math.max(0, start - 14), start + 1))
      && /attrs\.inputmode =/.test(src.slice(end, end + 300));
    if (!/\binputmode\b/.test(literal) && !viaAttrs) lacking.push(src.slice(0, m.index).split('\n').length);
  }
  return lacking;
}

test('the inputmode guard catches a first input whose neighbour has the inputmode', () => {
  const crafted = "a(el('input', { type: 'number', min: '0' }), el('input', { type: 'number', inputmode: 'numeric' }));";
  assert.equal(numberInputsWithoutInputmode(crafted).length, 1);
});

test('every number input built in js/ declares an inputmode', () => {
  const bad = [];
  for (const file of walk('js')) {
    for (const line of numberInputsWithoutInputmode(read(file))) bad.push(`${file}:${line}`);
  }
  assert.deepEqual(bad, []);
});

test('the HTML pages declare no number input without an inputmode', () => {
  for (const page of readdirSync(ROOT).filter((f) => f.endsWith('.html'))) {
    for (const tag of read(page).match(/<input[^>]*type="number"[^>]*>/g) || []) {
      assert.match(tag, /inputmode=/, `${page}: ${tag}`);
    }
  }
});

test('no file watches the whole page for added nodes', () => {
  // A subtree observer on the document wakes on every row the app draws, for the
  // life of the tab. Pin the shape out of every file outside js/vendor.
  const shape = /\.observe\(\s*(?:document\.documentElement|document|doc\.documentElement|doc)\s*,\s*\{[^}]*subtree\s*:\s*true/;
  assert.ok(shape.test('o.observe(document.documentElement, { childList: true, subtree: true })'));
  const bad = walk('js').filter((file) => shape.test(read(file)));
  assert.deepEqual(bad, []);
});
