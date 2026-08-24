// pack-photo-model.js — photograph the back of a packet and get its printed
// ingredient list typed out. Every judgement; no network, no database, no framework.
//
// Federico, 24 Aug 2026: «nella scheda fornitori e ingredienti, per compilare l'elenco
// ingredienti voglio la possibilità di fotografare gli ingredienti del prodotto e l'app
// me li trascrive in automatico». There are 67 ingredients in production and 0 of them
// are declared; the box this fills is what the allergen matcher reads.
//
// ⚠️⚠️ IT TRANSCRIBES. IT DOES NOT DECLARE, AND IT DOES NOT INTERPRET.
// What comes back is the pack's own words, in the pack's own language, in the pack's
// own order. The app then matches allergen words against that text and PRE-TICKS boxes
// — js/allergen-match.js — and nothing in either path writes `allergensCheckedAt`. So
// a misread costs a correction and can never become a false declaration. That property
// is what makes this safe enough to build at all.
//
// ⚠️ IT IMPORTS FROM ./recipe-photo-model.js, AND THAT IS DELIBERATE, NOT A SLIP.
// The rule those files live under is written as «zero imports», but the rule it stands
// for is «nothing from node_modules»: CI's `test` job runs `node --test` at the repo
// root and never runs `npm ci` in functions/. That sibling imports nothing at all, so
// it resolves. Sharing it is also what keeps ONE allowance: the payload caps, the daily
// ceilings and chargeTo() are the same objects, not copies of them. Copying the
// constants across is exactly how a second, invisible budget appears.

import {
  payloadProblem,
  readToolResult,
  chargeTo,
  limitError,
  usageOf,
  sectionOn,
  DAILY_IMAGES_PER_PERSON,
  DAILY_IMAGES_PER_VENUE,
} from './recipe-photo-model.js';

// ⚠️ THE SAME 4000 THE RULES CAP IT AT, and the same one js/allergen-model.js applies
// on save. The rules refuse the WHOLE document when it is exceeded, so a longer answer
// would make the ingredient unsaveable with nothing on screen explaining why. Three
// places hold this number and a test compares all three.
export const MAX_PACK_TEXT = 4000;

// Is reading a PACK from a photograph switched on for this venue?
//
// ⚠️⚠️ ITS OWN FIELD, NOT recipePhoto — Federico's decision, 24 Aug 2026, asked
// directly: two separate switches, so the pack reader can be on while the recipe reader
// stays off. They share one BUDGET and one price; what they do not share is consent.
//
// ⚠️ THE DEFAULT IS OFF AND ONLY A LITERAL `true` COUNTS, exactly like recipePhoto and
// exactly opposite to sectionOn() — this SPENDS MONEY per tap, on an account nobody in
// the venue owns, so a venue that has never heard of it must never find it running. A
// stray string, a 1, a corrupt value: all off. Read the other way round, "anything
// truthy is on", a mangled field would quietly start spending.
//
// ⚠️ AND IT IS NOT INSIDE `sections`, for the same reason: a missing key there means
// yes, which would hand the feature to every venue at once and make the mistake
// invisible until an invoice arrived.
export function packPhotoEnabled(locationDoc) {
  return !!locationDoc && typeof locationDoc === 'object' && locationDoc.packPhoto === true;
}

// ── What the reader is asked for ─────────────────────────────────────────────

// ⚠️ `found` IS A FIELD AND NOT AN INFERENCE, for the same reason the recipe tool has
// one: an empty string is also what a failed read produces, and "there is no ingredient
// list in this photograph" has to be SAID rather than guessed from a blank.
export function packToolDefinition() {
  return {
    name: 'record_pack_ingredients',
    description: 'Record the ingredient list printed on a food package.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        found: {
          type: 'boolean',
          description: 'True only if the photographs really show a printed list of ingredients.',
        },
        text: {
          type: 'string',
          description: 'The ingredient list exactly as printed. Empty string if there is none.',
        },
      },
      required: ['found', 'text'],
      additionalProperties: false,
    },
  };
}

export function packPromptText() {
  return [
    'These photographs show the ingredient list printed on a food package.',
    'Write it out exactly as printed.',
    '',
    'Rules:',
    '- Copy the words as they are written, in the language on the pack.',
    '  Do NOT translate, do NOT tidy up, do NOT expand abbreviations,',
    '  do NOT reorder, do NOT merge or split entries.',
    '- Keep the punctuation, the brackets and the percentages exactly',
    '  ("farina di GRANO tenero tipo 0 62%" stays as it is).',
    '- Keep any capitals the pack uses. On a food label capitals are how the',
    '  allergen is emphasised, so changing them changes the meaning.',
    '- KEEP any "may contain traces of ..." sentence, and keep it as a separate',
    '  sentence at the end. It is not part of the ingredient list, and it says',
    '  something different from it.',
    '- Ignore everything that is not the ingredient list: the nutrition table,',
    '  the barcode, the address, the weight, the best-before date, cooking',
    '  instructions, marketing text.',
    '- Do not add a heading of your own, and do not add anything the pack',
    '  does not say.',
    '- If the photographs do not show a printed ingredient list, set found to',
    '  false and leave text empty.',
  ].join('\n');
}

