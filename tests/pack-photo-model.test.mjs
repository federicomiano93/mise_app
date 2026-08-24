// Photographing the back of a packet and getting its ingredient list typed out.
//
// ⚠️⚠️ WHAT THESE GUARD IS THE ORDER AND THE SILENCE, not the transcription. Nobody
// can unit-test whether a reader read a label correctly; what can be proved is that
// nothing is charged before the payload is known to be readable, that the charge lands
// before the reader is called and survives it throwing, that a venue with the wrong
// section is refused, and — the one that matters most — that no path here ever writes
// the verification stamp. It proposes; it never declares.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  MAX_PACK_TEXT, packPhotoEnabled, packToolDefinition, packPromptText,
  textFromToolInput, readPackText,
} from '../functions/pack-photo-model.js';
import { DAILY_IMAGES_PER_PERSON, DAILY_IMAGES_PER_VENUE } from '../functions/recipe-photo-model.js';

const root = new URL('../', import.meta.url);
const read = (name) => readFileSync(new URL(name, root), 'utf8');
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const MODEL = codeOf(read('functions/pack-photo-model.js'));
const SHELL = codeOf(read('functions/pack-photo.js'));

// ── A store that records what was asked of it, in order ──────────────────────
function fakeStore({ access = 'owner', location = { packPhoto: true }, limit = null } = {}) {
  const calls = [];
  const saved = {};
  return {
    calls,
    saved,
    access: async (uid, lid) => { calls.push(`access:${uid}:${lid}`); return access; },
    location: async (lid) => { calls.push(`location:${lid}`); return location; },
    limit: async (path) => { calls.push(`limit:${path}`); return saved[path] || limit; },
    saveLimit: async (path, value) => { calls.push(`saveLimit:${path}`); saved[path] = value; },
  };
}
const IMAGE = { data: 'QUJDRA==', mediaType: 'image/jpeg' };
const toolReply = (input) => ({ content: [{ type: 'tool_use', input }], usage: {} });
const base = (over = {}) => ({
  uid: 'u1', locationId: 'bakery', images: [IMAGE], now: 1_000_000, ...over,
});

// ── 1. The switch ────────────────────────────────────────────────────────────

test('⚠️⚠️ the pack switch is OFF unless it is literally true', () => {
  assert.equal(packPhotoEnabled({ packPhoto: true }), true);
  for (const doc of [
    null, undefined, {}, 'yes', 42,
    { packPhoto: false },
    { packPhoto: 'true' },
    { packPhoto: 1 },
    { recipePhoto: true },
    { sections: { packPhoto: true } },
  ]) {
    assert.equal(packPhotoEnabled(doc), false,
      `${JSON.stringify(doc)} must read as OFF — this one spends money per tap`);
  }
});

test('⚠️ it is its OWN field, not a second reading of recipePhoto', () => {
  assert.equal(packPhotoEnabled({ recipePhoto: true, packPhoto: false }), false,
    'the recipe reader being on must not switch this one on: Federico asked for two '
    + 'separate switches, and one field answering for both is not two switches');
  assert.equal(packPhotoEnabled({ recipePhoto: false, packPhoto: true }), true);
  assert.match(MODEL, /locationDoc\.packPhoto === true/);
  assert.ok(!/recipePhoto/.test(MODEL), 'and it may not read the other field at all');
});

// ── 2. The tool and the prompt ───────────────────────────────────────────────

test('the tool is strict, closed, and asks whether there was anything to read', () => {
  const tool = packToolDefinition();
  assert.equal(tool.strict, true);
  assert.equal(tool.input_schema.additionalProperties, false);
  assert.deepEqual(tool.input_schema.required, ['found', 'text']);
  assert.equal(tool.input_schema.properties.found.type, 'boolean',
    '⚠️ «there is no ingredient list here» has to be SAID: an empty string is also '
    + 'what a failed read produces');
  assert.equal(tool.input_schema.properties.text.type, 'string');
  assert.deepEqual(Object.keys(tool.input_schema.properties), ['found', 'text'],
    'nothing else may come back — every extra field is one nobody validates');
});

