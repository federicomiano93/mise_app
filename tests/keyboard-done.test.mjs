// The ✓ / Done key on every single-line box (js/keyboard-done.js): behaviour
// against a tiny fake document, that every page loads it, and that every number
// box asks for the numeric keypad in its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
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
const setup = () => { const d = fakeDoc(); installKeyboardDone(d); return d; };

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

test('Enter does nothing inside a form, while composing, on other keys, on next or textarea', () => {
  const d = setup();
  const inForm = fakeNode('input', { type: 'text' }, { inForm: true });
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
  assert.match(read('sw.js'), /'\.\/js\/keyboard-done\.js'/);
  const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html') && f !== 'home.html');
  assert.ok(pages.length >= 9);
  for (const page of pages) {
    const html = read(page);
    const direct = /src="js\/i18n-dom\.js"/.test(html);
    const viaMain = [...html.matchAll(/<script type="module" src="(js\/[^"]+)"/g)]
      .some(([, src]) => /import '(?:\.\.?\/)+i18n-dom\.js'/.test(read(src)));
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

test('every number input built in js/ declares an inputmode', () => {
  const bad = [];
  for (const file of walk('js')) {
    const src = read(file);
    const re = /type: ?'number'/g;
    let m;
    while ((m = re.exec(src))) {
      // The props object of this input: from the opening of el('input', { to its close.
      const start = src.lastIndexOf('{', m.index);
      const end = src.indexOf('});', m.index);
      const block = src.slice(Math.max(0, start), end < 0 ? m.index + 600 : end);
      const wide = src.slice(Math.max(0, m.index - 300), m.index + 700);
      if (!/inputmode/.test(block) && !/attrs\.inputmode/.test(wide)) {
        bad.push(`${file}:${src.slice(0, m.index).split('\n').length}`);
      }
    }
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
