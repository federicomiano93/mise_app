// saveStateView.ts — what the «Saved ✓» / «Not sent yet» line on Orders says. A port of the current app's
// js/orders/save-state-view.js (PR #551, the order typed on the iPad, 14 Nov 2026), not paired: the stack's js/ predates it.
//
//   ''        before the first snapshot of the draft: nothing is shown (the line keeps its room, so nothing jumps when it appears);
//   'saved'   «Saved ✓»: nothing typed here is waiting or in the air;
//   'unsent'  «Not sent yet»: something typed here is waiting, in the air or was refused — and also while the device is offline,
//             when nothing can be confirmed.
import type { MessageKey } from '../i18n/en';
import type { SaveState } from './draftSync';

export type SaveLine = { readonly state: '' | 'saved' | 'unsent'; readonly key: MessageKey | null };

export function saveStateView({ ready, saved }: SaveState, online = true): SaveLine {
  if (!ready) return { state: '', key: null };
  if (saved && online) return { state: 'saved', key: 'ord.saveState.saved' };
  return { state: 'unsent', key: 'ord.saveState.unsent' };
}