test('⚠️ the prompt forbids the four things that would change the meaning', () => {
  const p = packPromptText();
  assert.match(p, /do NOT translate/i, 'the words are the pack\'s, in the pack\'s language');
  assert.match(p, /do NOT reorder/i, 'the order on a label is the order by weight, and it is the law');
  assert.match(p, /capitals/i,
    '⚠️ on a food label CAPITALS are how an allergen is emphasised, so changing them '
    + 'changes what the pack declares');
  assert.match(p, /may contain traces/i,
    '⚠️ js/allergen-match.js splitTraces() reads that sentence and it is the whole '
    + 'traces column — dropped, a pack that warns becomes a pack that says nothing');
  assert.match(p, /nutrition table/i, 'and the things that are not the ingredient list');
});

// ── 3. What is done with the answer ──────────────────────────────────────────

test('nothing comes back unless the reader said it found a list', () => {
  for (const input of [
    null, undefined, 'text', [], {},
    { found: false, text: 'Wheat flour, water' },
    { found: 'true', text: 'Wheat flour' },
    { found: 1, text: 'Wheat flour' },
    { found: true, text: 42 },
    { found: true, text: '   ' },
  ]) {
    assert.equal(textFromToolInput(input).text, null,
      `${JSON.stringify(input)} must produce nothing`);
  }
});

test('⚠️ newlines survive and capitals and accents are untouched', () => {
  const out = textFromToolInput({
    found: true,
    text: 'Farina di   GRANO tenero 62%,  acqua, sale.\n\n\n\nPuò contenere tracce di FRUTTA A GUSCIO.',
  });
  assert.equal(out.text,
    'Farina di GRANO tenero 62%, acqua, sale.\n\nPuò contenere tracce di FRUTTA A GUSCIO.');
  assert.match(out.text, /GRANO/, 'capitals are how a label emphasises an allergen');
  assert.match(out.text, /Può/, 'and an accent stripped here is a word the matcher may miss');
  assert.equal(out.notes.truncated, false);
});

test('⚠️ it is capped at the same 4000 the rules and the save cap it at', () => {
  const out = textFromToolInput({ found: true, text: 'x'.repeat(MAX_PACK_TEXT + 500) });
  assert.equal(out.text.length, MAX_PACK_TEXT);
  assert.equal(out.notes.truncated, true,
    '⚠️ and it must SAY so: buildAllergenFields truncates in silence on save, which is '
    + 'the wrong moment to discover it');
});

test('⚠️⚠️ the same 4000 in all three places that enforce it', () => {
  const rules = read('firestore.rules');
  assert.match(rules, new RegExp(`packIngredients\\.size\\(\\) <= ${MAX_PACK_TEXT}`),
    'the rules refuse the WHOLE document over the cap, so a longer answer would make '
    + 'the ingredient unsaveable with nothing on screen explaining why');
  assert.match(read('js/allergen-model.js'), new RegExp(`slice\\(0, ${MAX_PACK_TEXT}\\)`),
    'and the save applies the same one');
});

// ── 4. The order, which is the part that goes wrong while reading well ───────

test('a caller who is not signed in is refused before anything else happens', async () => {
  const store = fakeStore();
  const out = await readPackText(base({ uid: null, store, ask: async () => { throw new Error('called'); } }));
  assert.equal(out.error.code, 'unauthenticated');
  assert.deepEqual(store.calls, [], 'not one read');
});

test('the locationId shape is refused before the membership is read', async () => {
  for (const lid of ['', 'has/slash', '../escape', 'x'.repeat(80), null, 7]) {
    const store = fakeStore();
    const out = await readPackText(base({ locationId: lid, store, ask: async () => ({}) }));
    assert.equal(out.error.code, 'invalid-argument', `«${lid}» must be refused`);
    assert.deepEqual(store.calls, [], 'and refused without a read');
  }
});

test('⚠️ a bad payload is refused BEFORE anything is charged, and before the membership', async () => {
  for (const images of [[], null, 'x', [{ data: 'not base64!', mediaType: 'image/jpeg' }],
    [{ data: 'QUJDRA==', mediaType: 'image/gif' }]]) {
    const store = fakeStore();
    const out = await readPackText(base({ images, store, ask: async () => ({}) }));
    assert.equal(out.error.code, 'invalid-argument', `${JSON.stringify(images)} must be refused`);
    assert.deepEqual(store.calls, [],
      '⚠️ the shape of a payload is PUBLIC, so charging for one that was never going to '
      + 'be read charges somebody for nothing');
  }
});

test('somebody outside the venue is refused, and not charged', async () => {
  const store = fakeStore({ access: false });
  const out = await readPackText(base({ store, ask: async () => { throw new Error('called'); } }));
  assert.equal(out.error.code, 'permission-denied');
  assert.ok(!store.calls.some(c => c.startsWith('saveLimit')), 'nothing charged');
});

