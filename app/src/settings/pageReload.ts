import { BUSY_RETRY_MS } from '../session/session';
import { isBusy } from '../session/busy';

// The one place Settings reloads the page. A screen that changes what EVERY screen reads (the venue's language) cannot repaint them
// all — a reload is honest and takes a moment (the current app's language.js says the same). It is an object, not bare functions, so a
// spec can see the reload without the page going away: `vi.spyOn(pageReload, 'reload')`.
export const pageReload = {
  // How long to wait before asking again whether somebody is still typing (the session's own pause).
  retryMs: BUSY_RETRY_MS,

  reload(): void {
    window.location.reload();
  },

  // ⚠️ NEVER UNDER SOMEBODY'S FINGERS: a reload throws away a half-typed form. The rule is the session's reloadWhenIdle (session.ts): if
  // an editor holds the busy marker (session/busy.ts), wait and ask again, then reload. The language HAS changed on the server by now, so
  // the reload is owed, not optional — it only waits.
  reloadWhenIdle(): void {
    if (isBusy()) {
      setTimeout(() => { pageReload.reloadWhenIdle(); }, pageReload.retryMs);
      return;
    }
    pageReload.reload();
  },
};
