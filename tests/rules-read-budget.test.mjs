// The security rules have a READ BUDGET, and nothing else in this project can see it.
//
// ⚠️ WHY A SEPARATE TEST. tests/rules/firestore-rules-check.mjs runs the real rules
// against the real emulator and is the right tool for "is this allowed?" — but it
// is BLIND to this particular failure, and says so in its own comments: a rule that
// runs out of document reads is refused with 403, and an ordinary refusal is also
// 403. A ruleset that had exhausted its budget would still report every one of its
// 538 checks as passing. So the budget has to be COUNTED, not exercised.
//
// ⚠️ THE THREE FACTS BELOW WERE MEASURED against the Firestore emulator, not
// reasoned about — because a previous note in firestore.rules reasoned about them
// and got them wrong. It described the ruleset as sitting exactly on the limit when
// it had five reads to spare, which is the kind of error that makes the next person
// either panic or stop believing the comments:
//
//   1. The limit is 10 document ACCESSES per rule evaluation.
//      10 different documents pass; 11 are refused.
//   2. It counts CALLS, not distinct documents. Reading the SAME document twice
//      costs two. 5 documents read twice each (10 calls) pass; 6 read twice each
//      (12 calls) are refused, exactly like 11 different documents. This is why
//      `exists(X) && get(X)` is a bug and not a style choice.
//   3. The budget is PER RULE EVALUATION and is NOT shared across the several
//      rules that may match one request. Two matching rules costing 10 accesses
//      each — 20 in total — both evaluate fine.
//
// Fact 3 retires an old warning: a rule answering FALSE does NOT make the next one
// pay again. The ruleset was never one read from breaking.
//
// ⚠️ WHAT IS STILL AT STAKE, since it is not a cliff edge. Every one of these calls
// is BILLED as a document read, on every gated operation, for ever. Halving them
// halves that bill. And the headroom is what lets the next feature add a read
// without anyone having to rediscover all of the above.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = readFileSync(join(ROOT, 'firestore.rules'), 'utf8');

// A commented-out get() costs nothing, so comments go before anything is counted.
const CODE = RULES.split('\n').map(line => line.replace(/\/\/.*$/, '')).join('\n');

// Pull one `function name(...) { ... }` body out, brace-matched so a nested block
// cannot end it early.
function bodyOf(name) {
  const start = CODE.indexOf(`function ${name}(`);
  if (start === -1) return null;
  const open = CODE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < CODE.length; i++) {
    if (CODE[i] === '{') depth++;
    else if (CODE[i] === '}' && --depth === 0) return CODE.slice(open + 1, i);
  }
  return null;
}

// Every document access in a piece of rules code, as {kind, path}.
//
// ⚠️ THE PARENTHESES MUST BE BALANCED, not matched to the first `)`. Every path in
// this ruleset contains `$(database)` and most contain `$(request.auth.uid)`, so a
// lazy `[^)]*` stops inside the first interpolation and returns the same stub for
// EVERY access — which makes two reads of two DIFFERENT documents look like one
// document read twice, and fails an innocent helper.
function accessesIn(text) {
  const out = [];
  for (const m of text.matchAll(/\b(get|exists|getAfter)\s*\(/g)) {
    let depth = 1;
    let i = m.index + m[0].length;
    const from = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    if (depth !== 0) continue;
    const path = text.slice(from, i - 1).replace(/\s+/g, '');
    if (path.startsWith('/databases/')) out.push({ kind: m[1], path });
  }
  return out;
}

const costOf = name => accessesIn(bodyOf(name)).length;

// The helpers that read documents. Each cost is pinned individually, so a
// regression names the function it happened in instead of a total that moved.
const HELPERS = { member: 1, sectionOn: 1, roleIn: 1, orderClientOf: 1 };

test('the helpers this test is about still exist, so it cannot pass by finding nothing', () => {
  for (const name of Object.keys(HELPERS)) {
    assert.ok(bodyOf(name), `firestore.rules has no function ${name}() — this test is checking nothing`);
  }
  assert.ok(accessesIn(CODE).length > 0, 'no document accesses found at all — the parser has stopped matching');
});

test('the access parser reads a whole interpolated path, not a stub', () => {
  // Guards the parser itself: the bug it is written against is silent, and a
  // truncated path would make every check below compare the wrong things.
  const paths = accessesIn(bodyOf('member')).map(a => a.path);
  assert.equal(paths.length, 1);
  assert.match(paths[0], /^\/databases\/\$\(database\)\/documents\/users\/\$\(request\.auth\.uid\)$/,
    `parsed "${paths[0]}" — expected the complete users/{uid} path`);
});

test('every document-reading helper costs exactly one read', () => {
  for (const [name, budget] of Object.entries(HELPERS)) {
    assert.equal(costOf(name), budget,
      `${name}() makes ${costOf(name)} document accesses, expected ${budget}. ` +
      'Firestore charges per CALL: exists(X) && get(X) on one document costs TWO. ' +
      'Use a single get() and compare against null — get() on a missing document ' +
      'returns null, it does not raise.');
  }
});

test('no helper reads the same document twice', () => {
  for (const name of Object.keys(HELPERS)) {
    const seen = new Set();
    for (const { path } of accessesIn(bodyOf(name))) {
      assert.ok(!seen.has(path),
        `${name}() reads ${path} more than once. Each call is charged and billed ` +
        'separately — bind it once and reuse it.');
      seen.add(path);
    }
  }
});

test('exists() is not reintroduced beside a get() on the same document', () => {
  const pairs = [];
  for (const name of Object.keys(HELPERS)) {
    const kinds = new Map();
    for (const { kind, path } of accessesIn(bodyOf(name))) {
      if (!kinds.has(path)) kinds.set(path, new Set());
      kinds.get(path).add(kind);
    }
    for (const [path, set] of kinds) {
      if (set.has('exists') && set.has('get')) pairs.push(`${name}(): ${path}`);
    }
  }
  assert.deepEqual(pairs, [],
    `exists() and get() are both called on the same document here: ${pairs.join(', ')}. ` +
    'That is two charged reads for one document; one get() and a null check does it.');
});

test('the most expensive gated rule stays well inside the budget of 10', () => {
  // canManage() is the deepest path a request can take: it calls canUse(), which
  // calls member() and sectionOn(), and then roleIn().
  const cost = costOf('member') + costOf('sectionOn') + costOf('roleIn');

  assert.equal(cost, 3,
    `a canManage()-gated rule now costs ${cost} reads, not 3. That is not automatically ` +
    'wrong — the measured limit is 10 — but it is paid on every gated operation and ' +
    'billed every time, so it should be a decision and not a surprise. If the new cost ' +
    'is intended, run `npm run test:rules:emulated` and update this number.');

  assert.ok(cost <= 6,
    `a canManage()-gated rule costs ${cost} of the 10 reads a rule evaluation is allowed. ` +
    'Past 6 there is no room for the next feature, and the failure when it runs out is a ' +
    '403 that looks exactly like an ordinary refusal.');
});
