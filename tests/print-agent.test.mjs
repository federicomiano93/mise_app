// The program on the shop computer.
//
// ⚠️ MOST OF IT CANNOT BE TESTED HERE and this file says so rather than pretending
// otherwise: it talks to Firestore over the network and to a printer over a Windows
// share. What CAN be pinned is the part that would fail silently — the shapes it
// puts on the wire, the fact that it shares the queue's rules rather than copying
// them, and the fact that it never carries a credential inside this repository.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const codeOf = src => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const AGENT = 'print-agent/agent.mjs';

// ── The duplicate that must not exist ────────────────────────────────────────

test('⚠️⚠️ the agent IMPORTS the queue rules — it does not carry a copy of them', async () => {
  // functions/push-model.js is a byte-for-byte copy of js/push-model.js because a
  // deploy uploads only functions/, and this project calls it its most dangerous
  // duplicate: the halves run in different places, so no amount of using the app
  // reveals that they have parted. The agent has no such excuse — it runs from a
  // checkout of this repository — so it imports the real file.
  const src = codeOf(read(AGENT));
  assert.match(src, /from '\.\.\/js\/print-queue-model\.js'/,
    'the agent must import the queue model, never restate it');

  const files = readdirSync(new URL('../print-agent/', import.meta.url));
  assert.ok(!files.includes('print-queue-model.js'),
    'a copy of the queue model has appeared in print-agent/ — that is the duplicate this test exists to prevent');
});

test('the agent adds no dependencies to this project', async () => {
  // A dependency tree on a shop computer is one nobody will ever update. The whole
  // program is plain Node, and this is what keeps it that way.
  const files = readdirSync(new URL('../print-agent/', import.meta.url));
  assert.ok(!files.includes('package.json'), 'print-agent must stay dependency-free');
  const src = codeOf(read(AGENT));
  for (const line of src.split('\n')) {
    const m = line.match(/^import .* from '([^']+)'/);
    if (!m) continue;
    const from = m[1];
    assert.ok(from.startsWith('node:') || from.startsWith('.'),
      `the agent imports "${from}" — only Node's own modules and files in this repo are allowed`);
  }
});

// ── Credentials ──────────────────────────────────────────────────────────────

test('⚠️⚠️ no credentials file can live inside this repository', () => {
  // Everything in here is served by GitHub Pages. A password committed beside the
  // code is a password on the web.
  assert.ok(!existsSync(new URL('../print-agent/print-agent.json', import.meta.url)),
    'print-agent/print-agent.json exists — that file belongs in %LOCALAPPDATA%, never here');
  const src = codeOf(read(AGENT));
  assert.match(src, /LOCALAPPDATA/, 'the settings file must default to outside the repository');
});

