// save-state.ts — what the save-status line on Orders says (the order typed on the iPad, 14 Nov 2026).
// TypeScript ADAPTED port of the view rule of js/orders/save-state-view.js (v1.145.0, on main only): the rule is
// identical, but the KEYS are Mise 2's own (`ord.saveState.*`, which the screen hands to t() directly) where the
// original names the current app's `orders.saveState.*`. `paintSaveState` (it paints a DOM node) is left out: the
// screen is React.
//
// The draft layer says whether everything typed on THIS device has reached the server ({ ready, saved }); this
// turns it into the line's state and words.
//
//   ''        before the first snapshot of the draft: nothing is shown (the line keeps its room, so
//             nothing jumps when it appears);
//   'saved'   «Saved ✓»: nothing typed here is waiting or in the air;
//   'unsent'  «Not sent yet»: something typed here is waiting, in the air or was refused — and also
//             while the device is offline, when nothing can be confirmed.

export interface SaveStateView {
  readonly state: '' | 'saved' | 'unsent';
  readonly key: '' | 'ord.saveState.saved' | 'ord.saveState.unsent';
}

export function saveStateView({ ready, saved }: { ready?: unknown; saved?: unknown } = {}, online = true): SaveStateView {
  if (!ready) return { state: '', key: '' };
  if (saved && online) return { state: 'saved', key: 'ord.saveState.saved' };
  return { state: 'unsent', key: 'ord.saveState.unsent' };
}
