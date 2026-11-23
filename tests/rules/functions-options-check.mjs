// functions-options-check.mjs — loads the REAL functions/index.js and checks what Google will be
// told about every function: each one has a ceiling on its copies, and none above the global one.
//
//   node tests/rules/functions-options-check.mjs      (needs functions/node_modules)
//
// tests/functions-global-options.test.mjs pins that global-options.js is imported first; this
// checks the RESULT, which the order alone cannot promise: a function that states its own
// `maxInstances: 100`, or global-options.js reaching a different copy of firebase-functions (the
// CommonJS build), would leave that test green and deploy at Google's default of 100.
//
// It runs in CI in the `rules` job, after the server's packages are installed — the job that
// gates deploy-functions. Loading index.js starts the Admin SDK but makes no call; the emulator
// variables and a `demo-` project id are set anyway, before anything loads, so that nothing in
// it could ever reach a real project. Not named *.test.mjs: the `test` job has no
// functions/node_modules.

process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = 'demo-theitalianclub';

const { MAX_INSTANCES } = await import('../../functions/global-options.js');
const functions = await import('../../functions/index.js');

const problems = [];
let count = 0;
for (const [name, value] of Object.entries(functions)) {
  if (!value || !value.__endpoint) continue;
  count += 1;
  const max = value.__endpoint.maxInstances;
  if (!Number.isInteger(max) || max < 1 || max > MAX_INSTANCES) {
    problems.push(`${name}: maxInstances ${max} (expected 1..${MAX_INSTANCES})`);
  }
}
if (count === 0) problems.push('no function found in functions/index.js');

if (problems.length) {
  console.error('Functions without a proper ceiling:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`functions-options-check: ${count} functions, every one capped at ${MAX_INSTANCES} copies or fewer.`);
process.exit(0);
