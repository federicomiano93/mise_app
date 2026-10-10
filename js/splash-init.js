// Splash gate: show the Home splash logo only on the FIRST Home load of a
// browsing session. On every later return to Home (from a feature page) we add
// the `no-splash` class synchronously — before first paint — so the logo never
// flashes. Must load as a render-blocking classic <script> in <head> (not a
// module, not deferred) so the class is on <html> before <body> is painted.
//
// ⚠️ IT ALSO CARRIES THE SPLASH'S LAST-RESORT FAILSAFE, AND THAT IS WHY IT HAS TO STAY A CLASSIC
// SCRIPT WITH NO IMPORTS. js/orders/boot.js lifts the splash at 4 s whatever happens — but it now
// lives inside the page bundle (dist/index.js), and a bundle imports the Firebase SDK at the top:
// when the SDK cannot load (offline, a module not cached) NO module of the page runs, boot.js
// included, and the Home would stay on the logo for ever. This timer needs nothing, so it runs
// anyway. It does the same thing boot.js does (fade class, remove after the fade), so whichever
// fires first wins and the other finds the splash gone.
(function () {
  var showsSplash = true;
  try {
    if (sessionStorage.getItem('splashShown')) {
      document.documentElement.classList.add('no-splash');
      showsSplash = false;
    } else {
      // First Home load this session: let the splash show, remember it for later.
      sessionStorage.setItem('splashShown', '1');
    }
  } catch (e) {
    // sessionStorage blocked (rare private-mode cases) → fall through and show the
    // splash as before. Harmless: worst case the logo appears when it need not.
  }
  if (!showsSplash || typeof document === 'undefined') return;
  setTimeout(function () {
    var splash = document.getElementById('splash');
    if (!splash) return;
    splash.classList.add('splash--hide');
    setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 500);
  }, 4000);
})();
