// busy.ts — "is somebody in the middle of something?", asked before the app reloads by itself.
//
// The session reloads when the server's copy of who-you-are differs from the phone's, and the
// service worker will reload for an update (step 5). Either one under somebody's fingers throws
// away a half-typed form. ⚠️ Every screen that holds unsaved edits (the editors of step 3) must
// call markBusy() while it does, and release it when saved or discarded; a self-started reload
// waits until nobody is. Today it is called by the Pastries editor (pastries/Editor.tsx, from the
// first change until it is saved or discarded) and by the quick correction of one number on a day's
// list (pastries/DayPanel.tsx, while a number is typed and not yet written). Each new editor adds
// itself here.

const holders = new Set<symbol>();

export function markBusy(): () => void {
  const token = Symbol('busy');
  holders.add(token);
  return () => { holders.delete(token); };
}

export function isBusy(): boolean {
  return holders.size > 0;
}