// ── What is done with the answer ─────────────────────────────────────────────

// ⚠️ NEWLINES SURVIVE, RUNS OF SPACES DO NOT. A person reads this box and then checks
// it against the packet in their hand, so the "may contain" sentence has to stay on a
// line of its own. Collapsing everything to one line is tidier and unreadable.
//
// ⚠️ NOTHING IS LOWERCASED AND NO ACCENT IS STRIPPED. js/allergen-match.js does its own
// normalising, on a copy, with an index map back to the original — because the screen
// re-draws this text with the recognised words marked. Normalising it here would throw
// away the capitals a label uses to emphasise an allergen.
export function textFromToolInput(input) {
  const notes = { truncated: false };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { text: null, notes };
  if (input.found !== true) return { text: null, notes };
  if (typeof input.text !== 'string') return { text: null, notes };

  const tidied = input.text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!tidied) return { text: null, notes };

  if (tidied.length > MAX_PACK_TEXT) {
    notes.truncated = true;
    return { text: tidied.slice(0, MAX_PACK_TEXT), notes };
  }
  return { text: tidied, notes };
}

// ── The whole sequence ───────────────────────────────────────────────────────
//
// ⚠️⚠️ THE SAME ORDER AS readRecipe(), AND IT IS LOAD-BEARING IN THE SAME WAY:
//   auth → the locationId's shape → the payload → membership → section → the switch
//   → charge the person → charge the venue → ask → read the tool result.
// The payload is checked before anything is charged (its shape is public, so charging
// for a read that was never going to happen charges somebody for nothing), and the
// charge lands before the reader is called and is never refunded (a refund path has to
// decide what "it did not work" means, and every answer is a way to read for free).
//
// ⚠️ ONE DIFFERENCE, AND IT IS THE ONE THAT MATTERS: the section is `orders`, not
// `catalogue`. This box lives on «Fornitori e ingredienti», which is a page of the
// Orders feature. A venue with Orders and no Catalogue — the restaurant, today — must
// be able to use it, and a venue with the Catalogue and no Orders must not.
export async function readPackText({ uid, locationId, images, store, ask, now }) {
  if (!uid) return { error: { code: 'unauthenticated', key: 'signed-out', message: 'Sign in first.' } };
  if (typeof locationId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(locationId)) {
    return { error: { code: 'invalid-argument', key: 'no-location', message: 'Which location?' } };
  }

  const bad = payloadProblem(images);
  if (bad) {
    return { error: { code: 'invalid-argument', key: bad.code, message: `Those photos cannot be read (${bad.code}).` } };
  }

  if (!await store.access(uid, locationId)) {
    return { error: { code: 'permission-denied', key: 'not-allowed', message: 'You are not in that venue.' } };
  }
  // One read answers both questions: the section and the switch are on one document.
  const location = await store.location(locationId);
  if (!sectionOn(location, 'orders')) {
    return { error: { code: 'permission-denied', key: 'not-allowed', message: 'Orders is not switched on here.' } };
  }
  if (!packPhotoEnabled(location)) {
    return { error: { code: 'failed-precondition', key: 'photo-off', message: 'Reading a pack from a photo is switched off for this venue.' } };
  }

  // ⚠️ THE SAME TWO DOCUMENTS THE RECIPE READER CHARGES, and they still say «recipe» in
  // their names. Renaming them would reset every counter to zero on deploy day, which
  // is a worse thing than a stale name. One venue, one daily allowance, whichever of
  // the two readers spent it.
  const person = await chargeTo(store, `recipe-photo-limits/${uid}`, images.length, DAILY_IMAGES_PER_PERSON, now);
  if (person.blocked) return { error: limitError('person-limit', person, 'You have') };
  const venue = await chargeTo(store, `recipe-photo-venue/${locationId}`, images.length, DAILY_IMAGES_PER_VENUE, now);
  if (venue.blocked) return { error: limitError('venue-limit', venue, 'This venue has') };

  let message;
  try {
    message = await ask(images);
  } catch (err) {
    // The reader's own message is never passed on: it is written for a developer, it
    // is English, and it can carry a fragment of the API key.
    return {
      error: { code: 'internal', key: 'read-failed', message: 'The photo could not be read. Try again.' },
      logged: String(err && err.message),
    };
  }

  const result = readToolResult(message);
  // ⚠️ NOT AN ERROR. The call worked; the answer was «nothing I can use». Making that a
  // failure is what teaches somebody to stop believing the app when it does work.
  if (result.problem) return { ok: false, reason: result.problem, usage: usageOf(message) };

  const { text, notes } = textFromToolInput(result.input);
  if (!text) return { ok: false, reason: 'nothing-readable', usage: usageOf(message) };
  return { ok: true, text, notes, remaining: person.remaining, usage: usageOf(message) };
}
