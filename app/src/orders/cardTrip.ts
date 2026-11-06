// cardTrip.ts — the place of a trip from «Orders» to a card of «Ingredients & suppliers» (step 3f-8b, his choice «doors A»), so Back
// lands on the same screen: the same address, the same scroll, the focus on the door that was pressed, and — in the flat view — the
// search text and the frozen «Ordering» set.
//
// ⚠️ ORDERS IS UNMOUNTED WHILE THE PERSON IS AWAY: the place written down in the section would die with it, so it is kept HERE, in module
// state, and the next Orders section that appears by a Back (a POP) at the same address takes it (the recipe's door to Food cost does
// the same: recipes/recipeReturn.ts). It is forgotten on every mount, taken or not, so a later visit never replays an old trip.

// What was pressed: an ingredient's name (its card), the «+» of a supplier's screen, or the supplier's name in that screen's bar.
export type TripTarget =
  | { readonly kind: 'name'; readonly ingredientId: string }
  | { readonly kind: 'add' }
  | { readonly kind: 'supplier' };

export interface TripPlace {
  readonly pathname: string;
  readonly target: TripTarget;
  // The flat view's search text and frozen set (ids), when the door was pressed there; '' and null otherwise.
  readonly query: string;
  readonly only: readonly string[] | null;
  // How far the shell's scroll area and the split's right-hand pane were scrolled.
  readonly area: number | null;
  readonly pane: number | null;
}

let carried: TripPlace | null = null;
export function carryTrip(place: TripPlace): void { carried = place; }
export function carriedTrip(): TripPlace | null { return carried; }
export function forgetTrip(): void { carried = null; }