test('⚠️⚠️ the section it checks is ORDERS, not the catalogue', async () => {
  // This is the one real difference from readRecipe(), and it decides which venues can
  // use it at all. «Fornitori e ingredienti» is a page of the Orders feature: the
  // restaurant has Orders and no Catalogue today, and must be able to use this.
  const withOrdersOnly = fakeStore({
    location: { packPhoto: true, sections: { orders: true, catalogue: false } },
  });
  const ok = await readPackText(base({
    store: withOrdersOnly, ask: async () => toolReply({ found: true, text: 'Wheat flour' }),
  }));
  assert.equal(ok.ok, true, 'a venue with Orders and no Catalogue must be allowed');

  const withCatalogueOnly = fakeStore({
    location: { packPhoto: true, sections: { orders: false, catalogue: true } },
  });
  const no = await readPackText(base({
    store: withCatalogueOnly, ask: async () => { throw new Error('called'); },
  }));
  assert.equal(no.error.code, 'permission-denied',
    'and a venue with the Catalogue and no Orders must not');
  assert.ok(!withCatalogueOnly.calls.some(c => c.startsWith('saveLimit')), 'nor be charged');
});

test('a venue with the switch off is refused, and not charged', async () => {
  const store = fakeStore({ location: { packPhoto: false } });
  const out = await readPackText(base({ store, ask: async () => { throw new Error('called'); } }));
  assert.equal(out.error.code, 'failed-precondition');
  assert.equal(out.error.key, 'photo-off');
  assert.ok(!store.calls.some(c => c.startsWith('saveLimit')), 'nothing charged');
});

test('⚠️ the allowance is charged BEFORE the reader runs, and KEPT when it throws', async () => {
  const store = fakeStore();
  const out = await readPackText(base({ store, ask: async () => { throw new Error('boom'); } }));
  assert.equal(out.error.code, 'internal');
  assert.ok(!/boom/.test(out.error.message),
    '⚠️ the reader\'s own message is never passed on: it can carry a fragment of the key');
  assert.equal(out.logged, 'boom', 'it is logged instead');
  // ⚠️ THE STAMPS, NOT MERELY THE DOCUMENT. A refund written as `{ at: [] }` leaves a
  // document behind and would pass a mere existence check.
  assert.equal(store.saved['recipe-photo-limits/u1'].at.length, 1, 'the person still paid');
  assert.equal(store.saved['recipe-photo-venue/bakery'].at.length, 1, 'so did the venue');
});

test('⚠️ it charges the SAME two documents as the recipe reader — one budget', async () => {
  const store = fakeStore();
  await readPackText(base({ store, ask: async () => toolReply({ found: true, text: 'Salt' }) }));
  assert.ok(store.calls.includes('saveLimit:recipe-photo-limits/u1'),
    'the per-person allowance is the same one');
  assert.ok(store.calls.includes('saveLimit:recipe-photo-venue/bakery'),
    'and so is the venue\'s');
  // ⚠️ THE NAMES STILL SAY «recipe» AND THAT IS ON PURPOSE. Renaming those two
  // collections would reset every counter to zero on deploy day, which is worse than a
  // stale name. Pinned so nobody tidies it.
  assert.ok(!MODEL.includes('pack-photo-limits') && !MODEL.includes('pack-photo-venue'),
    'a second pair of counters is a second budget');
});

test('the two daily ceilings are the shared ones, not copies', () => {
  assert.equal(DAILY_IMAGES_PER_PERSON, 40);
  assert.equal(DAILY_IMAGES_PER_VENUE, 150);
  assert.ok(!/DAILY_IMAGES_PER_(PERSON|VENUE)\s*=/.test(MODEL),
    '⚠️ declaring them here is how a second, invisible budget appears');
});

test('a person over their ceiling does not consume the venue\'s', async () => {
  const store = fakeStore({ limit: { at: Array(DAILY_IMAGES_PER_PERSON).fill(1_000_000) } });
  const out = await readPackText(base({ store, ask: async () => { throw new Error('called'); } }));
  assert.equal(out.error.code, 'resource-exhausted');
  assert.equal(out.error.key, 'person-limit');
  assert.ok(!store.calls.includes('limit:recipe-photo-venue/bakery'),
    'the venue is not even asked');
});

