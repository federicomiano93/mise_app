// «Copy day» and the note on each row, driven through the REAL Pastries page under node
// (js/pastries/pastries-main.js, the real stores, editor and day view), with the Firestore data layer
// and the dialog replaced by stand-ins (tests/helpers/load-pastries.mjs).
//
// What these prove: what the copy ASKS, what the editor opens WITH, and that NOTHING reaches the store
// until the editor's own Save. What they cannot show: layout, or how the picker looks in the dialog —
// that is the ui-check skill's job, on a real screen.

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDom, Node, walk } from './helpers/form-dom.mjs';
import { standIns, loadPastries } from './helpers/load-pastries.mjs';
import { WEEKDAYS, provingDayFor, otherWeekdays, weekdayLabel } from '../js/pastries/pastries-model.js';
import { t as say } from '../js/i18n.js';

const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise(r => setImmediate(r)); };

// The day the page opens on, worked out the same way the page does.
const FROM = provingDayFor(Date.now());
const NEXT = otherWeekdays(FROM)[0];
const OTHER = otherWeekdays(FROM)[2];

const SOURCE_ROWS = [{ name: 'Cornetti', qty: 24, note: '9x3' }, { name: 'Girelle', qty: 12 }];

const find = (root, cls) => walk(root).filter(n => n.classList && n.classList.contains(cls));
const editorOpen = screen => find(screen, 'pas-editrows').length > 0;

// The page's own elements (pastries.html), in the small fake DOM.
function pageDom() {
  installDom();
  Node.prototype.replaceChildren = function replaceChildren(...nodes) {
    this.children = [];
    this._text = null;
    nodes.forEach(n => this.appendChild(n));
  };
  // The editor's validate() looks rows up by class; the fake has no selector engine.
  Node.prototype.querySelector = function querySelector(selector) {
    const cls = String(selector).replace(/^\./, '');
    return walk(this).find(n => n !== this && n.classList.contains(cls)) || null;
  };
  const header = new Node('header');
  const ids = new Map();
  for (const id of ['pasScreen', 'pasStrip', 'pasTitle', 'pasSub', 'pasHome', 'pasBack', 'pasEdit',
    'pasSave', 'pasFooter', 'pasLogs', 'pasCopyDay', 'pasToast']) {
    ids.set(id, new Node(id === 'pasScreen' ? 'main' : 'button'));
  }
  ids.get('pasSave').closest = () => header;
  globalThis.document.getElementById = id => ids.get(id) || null;
  const stored = new Map();
  globalThis.localStorage = {
    getItem: k => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => { stored.set(k, String(v)); },
    removeItem: k => { stored.delete(k); },
  };
  return { ids, stored };
}

const cleanUp = (t) => t.after(() => { mock.timers.reset(); delete globalThis.document; delete globalThis.localStorage; });

// The page, with the seven days and tonight's confirmations answered. `days` maps a weekday to
// { items, note }; `confirmed` lists the weekdays already recorded tonight.
async function boot(name, t, { days = {}, confirmed = [], answered = true } = {}) {
  cleanUp(t);
  mock.timers.enable({ apis: ['setTimeout'] });
  const { ids, stored } = pageDom();
  const { fs, dialog } = await standIns(name);
  await loadPastries('pastries-main.js', name);
  await settle();
  if (answered) {
    fs.control.days[0].onChange(WEEKDAYS.map(day => ({
      id: day, day, items: (days[day] || {}).items || [], note: (days[day] || {}).note || '',
    })));
    const tonight = fs.control.dates.at(-1);
    tonight.onChange(confirmed.map(day => ({ id: `${tonight.date}_${day}`, day, date: tonight.date })));
    await settle();
  }
  return { ids, stored, fs, dialog, screen: ids.get('pasScreen') };
}

const tap = async (ids) => { ids.get('pasCopyDay').fire('click'); await settle(); };

// Answers each question by what it is. `pick` chooses a radio in the picker BEFORE it is answered
// (the stand-in answers at once, so the person's tap has to happen inside the answer).
function answers({ pick = null, replace = true, edit = true } = {}) {
  return (options) => {
    if (options.node) {
      if (pick) {
        const radio = walk(options.node).find(n => n.tagName === 'INPUT' && n.value === pick);
        radio.checked = true;
        radio.fire('change');
      }
      return true;
    }
    if (options.title === say('past.discardChanges')) return true;
    if (options.okLabel === say('ui.replace')) return replace;
    if (options.okLabel === say('ui.edit')) return edit;
    return true;
  };
}

