// What a list with no row to draw may say, from what its listener has told the screen so far. A port of `LIST_STATUS` and
// `listStatus` in js/orders/registry.js (the Ingredients and Suppliers lists; the Stocktake's has its own two-listener shape in
// inventory-model.ts). Only the two functions are ported: the rest of that file is the current app's screen.
//
// ⚠️ A CACHED EMPTY LIST ALONE IS NOT «NO CONNECTION»: a venue that really has none gets it the moment the page opens, a second
// before the server confirms it. So it counts only with the browser offline, or after `stalled`.
// ⚠️ NOTHING AT ALL UNTIL A VENUE IS OPEN: the screen does not know its language yet (Mise 2 always has one: its stores exist only
// inside an open venue).
//   venueOpen: a venue is open. loaded: the list has really answered. failed: its listener died.
//   emptyCopy: the phone's copy said «none». stalled: too long without an answer. online: navigator.onLine.
export const LIST_STATUS = Object.freeze({
  starting: 'starting', answered: 'answered', waiting: 'waiting', unreachable: 'unreachable', failed: 'failed',
} as const);

export type ListStatus = typeof LIST_STATUS[keyof typeof LIST_STATUS];

export interface ListStatusInput {
  readonly venueOpen?: unknown;
  readonly loaded?: unknown;
  readonly failed?: unknown;
  readonly emptyCopy?: unknown;
  readonly stalled?: unknown;
  readonly online?: unknown;
}

export function listStatus({ venueOpen, loaded, failed, emptyCopy, stalled, online }: ListStatusInput): ListStatus {
  if (loaded) return LIST_STATUS.answered;
  if (failed) return LIST_STATUS.failed;
  if (!venueOpen) return LIST_STATUS.starting;
  return stalled || (emptyCopy && online === false) ? LIST_STATUS.unreachable : LIST_STATUS.waiting;
}
