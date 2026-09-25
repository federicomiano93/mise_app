// boot.js — splash overlay for the Home page. (Service-worker registration,
// which used to live here too, moved to js/sw-update.js, shared by every page.)

// Splash overlay (index.html only): fade it out once the page is ready, then
// remove it from the DOM. A minimum visible time avoids an ugly flash on fast
// loads; a safety timeout guarantees the splash is never left covering the home.
(function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash) return; // pages without a splash (e.g. orders.html)

  // Splash already spent this session (returning to Home): it was never painted
  // (CSS .no-splash), so just drop it from the DOM instantly — no delay, no fade.
  if (document.documentElement.classList.contains('no-splash')) {
    splash.remove();
    return;
  }

  const MIN_VISIBLE_MS = 600;  // keep it on screen at least this long
  const SAFETY_MS = 4000;      // hard cap: always remove the splash by now
  const start = performance.now();
  let removed = false;
  let dismissed = false;

  const remove = () => {
    if (removed) return;
    removed = true;
    splash.classList.add('splash--hide');
    // Drop it after the CSS fade so it can't intercept taps on the home.
    setTimeout(() => splash.remove(), 500);
  };

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    const waited = performance.now() - start;
    setTimeout(remove, Math.max(0, MIN_VISIBLE_MS - waited));
  };

  // ⚠️ THE FAILSAFE COMES FIRST AND NEEDS NOTHING. It is armed before anything is
  // loaded, so the splash lifts at 4 s even when the Firebase SDK cannot load at all
  // (offline, nothing cached): a static import of firebase.js here would have taken the
  // failsafe down with it (code review, 23 Sep 2026).
  setTimeout(remove, SAFETY_MS);
  if (document.readyState === 'complete') dismiss();
  else window.addEventListener('load', dismiss);

  // ⚠️⚠️ THE APP BEING READY IS WHAT LIFTS IT, NOT THE PAGE'S `load` (speed audit,
  // 23 Sep 2026). `load` waits for EVERY resource — on the live site that includes
  // reCAPTCHA for App Check, 332 KB that draws nothing and, in monitor mode, blocks
  // nothing — so the splash covered a Home that was already usable. The session
  // settling (signed in and a venue open, the sign-in form, the venue picker…) is the
  // moment there is something to show. `load` and the failsafe above stay as the
  // second and third signals.
  import('../firebase.js')
    .then(({ onSession }) => onSession((session) => {
      if (session.status !== 'loading') dismiss();
    }))
    .catch(() => { /* the failsafe above lifts it */ });
})();