const source = { [FROM]: { items: SOURCE_ROWS, note: 'SOURCE NOTE' } };

// ── The button ───────────────────────────────────────────────────────────────

test('tapped before the first answers: no dialog, says the list is still loading, no editor', async (t) => {
  const { ids, dialog, screen } = await boot('copy-early', t, { answered: false });
  await tap(ids);
  assert.equal(dialog.asked.length, 0);
  assert.equal(ids.get('pasToast').textContent, say('past.copyNotLoadedYet'));
  assert.equal(editorOpen(screen), false);
});

test('⚠️ the early message does not promise an editor that will never open by itself', async (t) => {
  const { ids } = await boot('copy-early-words', t, { answered: false });
  await tap(ids);
  assert.notEqual(ids.get('pasToast').textContent, say('past.listNotLoadedYet'));
});

test('the days answered but not tonight\'s confirmations: it still waits, or a recorded day would skip «Edit?»', async (t) => {
  const { ids, dialog, fs } = await boot('copy-half-answered', t, { answered: false });
  fs.control.days[0].onChange(WEEKDAYS.map(day => ({ id: day, day, items: SOURCE_ROWS, note: '' })));
  await settle();
  await tap(ids);
  assert.equal(dialog.asked.length, 0);
  assert.equal(ids.get('pasToast').textContent, say('past.copyNotLoadedYet'));
});

test('the real page carries the button the script attaches to', () => {
  assert.match(readFileSync(new URL('../pastries.html', import.meta.url), 'utf8'), /id="pasCopyDay"/);
});

test('Cancel on the picker opens nothing and writes nothing', async (t) => {
  const { ids, dialog, fs, screen } = await boot('copy-cancel', t, { days: source });
  dialog.settings.answer = options => !options.node;
  await tap(ids);
  assert.equal(dialog.asked.length, 1);
  assert.equal(editorOpen(screen), false);
  assert.equal(fs.control.saves.length, 0);
});

test('a source emptied by another phone during the questions opens nothing', async (t) => {
  const { ids, dialog, fs, screen } = await boot('copy-source-gone', t, { days: source, confirmed: [NEXT] });
  dialog.settings.answer = (options) => {
    if (options.okLabel === say('ui.edit')) {
      fs.control.days[0].onChange(WEEKDAYS.map(day => ({ id: day, day, items: [], note: '' })));
    }
    return true;
  };
  await tap(ids);
  assert.equal(editorOpen(screen), false);
  assert.equal(ids.get('pasToast').textContent, say('past.nothingToCopy', { day: weekdayLabel(FROM) }));
});

test('a target filled by another phone during the questions asks before replacing it', async (t) => {
  const { ids, dialog, fs, screen } = await boot('copy-target-filled', t, { days: source, confirmed: [NEXT] });
  dialog.settings.answer = (options) => {
    if (options.okLabel === say('ui.edit')) {
      fs.control.days[0].onChange(WEEKDAYS.map(day => ({
        id: day, day, items: day === FROM ? SOURCE_ROWS : [{ name: 'Krapfen', qty: 3 }], note: '',
      })));
      return true;
    }
    return options.okLabel !== say('ui.replace');
  };
  await tap(ids);
  assert.equal(dialog.asked.at(-1).okLabel, say('ui.replace'));
  assert.equal(editorOpen(screen), false, 'the «no» is respected');
});

test('an empty shown day says there is nothing to copy, and asks nothing', async (t) => {
  const { ids, dialog, screen } = await boot('copy-empty-source', t);
  await tap(ids);
  assert.equal(dialog.asked.length, 0);
  assert.equal(ids.get('pasToast').textContent, say('past.nothingToCopy', { day: weekdayLabel(FROM) }));
  assert.equal(editorOpen(screen), false);
});

// ── Onto an empty day ────────────────────────────────────────────────────────

