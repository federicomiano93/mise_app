// busy.ts — "is somebody in the middle of something?", asked before the app reloads by itself.
//
// The session reloads when the server's copy of who-you-are differs from the phone's, and the
// service worker will reload for an update (step 5). Either one under somebody's fingers throws
// away a half-typed form. Every screen that holds unsaved edits marks itself busy while it does
// (useBusy), and a self-started reload waits until nobody is.

const holders = new Set<symbol>();

export function markBusy(): () => void {
  const token = Symbol('busy');
  holders.add(token);
  return () => { holders.delete(token); };
}

export function isBusy(): boolean {
  return holders.size > 0;
}
