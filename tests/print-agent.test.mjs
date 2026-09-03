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
  const src = codeOf(read(AGENT));
  assert.match(src, /join\(REPO, 'js', 'firebase\.js'\)/);
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