test('onto an EMPTY day: one question, the target editor opens with the rows AND their notes, nothing is written', async (t) => {
  const { ids, dialog, fs, screen } = await boot('copy-to-empty', t, { days: source });
  dialog.settings.answer = answers();
  await tap(ids);

  assert.equal(dialog.asked.length, 1, 'the picker only: the target is empty, so nothing is replaced');
  const picker = dialog.asked[0];
  assert.equal(picker.title, say('past.copyDayQ', { day: weekdayLabel(FROM) }));
  const radios = walk(picker.node).filter(n => n.tagName === 'INPUT');
  assert.deepEqual(radios.map(r => r.value), otherWeekdays(FROM), 'six days, the next one first');
  assert.deepEqual(radios.map(r => r.checked), [true, false, false, false, false, false], 'the next day is preselected');

  assert.equal(editorOpen(screen), true);
  assert.equal(ids.get('pasTitle').textContent, say('past.editDay', { day: weekdayLabel(NEXT) }));
  assert.deepEqual(find(screen, 'pas-name').map(n => n.value), ['Cornetti', 'Girelle']);
  assert.deepEqual(find(screen, 'pas-qty').map(n => n.value), ['24', '12']);
  assert.deepEqual(find(screen, 'pas-item-note').map(n => n.value), ['9x3', '']);
  assert.equal(find(screen, 'pas-copied')[0].textContent, say('past.copiedFromDay', { day: weekdayLabel(FROM) }));
  assert.equal(fs.control.saves.length, 0, 'nothing reaches the store before the editor\'s own Save');
});

test('the picker shows how many pastries each day holds, and «Nothing» for an empty one', async (t) => {
  const days = { ...source, [OTHER]: { items: [{ name: 'Krapfen', qty: 3 }], note: '' } };
  const { ids, dialog } = await boot('copy-counts', t, { days });
  dialog.settings.answer = answers();
  await tap(ids);
  const counts = find(dialog.asked[0].node, 'pas-copy-day-count').map(n => n.textContent);
  const expected = otherWeekdays(FROM).map(d => (d === OTHER ? say('past.count', { n: 1 }) : say('past.copyDayNothing')));
  assert.deepEqual(counts, expected);
});

test('choosing a day other than the preselected one opens THAT day', async (t) => {
  const { ids, dialog, screen } = await boot('copy-pick', t, { days: source });
  dialog.settings.answer = answers({ pick: OTHER });
  await tap(ids);
  assert.equal(ids.get('pasTitle').textContent, say('past.editDay', { day: weekdayLabel(OTHER) }));
  assert.equal(editorOpen(screen), true);
});

// ── Onto a day that already has a list ───────────────────────────────────────

test('onto a day with quantities: the second question names target, source and count; «no» changes nothing', async (t) => {
  const days = { ...source, [NEXT]: { items: [{ name: 'A', qty: 1 }, { name: 'B', qty: 2 }, { name: 'C', qty: 3 }], note: '' } };
  // The target is also recorded tonight: answering «no» to replacing must not reach the edit question.
  const { ids, dialog, fs, stored, screen } = await boot('copy-replace-no', t, { days, confirmed: [NEXT] });
  dialog.settings.answer = answers({ replace: false });
  await tap(ids);

  assert.equal(dialog.asked.length, 2, 'the picker, then the replace question — and no edit question');
  const q = dialog.asked[1];
  assert.equal(q.title, say('past.copyReplaceQ', { day: weekdayLabel(NEXT) }));
  assert.equal(q.message, say('past.copyReplaces', { n: 3, day: weekdayLabel(NEXT), from: weekdayLabel(FROM) }));
  assert.equal(editorOpen(screen), false, 'still on the day screen');
  assert.equal(fs.control.saves.length, 0);
  assert.equal([...stored.keys()].some(k => k.startsWith('pastries-edit-')), false, 'no permission to edit was stored');
});

test('a single pastry on the target is named in the singular', async (t) => {
  const days = { ...source, [NEXT]: { items: [{ name: 'A', qty: 1 }], note: '' } };
  const { ids, dialog } = await boot('copy-replace-one', t, { days });
  dialog.settings.answer = answers({ replace: false });
  await tap(ids);
  assert.equal(dialog.asked[1].message, say('past.copyReplaces', { n: 1, day: weekdayLabel(NEXT), from: weekdayLabel(FROM) }));
  assert.match(dialog.asked[1].message, /1 (pastry|pasta)\b/);
});

test('«yes» to replacing opens the editor with the SOURCE rows in place of the target\'s', async (t) => {
  const days = { ...source, [NEXT]: { items: [{ name: 'Old', qty: 1 }], note: '' } };
  const { ids, dialog, screen } = await boot('copy-replace-yes', t, { days });
  dialog.settings.answer = answers();
  await tap(ids);
  assert.equal(dialog.asked.length, 2);
  assert.deepEqual(find(screen, 'pas-name').map(n => n.value), ['Cornetti', 'Girelle']);
});

