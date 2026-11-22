import { useEffect } from 'react';
import { hasUnsavedWork } from '../session/busy';

// The browser's own «Leave this site? Changes you made may not be saved» question, asked when the window or the tab is closed or the page is
// reloaded while an editor holds the busy marker (session/busy.ts): ONE listener for every editor of the app, so «leaving never loses
// edits» does not depend on each editor remembering it. The words are the browser's; a page cannot change them.
//
// ⚠️ ONLY WHERE CLOSING WOULD LOSE SOMETHING: a QUIET hold (markBusy({ quiet }), session/busy.ts) is ignored by hasUnsavedWork — the kiosk's
// rest screen («nobody is looking»; the question would stand on a resting tablet for ever) and the offline «not sent yet» holds
// (Firestore's offline cache keeps those writes across a closed page).
// ⚠️ THE APP'S OWN RELOADS ASK NOTHING, TWO WAYS: the ones it starts by itself (a new release, a changed account) wait until nobody holds
// the marker (session/session.ts, shell/serviceWorker.ts); the ones it starts ON PURPOSE (a saved printer, a changed language, «Try again»)
// may happen with a hold still up, so every one of them calls markLeavingOnPurpose() first, and hasUnsavedWork says «nothing» for a moment.
// ⚠️ A tablet that is closed from the recent apps cannot be stopped by any page: the unsaved cake survives that another way (cakes/cakeParking.ts).
export function useLeaveWarning(): void {
  useEffect(() => {
    const ask = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWork()) return;
      event.preventDefault();
      // Older browsers read this assignment, not preventDefault.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', ask);
    return () => { window.removeEventListener('beforeunload', ask); };
  }, []);
}
