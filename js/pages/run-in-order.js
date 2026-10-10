// Runs a page's scripts one after another, the way the browser ran them when each was its
// own <script type="module"> tag. Shared by every entry in js/pages/; scripts/build-bundles.mjs
// does NOT make a bundle of this file on its own.
//
// ⚠️ WHY EACH SCRIPT HAS ITS OWN CATCH. Separate module tags are isolated: one that throws
// does not stop the next one from running. A single failing script (say, a feature that is
// off for this venue) must not take the whole page down with it, so a failure is REPORTED —
// to window's `error` event, which is where error-report.js listens — and the chain goes on.
//
// ⚠️ WHY NO TOP-LEVEL AWAIT. The bundle holds every script, so each import() below settles
// in microtasks, with no network in between. All the scripts therefore still run before
// DOMContentLoaded, exactly as deferred module tags did; an `await` at the top of an entry
// would instead make the whole bundle one long module evaluation that other code cannot see.
const report = globalThis.reportError || (err => setTimeout(() => { throw err; }));

export function runInOrder(loaders) {
  let chain = Promise.resolve();
  for (const load of loaders) chain = chain.then(load).catch(report);
  return chain;
}
