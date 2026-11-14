// save-state-view.js — what the save-status line on Orders says (the order typed on the iPad, 14 Nov 2026).
//
// draft.js says whether everything typed on THIS device has reached the server ({ ready, saved }); this
// turns it into the line's state and words. No imports: the wording is handed in (translate), so the rule can be
// tested on its own.
//
//   ''        before the first snapshot of the draft: nothing is shown (the line keeps its room, so
//             nothing jumps when it appears);
//   'saved'   «Saved ✓»: nothing typed here is waiting or in the air;
//   'unsent'  «Not sent yet»: something typed here is waiting, in the air or was refused — and also
//             while the device is offline, when nothing can be confirmed.
export function saveStateView({ ready, saved } = {}, online = true) {
  if (!ready) return { state: '', key: '' };
  if (saved && online) return { state: 'saved', key: 'orders.saveState.saved' };
  return { state: 'unsent', key: 'orders.saveState.unsent' };
}

// Paint one line. The text changes only with the state, so a screen reader hears each change once.
export function paintSaveState(node, view, translate) {
  if (!node) return;
  const text = view.key ? translate(view.key) : '';
  if (node.dataset.state === view.state && node.textContent === text) return;
  node.dataset.state = view.state;
  node.textContent = text;
}
