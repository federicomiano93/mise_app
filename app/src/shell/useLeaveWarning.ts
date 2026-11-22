import { useEffect } from 'react';
import { hasUnsavedWork } from '../session/busy';

// The browser's own «Leave this site? Changes you made may not be saved» question, asked when the window or the tab is closed or the page is
// reloaded while an editor holds the busy marker (session/busy.ts): ONE listener for every editor of the app, so «leaving never loses
// edits» does not depend on each editor remembering it. The words are the browser's; a page cannot change them.
//
// ⚠️ NOT FOR THE KIOSK'S REST SCREEN: its hold means «nobody is looking», and the question would stand on a resting tablet for ever
// (hasUnsavedWork ignores it). ⚠️ THE APP'S OWN RELOADS (a new release, a changed account) ASK NOTHING because they wait until nobody holds
// the marker (session/session.ts, shell/serviceWorker.ts), so by the time they reload this finds nothing to ask about.
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