test('the target\'s own standing note is kept in the editor; the source\'s is not brought across', async (t) => {
  const days = { ...source, [NEXT]: { items: [], note: 'TARGET NOTE' } };
  const { ids, dialog, screen } = await boot('copy-notes', t, { days });
  dialog.settings.answer = answers();
  await tap(ids);
  assert.equal(find(screen, 'pas-note-input')[0].textContent, 'TARGET NOTE');
});

// ── A day recorded tonight ───────────────────────────────────────────────────

test('a recorded target asks the edit question too, and «no» opens nothing', async (t) => {
  const { ids, dialog, stored, screen } = await boot('copy-locked-no', t, { days: source, confirmed: [NEXT] });
  dialog.settings.answer = answers({ edit: false });
  await tap(ids);
  assert.equal(dialog.asked.length, 2, 'the picker, then «Edit?»');
  assert.equal(dialog.asked[1].title, say('past.editDayQ', { day: weekdayLabel(NEXT) }));
  assert.equal(editorOpen(screen), false);
  assert.equal([...stored.keys()].some(k => k.startsWith('pastries-edit-')), false);
});

test('a recorded target with «yes» to editing opens the editor', async (t) => {
  const { ids, dialog, screen } = await boot('copy-locked-yes', t, { days: source, confirmed: [NEXT] });
  dialog.settings.answer = answers({ edit: true });
  await tap(ids);
  assert.equal(editorOpen(screen), true);
});

// ── Through Save, and Back ───────────────────────────────────────────────────

test('Save writes the TARGET day: the copied rows with notes, no note key on a plain row, the target\'s own note', async (t) => {
  const days = { ...source, [NEXT]: { items: [], note: 'TARGET NOTE' } };
  const { ids, dialog, fs } = await boot('copy-save', t, { days });
  dialog.settings.answer = answers();
  await tap(ids);
  ids.get('pasSave').fire('click');
  await settle();
  assert.equal(fs.control.saves.length, 1);
  const [saved] = fs.control.saves;
  assert.equal(saved.day, NEXT);
  assert.deepEqual(saved.items, [{ name: 'Cornetti', qty: 24, note: '9x3' }, { name: 'Girelle', qty: 12 }]);
  assert.equal('note' in saved.items[1], false);
  assert.equal(saved.note, 'TARGET NOTE');
  assert.equal(ids.get('pasTitle').textContent, weekdayLabel(NEXT), 'Save lands on the target day');
});

test('Back from a copied editor asks «Discard?» straight away, and returns to the SOURCE day', async (t) => {
  const { ids, dialog, screen } = await boot('copy-back', t, { days: source });
  dialog.settings.answer = answers();
  await tap(ids);
  const before = dialog.asked.length;
  ids.get('pasBack').fire('click');
  await settle();
  assert.equal(dialog.asked.length, before + 1);
  assert.equal(dialog.asked.at(-1).title, say('past.discardChanges'));
  assert.equal(editorOpen(screen), false);
  assert.equal(ids.get('pasTitle').textContent, weekdayLabel(FROM));
});

test('a «no» at Save in a copied editor writes nothing and stays there', async (t) => {
  const { ids, dialog, fs, screen } = await boot('copy-save-no', t, { days: source });
  dialog.settings.answer = (o) => (o.okLabel === say('ui.save') ? false : answers()(o));
  await tap(ids);
  ids.get('pasSave').fire('click');
  await settle();
  assert.equal(dialog.asked.at(-1).okLabel, say('ui.save'));
  assert.equal(fs.control.saves.length, 0);
  assert.equal(editorOpen(screen), true);
});

test('a copied editor names itself: the panel no longer points at the source day\'s tab', async (t) => {
  const { ids, dialog, screen } = await boot('copy-panel-name', t, { days: source });
  assert.equal(screen.getAttribute('aria-labelledby'), `pas-tab-${FROM}`);
  dialog.settings.answer = answers();
  await tap(ids);
  assert.equal(screen.getAttribute('aria-labelledby') ?? null, null);
});

