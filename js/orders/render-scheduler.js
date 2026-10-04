// render-scheduler.js — collect «what needs redrawing» and draw it ONCE per frame. PURE.
//
// Orders is drawn from half a dozen live listeners (suppliers, ingredients, prices, history,
// draft, config, requests). On opening they land within milliseconds of each other, and
// every one of them used to redraw whole screens by itself, so a single burst redrew the same
// lists three or four times — on a tablet that stays open all day.
//
// A listener now only RECORDS its parts here (its data is still stored at once, in the
// listener itself); the page's flush function draws the union once, in the next animation
// frame. Two consequences, both wanted:
//   * a burst of snapshots costs one drawing pass;
//   * the browser does not run animation frames while the tab is hidden, so a hidden page
//     draws nothing and catches up with ONE pass when it is shown again.
//
// ⚠️ ONLY LISTENERS COME THROUGH HERE. A keystroke, a tap or a screen opening draws
// synchronously, exactly as before: the person is looking at that screen right now.
//
// `setPaused(true)` makes the flush wait while keeping everything recorded; `setPaused(false)`
// draws once. (A kiosk-style display that is switched off can park the page this way.)
export function createRenderScheduler({ flush, raf }) {
  const pending = new Set();
  let paused = false;
  let requested = false;

  function request() {
    if (requested || paused || !pending.size) return;
    requested = true;
    raf(run);
  }

  function run() {
    requested = false;
    if (paused || !pending.size) return;
    const parts = new Set(pending);
    pending.clear();
    try {
      flush(parts);
    } finally {
      // Parts recorded WHILE drawing (a draw that asks for another) get their own frame —
      // and a flush that throws must not leave the scheduler waiting for ever.
      request();
    }
  }

  return {
    schedule(...parts) {
      parts.forEach(p => pending.add(p));
      request();
    },
    setPaused(next) {
      paused = Boolean(next);
      request();
    },
    // What is waiting, for the tests.
    pending: () => new Set(pending),
  };
}
