// pack-photo.js — the shell around functions/pack-photo-model.js: the secret, the
// network, the database. It contains no judgement at all.
//
// ⚠️ A COPY OF recipe-photo.js's SHAPE, and written out rather than generalised: the
// two differ in the tool, the prompt and the section they check, and a single
// parameterised reader would hide those three differences behind a flag. What IS shared
// is imported — the options object, the allowance arithmetic, the payload caps — so the
// things that must not drift cannot.
//
// ⚠️ EVERY DECISION IS IN THE MODEL, AND THAT IS FORCED. This file imports
// @anthropic-ai/sdk and firebase-functions, which CI installs only in the
// deploy-functions job, so a root test can never load it. What is left is wiring, and
// the wiring is checked by READING this file (tests/pack-photo-model.test.mjs).
//
// ⚠️ The key must never reach a browser. That is the whole reason this exists rather
// than the app calling the API itself.

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import Anthropic from '@anthropic-ai/sdk';
import { accessValue } from './onboarding.js';
import { ANTHROPIC_KEY, PHOTO_CALL } from './recipe-photo.js';
import { readPackText, packToolDefinition, packPromptText } from './pack-photo-model.js';

const db = () => getFirestore();

// ⚠️ THE SAME MODEL AND THE SAME SETTINGS AS THE RECIPE READER, deliberately.
// `claude-sonnet-5` was chosen on measured numbers for transcription; this is the same
// job on shorter text.
const MODEL = 'claude-sonnet-5';
const MAX_TOKENS = 4000;

async function askAnthropic(images, apiKey) {
  // ⚠️ THE SDK'S DEFAULTS ARE WRONG FOR US: maxRetries 2 and a ten-minute timeout mean
  // three full PAID attempts, each able to outlive the function itself.
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 50_000 });

  return client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // ⚠️⚠️ LOW EFFORT, AND THINKING LEFT ON. This is transcription, not reasoning, so
    // the thinking tokens are waste — but `thinking: { type: 'disabled' }` is NOT the
    // way to save them: on this model a disabled-thinking turn sometimes writes the
    // tool call into visible TEXT instead of emitting a tool_use block. The call
    // succeeds, nothing errors, and the extraction silently returns nothing.
    output_config: { effort: 'low' },
    tools: [packToolDefinition()],
    messages: [{
      role: 'user',
      content: [
        // Images FIRST, then the instruction — the documented order.
        ...images.map(i => ({
          type: 'image',
          source: { type: 'base64', media_type: i.mediaType, data: i.data },
        })),
        { type: 'text', text: packPromptText() },
      ],
    }],
  });
}

// The four things the model needs from the outside world.
//
// ⚠️ `access` DELEGATES TO onboarding.js RATHER THAN RE-READING users/{uid}. What a
// membership value MEANS already lives in three files that must agree, and forgetting
// a value there is a LOCKOUT, not a demotion. A fourth reading is the one nobody
// would remember to update.
const store = {
  access: accessValue,
  location: async (lid) => {
    const snap = await db().doc(`locations/${lid}`).get();
    return snap.exists ? snap.data() : null;
  },
  limit: async (path) => {
    const snap = await db().doc(path).get();
    return snap.exists ? snap.data() : null;
  },
  saveLimit: async (path, value) => { await db().doc(path).set(value); },
};

// ⚠️ NAMED …FromPhotos, NOT readPackIngredients. That name is ALREADY EXPORTED by
// js/allergen-match.js — the pure matcher this text is handed to — and importing both
// into one file would shadow the matcher with a network call, silently.
export const readPackIngredientsFromPhotos = onCall(PHOTO_CALL, async (request) => {
  const { locationId, images } = request.data || {};
  const uid = request.auth && request.auth.uid;

  const out = await readPackText({
    uid,
    locationId,
    images,
    store,
    now: Date.now(),
    ask: (list) => askAnthropic(list, ANTHROPIC_KEY.value()),
  });

  if (out.error) {
    if (out.logged) logger.error('Pack photo read failed', { uid, locationId, error: out.logged });
    const { code, message, ...details } = out.error;
    throw new HttpsError(code, message, details);
  }

  // The only place the bill is visible. Without it, a change in what a read costs is
  // invisible until the invoice arrives.
  logger.info('Pack photo read', {
    uid, locationId,
    images: Array.isArray(images) ? images.length : 0,
    ok: out.ok,
    reason: out.reason,
    characters: out.text ? out.text.length : 0,
    truncated: out.notes && out.notes.truncated,
    inputTokens: out.usage && out.usage.inputTokens,
    outputTokens: out.usage && out.usage.outputTokens,
    remaining: out.remaining,
  });

  const { usage, ...forThePhone } = out;
  return forThePhone;
});
