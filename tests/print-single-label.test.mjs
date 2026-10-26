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

// ⚠️ A label for three loaves may ask for three copies; ^PQ99999 would run a whole roll
// through the printer (code review, 23 Sep 2026).
test('a label may ask for a few copies, never a roll', () => {
  assert.equal(isSingleLabel('^XA^FDx^FS^PQ3^XZ'), true);
  assert.equal(isSingleLabel('^XA^FDx^FS^PQ99^XZ'), true);
  assert.equal(isSingleLabel('^XA^FDx^FS^PQ100^XZ'), false);
  assert.equal(isSingleLabel('^XA^FDx^FS^PQ99999^XZ'), false);
  assert.equal(isSingleLabel('^XA^FDx^FS^PQ2^PQ2^XZ'), false, 'one ^PQ per label');
  assert.equal(isSingleLabel('^XA^FDx^FS^PQ^XZ'), false, 'a ^PQ with no number is not a count');
  // And the app never makes one the agent would refuse.
  assert.equal(isSingleLabel(zpl({}, {}, { copies: 5000 })), true);
});

// ── The «with logo» label of Mise 2: a picture, as Z64 ───────────────────────
//
// ⚠️ ^GF, ^PO and ^PR are on the list for the image label (shared/src/zpl-z64.ts), and each
// only in the one shape that label writes. The payload here is built the way that module
// builds it — zlib, Base64, CRC-16/XMODEM — so the agent's half is pinned without
// importing TypeScript; shared/src/print-queue-model.spec.ts feeds the real writer's output
// to this same function.
import { deflateSync } from 'node:zlib';

const crc16 = (text) => {
  let crc = 0;
  for (let i = 0; i < text.length; i++) {
    crc ^= (text.charCodeAt(i) & 0xff) << 8;
    for (let b = 0; b < 8; b++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
};
const z64 = (bytes) => {
  const b64 = deflateSync(bytes).toString('base64');
  return `:Z64:${b64}:${crc16(b64)}`;
};
const imageJob = ({ field = z64(Buffer.alloc(80 * 480)), po = 'I', pr = '2', copies = 1 } = {}) => [
  '^XA', '^PW640', '^LL480', '^LH0,0', `^PO${po}`, `^PR${pr}`, `^PQ${copies}`,
  `^FO0,0^GFA,38400,38400,80,${field}^FS`, '^XZ',
].join('\n') + '\n';

test('the image label passes, turned round or not, with copies', () => {
  const dots = Buffer.alloc(80 * 480);
  for (let i = 0; i < dots.length; i += 7) dots[i] = 0xa5;
  assert.equal(isSingleLabel(imageJob({ field: z64(dots) })), true);
  assert.equal(isSingleLabel(imageJob({ po: 'N' })), true);
  assert.equal(isSingleLabel(imageJob({ copies: 99 })), true);
});

test('…and a ^GF, ^PO or ^PR in any other shape is refused', () => {
  for (const [what, payload] of [
    ['a picture in plain hex', imageJob({ field: 'FFFF00' })],
    ['a picture as raw bytes', '^XA^FO0,0^GFB,2,2,1,ab^FS^XZ'],
    ['a picture with no check digits', imageJob({ field: ':Z64:eJwDAAAAAAE=' })],
    ['a picture with something after it', imageJob({ field: `${z64(Buffer.alloc(8))}JUS` })],
    ['a stored graphic (^GFA is never a download)', '^XA^GFA,1,1,1,:Z64:AA==:0000,R:LOGO.GRF^FS^XZ'],
    ['an orientation the app never writes', imageJob({ po: 'R' })],
    ['an orientation with more after it', imageJob({ po: 'I,JUS' })],
    ['a speed that is not a number', imageJob({ pr: 'A' })],
    ['a speed with a command tucked behind it', imageJob({ pr: '2JUS' })],
    ['the darkness, which belongs to the agent', `~SD28\n${imageJob()}`],
  ]) assert.equal(isSingleLabel(payload), false, `${what} was let through`);
});
