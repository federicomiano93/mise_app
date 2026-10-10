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
//
// ⚠️ TWO THINGS THAT ARE NOT THE SAME AS SEPARATE TAGS, both accepted (10 Oct 2026):
//  • A bundle imports the Firebase SDK at the top. If the SDK cannot load, NO script of the page
//    runs — sw-update.js (the update banner) included. The splash failsafe therefore lives in the
//    classic js/splash-init.js, which needs none of this. A fix still arrives: the browser checks
//    for a new service worker by itself, and a waiting worker activates once the app is closed.
//  • esbuild wraps each module in a lazy initialiser (`__esm`) that marks it DONE even when its
//    top level threw. Natively a module that threw re-throws the same error to every importer;
//    here a later script sees the module half-initialised and may fail with a secondary TypeError
//    instead. The first error is still reported, and it is the one to read.
const defaultReport = globalThis.reportError || (err => setTimeout(() => { throw err; }));

// report: where a failure goes (injected by the tests); the page uses the default above.
export function runInOrder(loaders, report = defaultReport) {
  let chain = Promise.resolve();
  for (const load of loaders) chain = chain.then(load).catch(report);
  return chain;
}
