// The Pastries editor speaks the venue's language (P15).
//
// On 11 Oct 2026 Panificio Miano's editor — Italian venue, Italian interface — read «1 pastry»
// in its header, and named its quantity box «How many Sfogliatelle» and its bin «Remove
// Sfogliatelle» to a screen reader. English's plural rule had been written at the call site
// (`n === 1 ? '1 pastry' : …`), and two aria-labels were English sentences glued to a name.
// tests/no-hardcoded-english.test.mjs could not see any of it (its shapes need a capital letter
// and a backtick right after `textContent =`); it now looks for both — this file proves the
// editor itself.
//
// BEHAVIOUR, not source: the editor is rendered under the small DOM in tests/helpers/form-dom.mjs
// and its header and labels are read back. Layout is the ui-check skill's job, not this file's.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, walk } from './helpers/form-dom.mjs';
import { t, setLanguage, DEFAULT_LANGUAGE } from '../js/i18n.js';

// The editor builds nodes with `document`, so the fake goes in BEFORE the editor is loaded.
installDom();
const { renderEditor } = await import('../js/pastries/pastries-editor.js');

function inLanguage(lang, fn) {
  setLanguage(lang);
  try { return fn(); } finally { setLanguage(DEFAULT_LANGUAGE); }
}

const app = {
  confirm: async () => true,
  toast() {},
  saveDay() {},
  showDay() {},
  setLeaveGuard() {},
  setHeaderSave() {},
};

const open = items => renderEditor({ day: 'Sunday', items, note: '', allDays: {}, app });
const withClass = (root, name) => walk(root).filter(n => n.classList.contains(name));
const count = root => withClass(root, 'pas-editor-count')[0].textContent;
const qtyLabels = root => withClass(root, 'pas-qty').map(n => n.getAttribute('aria-label'));
const binLabels = root => withClass(root, 'pas-del-icon').map(n => n.getAttribute('aria-label'));

test('in Italian the header counts in Italian and each row is named in Italian', () => {
  inLanguage('it', () => {
    const root = open([{ name: 'Sfogliatelle', qty: 3 }]);
    assert.equal(count(root), '1 pasta');
    assert.deepEqual(qtyLabels(root), ['Quantità di Sfogliatelle']);
    assert.deepEqual(binLabels(root), ['Rimuovi Sfogliatelle']);
  });
});

test('in Italian a blank row is named in Italian and is not counted', () => {
  inLanguage('it', () => {
    const root = open([{ name: 'Sfogliatelle', qty: 3 }]);
    withClass(root, 'pas-add-row')[0].fire('click');
    assert.deepEqual(qtyLabels(root), ['Quantità di Sfogliatelle', 'Quante paste']);
    assert.deepEqual(binLabels(root), ['Rimuovi Sfogliatelle', 'Rimuovi questa riga']);
    assert.equal(count(root), '1 pasta', 'a blank row is not a pastry');
  });
});

test('in Italian the count follows Italian plural, zero included', () => {
  inLanguage('it', () => {
    assert.equal(count(open([{ name: 'Cornetto', qty: 2 }, { name: 'Bombolone', qty: 4 }])), '2 paste');
    assert.equal(count(open([])), '0 paste');
  });
});

test('in English the same screen reads in English', () => {
  inLanguage('en', () => {
    const root = open([{ name: 'Sfogliatelle', qty: 3 }]);
    assert.equal(count(root), '1 pastry');
    assert.deepEqual(qtyLabels(root), ['How many Sfogliatelle']);
    assert.deepEqual(binLabels(root), ['Remove Sfogliatelle']);

    withClass(root, 'pas-add-row')[0].fire('click');
    assert.deepEqual(qtyLabels(root), ['How many Sfogliatelle', 'How many pastries']);
    assert.deepEqual(binLabels(root), ['Remove Sfogliatelle', 'Remove this row']);
    assert.equal(count(root), '1 pastry', 'a blank row is not a pastry');

    assert.equal(count(open([{ name: 'Cornetto', qty: 2 }, { name: 'Bombolone', qty: 4 }])), '2 pastries');
    assert.equal(count(open([])), '0 pastries');
  });
});

test('a name with spaces around it is named without them', () => {
  inLanguage('it', () => {
    const root = open([{ name: '  Cornetto  ', qty: 2 }]);
    assert.deepEqual(qtyLabels(root), ['Quantità di Cornetto']);
    assert.deepEqual(binLabels(root), ['Rimuovi Cornetto']);
  });
});

test('⚠️ the editor writes no plural rule and no English sentence of its own', () => {
  const src = readFileSync(new URL('../js/pastries/pastries-editor.js', import.meta.url), 'utf8')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(src, /===\s*1\s*\?/, 'a count goes through t() with { n }, in both languages');
  assert.ok(!src.includes("'1 pastry'"));
  assert.ok(!src.includes('`How many '));
  assert.ok(!src.includes('`Remove '));
});

test('the guided-step and business labels exist in Italian', () => {
  inLanguage('it', () => {
    assert.equal(t('cat.stepInstruction', { n: 2 }), 'Istruzione del passaggio 2');
    assert.equal(t('cat.stepMinutes', { n: 2 }), 'Minuti del passaggio 2');
    assert.equal(t('cat.stepSeconds', { n: 2 }), 'Secondi del passaggio 2');
    assert.equal(t('cat.stepSpeed', { n: 2 }), 'Velocità del passaggio 2');
    assert.equal(t('cat.removeStep', { n: 2 }), 'Rimuovi il passaggio 2');
    assert.equal(t('cat.speedPlaceholder'), 'es. 1');
    assert.equal(t('bz.deleteName', { name: 'Bar Roma' }), 'Elimina Bar Roma');
  });
  inLanguage('en', () => {
    assert.equal(t('cat.removeStep', { n: 2 }), 'Remove step 2');
    assert.equal(t('cat.speedPlaceholder'), 'e.g. 1');
    assert.equal(t('bz.deleteName', { name: 'Bar Roma' }), 'Delete Bar Roma');
  });
});
