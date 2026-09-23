// Only a label reaches the printer (security audit, 23 Sep 2026).
//
// ⚠️ WHAT WAS WRONG: the agent on the shop computer sent whatever the print queue held,
// and any member may queue a job. A ZPL printer obeys setup commands as readily as
// labels — ~JR resets it, ^JUS saves settings over the ones it was set up with.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isSingleLabel, LABEL_COMMANDS, MAX_JOB_CHARS } from '../js/print-queue-model.js';
import { toZpl } from '../js/catalogue/label-zpl.js';
import { resolveLabel, DEFAULT_PROFILE } from '../js/catalogue/label-template-model.js';

const ing = (name, emphasise = false) => ({ id: name, name, grams: 100, allergens: [], emphasise });
const label = (over = {}) => ({
  ok: true, reason: null, shows: 'allergens',
  name: 'Pane semplice',
  ingredients: [ing('Farina 0', true), ing('Acqua')],
  allergens: ['gluten-wheat'], mayContain: [], nutrition: null, nutritionMissing: false,
  ...over,
});
const zpl = (over = {}, profile = {}, opts) =>
  toZpl(resolveLabel(label(over), { ...DEFAULT_PROFILE, printerLanguage: 'zpl', ...profile }, {}, 'it'), opts);

// ── Every label the app makes passes ─────────────────────────────────────────

test('a label the app makes is a single label', () => {
  const out = zpl();
  assert.ok(out.startsWith('^XA'), 'the fixture did not produce a label at all');
  assert.equal(isSingleLabel(out), true);
});

test('…at the other resolution, with copies, and with the three characters ZPL reserves in the text', () => {
  assert.equal(isSingleLabel(zpl({}, { dpi: 300 })), true);
  assert.equal(isSingleLabel(zpl({}, {}, { copies: 3 })), true, '^PQ is how copies are asked for');
  const tricky = zpl({ name: 'Aroma ~ naturale ^ al 100_%', ingredients: [ing('Sale ~ fino')] });
  assert.equal(isSingleLabel(tricky), true, 'a product called «Aroma ~ naturale» must still print');
});

test('every command the app writes is on the list, so the list cannot fall behind silently', () => {
  const out = zpl({}, {}, { copies: 2 });
  const used = new Set([...out.matchAll(/\^([A-Z0-9]{2})/g)].map(m => m[1]));
  for (const c of used) assert.ok(LABEL_COMMANDS.includes(c), `label-zpl.js writes ^${c}, which the agent would refuse`);
});

// ── Anything else is refused ─────────────────────────────────────────────────

test('a printer command that is not a label is refused', () => {
  for (const [what, payload] of [
    ['a reset', '~JR'],
    ['a reset inside a label', '^XA\n^FDPane^FS\n~JR\n^XZ'],
    ['settings saved over the set-up ones', '^XA^JUS^XZ'],
    ['the same in lower case, which a printer also obeys', '^xa^jus^xz'],
    ['the command character changed', '^XA^CC!^XZ'],
    ['a configuration label', '~WC'],
    ['two labels in one job', '^XA^FDone^FS^XZ^XA^FDtwo^FS^XZ'],
    ['a label with no end', '^XA^FDPane^FS'],
    ['text before the label', 'hello^XA^FDPane^FS^XZ'],
  ]) assert.equal(isSingleLabel(payload), false, `${what} was let through`);
});

test('nothing that is not text gets through, and nothing too big', () => {
  for (const v of [null, undefined, 42, {}, ['^XA^XZ'], '']) assert.equal(isSingleLabel(v), false);
  assert.equal(isSingleLabel('^XA^FD' + 'x'.repeat(MAX_JOB_CHARS) + '^FS^XZ'), false);
});

// ── The agent asks before it prints ──────────────────────────────────────────

test('the agent checks the job BEFORE sending it, and marks a refused job failed', () => {
  const src = readFileSync(new URL('../print-agent/agent.mjs', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n').replace(/^\s*\/\/.*$/gm, '');
  const checkAt = src.indexOf('if (!isSingleLabel(job.payload))');
  const printAt = src.indexOf('await printJob(cfg, job.payload)');
  assert.ok(checkAt !== -1, 'the agent never asks whether the job is a label');
  assert.ok(printAt > checkAt, 'the check must come before the job is sent to the printer');
  assert.match(src.slice(checkAt, printAt), /finish\(app, session, job, false,/,
    'a refused job must be marked failed, or it would sit claimed for ever');
});
