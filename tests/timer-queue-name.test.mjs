// WHICH QUEUE a timer alarm is booked onto.
//
// ⚠️⚠️ THIS IS THE TEST THAT WOULD HAVE SAVED THE WHOLE FEATURE. Notifications
// shipped, were declared live, and were then carried for months as "nobody has
// ever received one" — with the phone, the permission, the token and the service
// worker each suspected in turn. None of them was the fault. The booking call
// said:
//
//     getFunctions().taskQueue(QUEUE, REGION)
//
// and that second parameter is NOT the region. firebase-admin reads it as the
// canonical id of an EXTENSION and builds `ext-us-central1-sendTimerPush`, a
// queue that has never existed here. Every enqueue 404'd, so no job was ever
// scheduled and nothing could ever ring. (lib/functions/functions.js turns the
// string into `{ scope: 'extensionOrKit', instance: … }`;
// functions-api-client-internal.js then prefixes it. Same in 13 and in 14.)
//
// ⚠️ NOTHING ELSE IN THIS REPO CAN SEE IT. The call is perfectly valid
// JavaScript, the argument is a real region, the deploy succeeds, the logs say
// "Alarm scheduled" — because the log line runs after an enqueue that threw
// nothing the caller checks. The only visible symptom is silence, which is
// exactly what a working app looks like when nobody has set a timer.
//
// Asserted against the SOURCE for the same reason as tests/order-request-notify:
// the function needs the Admin SDK, Firestore and a live event, none of which
// exist under `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(ROOT, 'functions', 'index.js'), 'utf8');

const callArgs = () => {
  const m = src.match(/getFunctions\(\)\s*\.taskQueue\(([^)]*)\)/);
  assert.ok(m, 'functions/index.js no longer books the alarm through taskQueue() — ' +
    'if the scheduling moved, this test moves with it, it does not get deleted');
  return m[1].trim();
};

// ⚠️ THE SECOND ARGUMENT IS THE WHOLE BUG, so the test refuses it by shape rather
// than by name: any second argument here is an extension id, whatever it is
// called at the call site.
test('⚠️ the queue is named with ONE argument — a second one means an extension', () => {
  assert.equal(callArgs().includes(','), false,
    'taskQueue() takes the function name and, optionally, the canonical id of an ' +
    'EXTENSION — never a region. A second argument silently books every alarm onto ' +
    '`ext-<it>-<function>`, which does not exist, and no notification can ever arrive.');
});

// Passing the bare name would work today, because the library's default location
// happens to equal REGION. That is an accident, and a deploy that moved region
// would break the alarms again with nothing to read.
test('the region is stated in the resource name, not left to a library default', () => {
  const args = callArgs();
  assert.match(args, /locations\//,
    'book the alarm on `locations/<region>/functions/<queue>` so the region is parsed, ' +
    'not assumed');
  assert.match(args, /\/functions\//);
  assert.match(args, /\$\{REGION\}/,
    'the region must come from the REGION constant every other function uses, so one ' +
    'move cannot leave the queue behind');
});