test('«nothing readable» is an answer, not a failure', async () => {
  for (const reply of [
    toolReply({ found: false, text: '' }),
    { stop_reason: 'refusal', content: [] },
    { stop_reason: 'max_tokens', content: [] },
    { content: [{ type: 'text', text: 'here you go' }] },
  ]) {
    const out = await readPackText(base({ store: fakeStore(), ask: async () => reply }));
    assert.ok(!out.error, 'the call worked; there was nothing to use');
    assert.equal(out.ok, false);
    assert.ok(out.reason, 'and it says which of those it was');
  }
});

test('a good read comes back with the text and what is left of the allowance', async () => {
  const out = await readPackText(base({
    store: fakeStore(),
    ask: async () => toolReply({ found: true, text: 'Wheat flour, water, salt.' }),
  }));
  assert.equal(out.ok, true);
  assert.equal(out.text, 'Wheat flour, water, salt.');
  assert.equal(out.remaining, DAILY_IMAGES_PER_PERSON - 1);
});

// ── 5. It proposes; it never declares ────────────────────────────────────────

test('⚠️⚠️ nothing in this path writes the verification stamp', () => {
  for (const [name, src] of [['the model', MODEL], ['the shell', SHELL]]) {
    assert.ok(!src.includes('allergensCheckedAt'),
      `${name} must never touch the stamp — a transcription is a suggestion, and a `
      + 'suggestion that stamps itself as checked is a false declaration');
    assert.ok(!/allergens\s*[:=]/.test(src),
      `${name} must not decide an allergen at all: it returns TEXT, and the matcher `
      + 'proposes from it');
  }
});

// ── 6. The shell's wiring, which no test can execute ─────────────────────────

test('⚠️ the callable is exported from index.js, or it is simply not deployed', () => {
  assert.match(read('functions/index.js'),
    /export \{ readPackIngredientsFromPhotos \} from '\.\/pack-photo\.js';/,
    'a callable missing from that list fails as the client\'s generic «internal», '
    + 'which says nothing and looks exactly like a broken function');
});

test('⚠️⚠️ the callable name does not collide with the matcher of almost the same name', () => {
  assert.match(SHELL, /export const readPackIngredientsFromPhotos = onCall/);
  assert.match(read('js/allergen-match.js'), /export function readPackIngredients\(/,
    'js/allergen-match.js already exports readPackIngredients — importing both into '
    + 'one file would shadow the pure matcher with a network call, silently');
});

test('⚠️ thinking is never disabled, and the effort is low', () => {
  assert.match(SHELL, /output_config: \{ effort: 'low' \}/);
  assert.ok(!/thinking/.test(SHELL),
    '⚠️ on this model a disabled-thinking turn sometimes writes the tool call into '
    + 'visible TEXT: the call succeeds, nothing errors, and extraction returns nothing');
  assert.match(SHELL, /maxRetries: 1, timeout: 50_000/,
    'the SDK default is three full PAID attempts, each able to outlive the function');
  assert.match(SHELL, /const MODEL = 'claude-sonnet-5';/);
});

test('⚠️ the secret and the options object are the recipe reader\'s, not a second pair', () => {
  assert.match(SHELL, /import \{ ANTHROPIC_KEY, PHOTO_CALL \} from '\.\/recipe-photo\.js';/,
    'one secret binding and one ceiling, named in one place');
  assert.ok(!/defineSecret/.test(SHELL), 'and not re-declared here');
});

test('⚠️ access delegates to onboarding.js rather than re-reading users/{uid}', () => {
  assert.match(SHELL, /access: accessValue/);
  assert.ok(!/users\/\$\{/.test(SHELL),
    'what a membership value MEANS lives in three files that must agree, and a fourth '
    + 'reading is a lockout waiting to happen');
});

test('⚠️ the model still imports nothing from node_modules', () => {
  // The rule is written as «zero imports»; what it stands for is «nothing CI has not
  // installed» — the root test job never runs npm ci in functions/. A relative import
  // of a file that is itself clean is fine; a bare specifier is not.
  const specifiers = [...read('functions/pack-photo-model.js').matchAll(/from\s+'([^']+)'/g)]
    .map(m => m[1]);
  assert.ok(specifiers.length > 0, 'the extractor must actually find the imports');
  for (const s of specifiers) {
    assert.ok(s.startsWith('./') || s.startsWith('../'),
      `«${s}» is a bare specifier — the root test job cannot resolve it`);
  }
  assert.ok(!/from\s+'[^']+'/.test(codeOf(read('functions/recipe-photo-model.js'))),
    'and the file it imports must stay import-free itself');
});
