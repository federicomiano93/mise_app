// The ceiling every function gets unless it states its own.
//
// ⚠️ WHY A CEILING AT ALL: without one, Google may start up to 100 copies of a
// function at once. A loop in a phone, a burst of writes or somebody hammering a
// callable would then bill 100 copies in parallel. Ten copies are far more than
// this app has ever needed (each copy serves many requests at the same time) and
// a runaway is capped at a tenth of the cost. The photo readers keep their own
// ceiling (PHOTO_CALL in recipe-photo.js): a function's own option wins over this.
//
// ⚠️⚠️ THIS FILE MUST BE THE FIRST IMPORT OF index.js. firebase-functions reads the
// global options at the moment each function is DEFINED, and an `import` (or an
// `export … from`) runs the imported file before index.js's own code. A function
// defined before this file ran would silently keep Google's default of 100 — the
// deploy would succeed and nothing would look different.
// tests/functions-global-options.test.mjs pins the order.
import { setGlobalOptions } from 'firebase-functions/v2';

export const MAX_INSTANCES = 10;

setGlobalOptions({ maxInstances: MAX_INSTANCES });
