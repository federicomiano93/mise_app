// pageHidden.ts — the moment the page goes out of sight, for the Orders draft (F-15, the current app's flushDraftWhenHidden in
// js/orders/draft.js).
//
// ⚠️ THE PAGE GOING OUT OF SIGHT IS THE MOMENT TO SEND WHAT IS WAITING. Switching app or locking the screen hides the page
// while it is still alive, with time for the write to reach the browser's own database and for the snapshot that clears the
// note. NOT when the page is going away for good (pagehide comes first there): there is no time left, and a write that did
// get through would leave its note behind, to be read as unsent the next time, after a colleague may have placed that order.
// Going away for good is what the note is for (@mise/shared/draft-journal).

// The two event targets it listens to; a spec passes its own.
export interface PageEvents {
  readonly doc: Pick<Document, 'addEventListener' | 'removeEventListener' | 'visibilityState'>;
  readonly win: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

// Calls `run` each time the page is hidden while still alive. Returns the unsubscribe.
export function watchPageHidden(run: () => void, events: PageEvents = { doc: document, win: window }): () => void {
  const { doc, win } = events;
  let leaving = false;
  const onPageHide = () => { leaving = true; };
  // Back from the browser's page cache: alive after all.
  const onPageShow = () => { leaving = false; };
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden' && !leaving) run();
  };
  win.addEventListener('pagehide', onPageHide);
  win.addEventListener('pageshow', onPageShow);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    win.removeEventListener('pagehide', onPageHide);
    win.removeEventListener('pageshow', onPageShow);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
