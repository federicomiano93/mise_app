// The Export dialog (js/export-sheet.js), EXECUTED against the project's small fake DOM
// (tests/helpers/form-dom.mjs): one at a time, a late result after Close does nothing, a failure is
// shown (and reported with fixed words) instead of thrown, the ready state's order and its Share rule.
// It proves what the dialog decides, not how it looks (the ui-check skill measures that).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installDom, Node, walk } from './helpers/form-dom.mjs';
import { t } from '../js/i18n.js';
import { SIX } from './fixtures/recipe-export-fixtures.mjs';

// The shared fake has a read-only .type; the dialog sets button.type = 'button' like a browser allows.
const typeGetter = Object.getOwnPropertyDescriptor(Node.prototype, 'type').get;
Object.defineProperty(Node.prototype, 'type', { get: typeGetter, set(v) { this.attributes.type = String(v); }, configurable: true });

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
let handlers;
let created;
let realCreate;
let realError;
let reports;

beforeEach(() => {
  installDom();
  handlers = [];
  const doc = globalThis.document;
  doc.body = new Node('body');
  doc.createElementNS = (ns, tag) => new Node(tag);
  doc.addEventListener = (type, fn) => handlers.push([type, fn]);
  doc.removeEventListener = (type, fn) => { handlers = handlers.filter(h => h[1] !== fn); };
  created = 0;
  realCreate = URL.createObjectURL;
  URL.createObjectURL = (blob) => { created += 1; return realCreate.call(URL, blob); };
  reports = [];
  realError = console.error;
  console.error = (...args) => { reports.push(args); };
});

afterEach(() => {
  URL.createObjectURL = realCreate;
  console.error = realError;
  delete globalThis.document;
  if (realNavigator) Object.defineProperty(globalThis, 'navigator', realNavigator); else delete globalThis.navigator;
});

const press = key => handlers.filter(h => h[0] === 'keydown').forEach(h => h[1]({ key, preventDefault() {}, shiftKey: false }));
const texts = () => walk(globalThis.document.body).map(n => n.textContent);
const find = (pred) => walk(globalThis.document.body).find(pred);
const until = async (pred, ms = 5000) => {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error('timed out waiting for the dialog');
    await new Promise(r => setTimeout(r, 10));
  }
};
const routes = () => walk(globalThis.document.body).filter(n => n.classList.contains('send-route'));

async function open(extra = {}) {
  const { openExportSheet } = await import('../js/export-sheet.js');
  openExportSheet({ model: { ...SIX, ...extra }, totalLabel: 'Impasto totale', opener: new Node('button') });
}

test('one dialog at a time; Escape closes it and a new one can open', async () => {
  await open();
  await open();
  assert.equal(globalThis.document.body.children.length, 1);
  assert.equal(routes().length, 2);
  press('Escape');
  assert.equal(globalThis.document.body.children.length, 0);
  await open();
  assert.equal(globalThis.document.body.children.length, 1);
  press('Escape');
});

test('a file that finishes AFTER Close does nothing: no dialog comes back, no address is made', async () => {
  await open();
  routes()[0].fire('click');
  assert.ok(texts().includes(t('export.preparing')) || find(n => n.attributes.role === 'status'));
  press('Escape');
  await new Promise(r => setTimeout(r, 400));
  assert.equal(globalThis.document.body.children.length, 0);
  assert.equal(created, 0);
});

test('a failed build is shown inside the dialog, reported with fixed words, and never thrown', async () => {
  await open({ name: 'Torta di prova segreta', rows: undefined });
  routes()[0].fire('click');
  await until(() => find(n => n.attributes.role === 'alert'));
  const alert = find(n => n.attributes.role === 'alert');
  assert.equal(alert.textContent, t('export.failed'));
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], ['Recipe export failed:', 'pdf', 'build']);
  assert.ok(!JSON.stringify(reports).includes('segreta'));
  assert.ok(find(n => n.tagName === 'BUTTON' && n.textContent === t('export.close')));
  press('Escape');
});

test('Excel is ready as a real link first, then Close; no Share for an .xlsx; the actions stack', async () => {
  await open();
  routes()[1].fire('click');
  await until(() => find(n => n.tagName === 'A'));
  const link = find(n => n.tagName === 'A');
  assert.equal(link.download, 'Impasto_di_prova_24000g.xlsx');
  assert.ok(link.href.startsWith('blob:'));
  const actions = link.parentNode;
  assert.ok(actions.classList.contains('export-actions'));
  assert.deepEqual(actions.children.map(c => c.textContent), [t('export.download'), t('export.close')]);
  assert.ok(!texts().includes(t('export.share')));
  press('Escape');
});

test('the PDF offers Share only when the browser can share THAT file, and shares a file and a title only', async () => {
  const shared = [];
  Object.defineProperty(globalThis, 'navigator', {
    value: { canShare: ({ files }) => files.length === 1, share: async (data) => { shared.push(data); } },
    configurable: true,
  });
  await open();
  routes()[0].fire('click');
  await until(() => find(n => n.tagName === 'A'));
  const actions = find(n => n.tagName === 'A').parentNode;
  assert.deepEqual(actions.children.map(c => c.textContent), [t('export.download'), t('export.share'), t('export.close')]);
  actions.children[1].fire('click');
  await until(() => shared.length === 1);
  assert.deepEqual(Object.keys(shared[0]).sort(), ['files', 'title']);
  assert.equal(shared[0].files[0].name, 'Impasto_di_prova_24000g.pdf');
  assert.equal(shared[0].files[0].type, 'application/pdf');
  press('Escape');
});

test('a browser that cannot share files shows no Share button', async () => {
  Object.defineProperty(globalThis, 'navigator', { value: { canShare: () => false, share: async () => {} }, configurable: true });
  await open();
  routes()[0].fire('click');
  await until(() => find(n => n.tagName === 'A'));
  assert.ok(!texts().includes(t('export.share')));
  press('Escape');
});