test('the example settings file carries no real password', () => {
  const example = read('print-agent/print-agent.example.json');
  assert.match(example, /"password": "the password/, 'the example must stay an example');
  assert.ok(!/AIza/.test(example), 'no api key belongs in the example either');
});

test('⚠️ the agent reads the project s public config out of the app, never a copy', () => {
  // Two copies of a project id is two things to change when a project moves, and the
  // one that gets forgotten is the one on a computer in a back room.
  // The file it reads moved with the preview project (30 Sep 2026); that the read actually
  // WORKS is tests/print-agent-config.test.mjs — this shape check alone stayed green while
  // the agent could no longer find its key.
  const src = codeOf(read(AGENT));
  assert.match(src, /join\(REPO, 'js', 'firebase-target\.js'\)/);
  assert.match(src, /export const PRODUCTION_CONFIG/);
  assert.ok(!/bakery-app-ebf90/.test(src), 'the project id must not be written into the agent');
  assert.ok(!/AIzaSy/.test(src), 'the api key must not be written into the agent');
});

// ── The shapes it puts on the wire ───────────────────────────────────────────

test('Firestore s value shapes survive a round trip', async () => {
  const { encode, decode, toDoc, fromDoc } = await import('../print-agent/agent.mjs');
  for (const v of ['a string', '', true, false, 7, -3, 1.5]) {
    assert.deepEqual(decode(encode(v)), v, `${JSON.stringify(v)} did not survive`);
  }
  // ⚠️ AN INTEGER GOES OUT AS A STRING, which is Firestore's REST shape and not a
  // mistake — sending it as a number is refused with a type error that names nothing.
  assert.deepEqual(encode(3), { integerValue: '3' });
  assert.deepEqual(encode(1.5), { doubleValue: 1.5 });
  assert.deepEqual(fromDoc({ fields: toDoc({ status: 'queued', copies: 2 }) }), { status: 'queued', copies: 2 });
});

test('a field type the agent does not understand becomes null, not rubbish', () => {
  // Better an empty value the code can check than a half-decoded object it cannot.
  return import('../print-agent/agent.mjs').then(({ decode }) => {
    assert.equal(decode({ timestampValue: '2026-09-03T10:00:00Z' }), null);
    assert.equal(decode(undefined), null);
    assert.equal(decode({}), null);
  });
});

// ── The two things that would fail in silence ────────────────────────────────

test('⚠️⚠️ the claim is CONDITIONAL, or two agents print the same label', () => {
  // The write carries the document's own updateTime; if another agent touched it
  // first the server refuses this one outright.
  const src = codeOf(read(AGENT));
  assert.match(src, /currentDocument: \{ updateTime: job\._updateTime \}/,
    'without the precondition both agents claim the same job and both print it');
  // And losing that race is the system working, not an error to report.
  assert.match(src, /status === 409 \|\| status === 412/);
});

test('⚠️⚠️ the claim goes through :commit, NEVER through a REST PATCH', () => {
  // Two separate things went wrong with the PATCH form, and both were silent:
  //   1. the `currentDocument.updateTime` query parameter never reached the server
  //      («required base version (0)»), so the one lock against two agents printing
  //      the same label was not there at all;
  //   2. a PATCH may create, so Firestore ran this collection's CREATE rule against
  //      a document that already existed — an EVALUATION ERROR, which comes back as
  //      403 and is indistinguishable from an ordinary permission refusal.
  // Proved against the emulator three ways: a stale precondition is refused, the
  // current one succeeds, and a second agent reusing it is refused.
  const src = codeOf(read(AGENT));
  assert.match(src, /documents:commit/);

  // ⚠️ SCOPED TO THE JOB WRITES, not to the whole file. The heartbeat is genuinely a
  // create-or-update — the first beat creates the document — so a PATCH is the right
  // verb there, and banning it everywhere would be a rule nobody could keep. What
  // must never go back to PATCH is a write that carries a precondition.
  const jobWrites = src.slice(src.indexOf('async function commitWrite'), src.indexOf('async function beat'));
  assert.ok(jobWrites.length > 200, 'the agent no longer has the shape this test reads');
  assert.ok(!/method: 'PATCH'/.test(jobWrites),
    'a PATCH has come back into the job writes — see the note above claim()');
  assert.match(jobWrites, /currentDocument/, 'and the precondition must still be there');
});

test('⚠️⚠️ the copy to the printer checks its exit code', () => {
  // A copy to a share that does not exist fails quietly enough to look like success
  // if nobody asks — the job would be marked printed and no paper would appear.
  const src = codeOf(read(AGENT));
  assert.match(src, /p\.on\('close', \(code\) => \{/);
  assert.match(src, /if \(code === 0\) resolve\(\);/);
  assert.match(src, /else reject\(/);
});

test('⚠️ one failure does not stop the program', () => {
  // A shop computer loses its network several times a day. An agent that exits on
  // the first hiccup is one somebody has to notice and restart, and nobody is
  // watching that window.
  const src = codeOf(read(AGENT));
  const loop = src.slice(src.indexOf('for (;;)'));
  assert.match(loop, /try \{/);
  assert.match(loop, /\} catch \(err\) \{/);
});

test('⚠️ the agent never reports a job as printed before the paper command returned', () => {
  const src = codeOf(read(AGENT));
  const printed = src.indexOf('await printJob(cfg, job.payload);');
  const marked = src.indexOf('await finish(app, session, job, true);');
  assert.ok(printed !== -1 && marked !== -1 && printed < marked,
    'finish(true) must come after printJob(), or a failed print is recorded as done');
});

// ── What the README has to keep saying ───────────────────────────────────────

test('⚠️ the setup guide keeps the two facts somebody will otherwise learn the hard way', () => {
  const readme = read('print-agent/README.md');
  assert.match(readme, /never «printed»|never \*\*«printed»\*\*|never .printed./i,
    'it must say the app can only confirm SENT, because raw bytes come back with nothing');
  assert.match(readme, /share/i);
  assert.match(readme, /rendered|as text/i,
    'it must say why the printer is shared — the driver would print the codes as text');
});

test('⚠️⚠️ the agent can be pointed at the emulator, and says which it is talking to', () => {
  // Without this the only way to try the program is against the REAL database — the
  // same trap as the Cloud Functions calls that ran against production from a page
  // whose console said «LOCAL EMULATOR mode». This project has paid for that lesson
  // three times.
  const src = codeOf(read(AGENT));
  assert.match(src, /MISE_AGENT_EMULATOR/);
  assert.match(src, /LOCAL EMULATOR/, 'and the window must say which database it is on');
  // ⚠️ AN ENVIRONMENT VARIABLE, NEVER A SETTING IN THE FILE: settings files are
  // copied from machine to machine, and a shop computer that inherited «emulator»
  // from somebody's test would print nothing and explain nothing.
  assert.ok(!/cfg\.emulator|config\.emulator/.test(src),
    'the emulator switch must not be readable from the settings file');
});

// ── The bytes the printer reads ──────────────────────────────────────────────
//
// ⚠️⚠️ ^CI28 TELLS THE PRINTER «UTF-8», SO UTF-8 IS WHAT MUST ARRIVE. Until 14 Oct
// 2026 the agent wrote latin1: «Può» reached the Zebra as 50 75 F2, which is not
// UTF-8, and € was cut to a single wrong byte. Nothing failed — the label simply
// printed wrong — so the bytes on the wire are pinned here, not the source text.

const ACCENTED = '^XA^CI28^FO10,10^FH^FDPuò contenere: œufs, 2,50 €^FS^XZ';

test('⚠️⚠️ a label sent to a network printer arrives as UTF-8', async () => {
  const net = await import('node:net');
  const { printToTcp } = await import('../print-agent/agent.mjs');

  const received = [];
  const server = net.createServer((sock) => {
    sock.on('data', (d) => received.push(d));
    sock.on('error', () => {}); // a failed send must fail the test, not crash the run
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    await printToTcp('127.0.0.1', port, ACCENTED);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  const bytes = Buffer.concat(received);
  assert.deepEqual(bytes, Buffer.from(ACCENTED, 'utf8'));
  assert.ok(bytes.includes(Buffer.from([0x50, 0x75, 0xC3, 0xB2])), '«Può» must be 50 75 C3 B2');
  assert.ok(bytes.includes(Buffer.from([0xE2, 0x82, 0xAC])), '€ must be E2 82 AC');
  // And it decodes back without a single replacement character.
  assert.equal(new TextDecoder('utf-8', { fatal: true }).decode(bytes), ACCENTED);
});

test('⚠️⚠️ a label copied to a shared printer is written as UTF-8 too', async () => {
  // The copy itself needs Windows and a real share, so it cannot run here. What can
  // be pinned is that both paths go through the one encoder and that it is UTF-8.
  const { labelBytes } = await import('../print-agent/agent.mjs');
  assert.deepEqual(labelBytes(ACCENTED), Buffer.from(ACCENTED, 'utf8'));

  const src = codeOf(read(AGENT));
  const share = src.slice(src.indexOf('async function printToShare'), src.indexOf('function printToTcp'));
  assert.ok(share.length > 100, 'the agent no longer has the shape this test reads');
  assert.match(share, /await writeFile\(file, labelBytes\(text\)\);/,
    'the file copied to the share must be the UTF-8 bytes');
  const tcp = src.slice(src.indexOf('function printToTcp'), src.indexOf('async function printJob'));
  assert.match(tcp, /socket\.end\(labelBytes\(text\)\)/);
  assert.ok(!/'binary'|'latin1'/.test(src), 'latin1 has come back into the agent');
});

test('⚠️⚠️ no letter can turn into a printer command on the wire', async () => {
  // isSingleLabel() reads the string; the printer reads the bytes. Under latin1 «ž»
  // became 0x7E (~, a control command) and «Ş» 0x5E (^). In UTF-8 a non-ASCII letter
  // never produces a byte below 0x80, so the filter and the printer agree.
  const { labelBytes } = await import('../print-agent/agent.mjs');
  const bytes = [...labelBytes('^XA^CI28^FH^FDžJR Ş^FS^XZ')];
  assert.equal(bytes.filter(b => b === 0x7E).length, 0, 'a ~ appeared on the wire');
  assert.equal(bytes.filter(b => b === 0x5E).length, 6, 'only the six ^ the label really has');
});

// ── The darkness (image labels 1b, 26 Oct 2026) ──────────────────────────────
//
// ⚠️⚠️ IT COMES FROM THIS COMPUTER'S SETTINGS, NEVER FROM A JOB: a tilde in the queue is
// refused by the rules and by isSingleLabel, so `printer.darkness` is the one road.

test('⚠️⚠️ the darkness is the agent s own setting, sent in front of the job', async () => {
  const { darknessOf, jobText } = await import('../print-agent/agent.mjs');
  const label = '^XA^FDPane^FS^XZ\n';
  assert.equal(jobText({ darkness: 28 }, label), `~SD28\n${label}`);
  assert.equal(jobText({ darkness: 5 }, label), `~SD05\n${label}`, 'Zebra reads two digits');
  assert.equal(jobText({ darkness: 0 }, label), `~SD00\n${label}`, 'zero is a darkness, not «unset»');
  assert.equal(jobText({}, label), label, 'left out, nothing is sent and the printer keeps its own');
  assert.equal(jobText({ darkness: null }, label), label);
  for (const bad of [31, -1, 2.5, '28', true, '~JR']) {
    assert.equal(darknessOf({ darkness: bad }), undefined, `${JSON.stringify(bad)} is not a darkness`);
  }
});

test('⚠️ a darkness that is not one stops the program at start, and the job never carries it', () => {
  const src = codeOf(read(AGENT));
  const load = src.slice(src.indexOf('function loadConfig'), src.indexOf('function readAppConfig'));
  assert.match(load, /darknessOf\(cfg\.printer\) === undefined\) die\(/,
    'a wrong darkness must stop the agent before it prints, not print at the printer s whim');
  const print = src.slice(src.indexOf('async function printJob'), src.indexOf('function die'));
  assert.match(print, /jobText\(cfg\.printer, payload\)/, 'both roads must go through jobText');
  const loop = src.slice(src.indexOf('async function main'), src.indexOf('export {'))
    .replace(/console\.log\([^\n]*darknessOf\(cfg\.printer\)[^\n]*\n/, '');
  assert.ok(loop.length > 500, 'the agent no longer has the shape this test reads');
  assert.ok(!/darkness/i.test(loop), 'the loop must never take a darkness from a job');
});

test('the agent says it can print the image label, and the example shows the darkness', async () => {
  const { VERSION } = await import('../print-agent/agent.mjs');
  const [major, minor] = VERSION.split('.').map(Number);
  assert.ok(major > 1 || (major === 1 && minor >= 1),
    'Mise 2 queues an image label only for an agent at 1.1.0 or later (shared/src/image-label-print.ts)');
  const example = JSON.parse(read('print-agent/print-agent.example.json'));
  assert.equal(example.printer.darkness, 28);
});