test('a «no» to Discard keeps the copied editor open', async (t) => {
  const { ids, dialog, screen } = await boot('copy-back-no', t, { days: source });
  dialog.settings.answer = (o) => (o.title === say('past.discardChanges') ? false : answers()(o));
  await tap(ids);
  ids.get('pasBack').fire('click');
  await settle();
  assert.equal(editorOpen(screen), true);
});

// ── The note on a row ────────────────────────────────────────────────────────

test('the day shows a row\'s note, and a row without one has no such node', async (t) => {
  const { screen } = await boot('note-day', t, { days: source });
  assert.equal(find(screen, 'pas-row-note').length, 1);
  assert.equal(find(screen, 'pas-row-note')[0].textContent, '9x3');
  const [withNote, plain] = find(screen, 'pas-row-main');
  assert.equal(withNote.children.length, 3, 'name, note, quantity');
  assert.equal(plain.children.length, 2, 'name, quantity: exactly what a row drew before notes existed');
});

test('the editor loads an existing note into its field and saves a changed one back', async (t) => {
  const { ids, dialog, fs, screen } = await boot('note-editor', t, { days: source });
  ids.get('pasEdit').fire('click');
  await settle();
  const [first, second] = find(screen, 'pas-item-note');
  assert.equal(first.value, '9x3');
  assert.equal(find(screen, 'pas-copied').length, 0, 'an ordinary edit has no «copied» line');
  second.value = '4x6';
  second.fire('input');
  first.value = '';
  first.fire('input');
  ids.get('pasSave').fire('click');
  await settle();
  assert.equal(dialog.asked.length, 1);
  assert.deepEqual(fs.control.saves[0].items, [{ name: 'Cornetti', qty: 24 }, { name: 'Girelle', qty: 12, note: '4x6' }]);
});

test('typing only a note counts as unsaved work: Back asks before losing it', async (t) => {
  const { ids, dialog, screen } = await boot('note-dirty', t, { days: source });
  ids.get('pasEdit').fire('click');
  await settle();
  const [first] = find(screen, 'pas-item-note');
  first.value = '4x6';
  first.fire('input');
  ids.get('pasBack').fire('click');
  await settle();
  assert.equal(dialog.asked.at(-1)?.title, say('past.discardChanges'));
});

test('the Records screen shows a row\'s note, and a row without one has no such node', async (t) => {
  cleanUp(t);
  installDom();
  const { renderLogs } = await loadPastries('pastries-logs.js', 'note-records');
  const { node } = renderLogs({
    app: {},
    logs: [{ id: '2026-08-05_Monday', date: '2026-08-05', day: 'Monday', note: '', items: SOURCE_ROWS }],
  });
  const notes = find(node, 'pas-log-item-note');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].textContent, '9x3');
  assert.equal(find(node, 'pas-log-row').length, 2);
});

test('the note field is named after its pastry, and a row with only a note asks before it is removed', async (t) => {
  const { ids, dialog, screen } = await boot('note-aria', t, { days: source });
  ids.get('pasEdit').fire('click');
  await settle();
  const [first] = find(screen, 'pas-item-note');
  assert.equal(first.getAttribute('aria-label'), say('past.itemNoteFor', { name: 'Cornetti' }));
  assert.equal(first.getAttribute('maxlength'), '40');

  find(screen, 'pas-add-row')[0].fire('click');
  const fields = find(screen, 'pas-item-note');
  const blank = fields.at(-1);
  assert.equal(blank.getAttribute('aria-label'), say('past.itemNote'));
  blank.value = 'only a note';
  blank.fire('input');
  const before = dialog.asked.length;
  const bins = find(screen, 'pas-del-icon');
  bins.at(-1).fire('click');
  await settle();
  assert.equal(dialog.asked.length, before + 1, 'something was typed in the row, so removing it asks');
});

test('the quick quantity tick writes the row\'s note unchanged', async () => {
  const { fs } = await standIns('note-tick');
  const store = await loadPastries('pastries-store.js', 'note-tick');
  store.initPastries(() => {});
  await settle();
  fs.control.days[0].onChange(WEEKDAYS.map(day => ({
    id: day, day, items: day === 'Tuesday' ? SOURCE_ROWS : [], note: '',
  })));
  assert.equal(store.setItemQuantity('Tuesday', 0, 'Cornetti', 30), true);
  assert.deepEqual(fs.control.saves[0].items, [{ name: 'Cornetti', qty: 30, note: '9x3' }, { name: 'Girelle', qty: 12 }]);
});
