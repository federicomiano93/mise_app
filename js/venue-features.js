// venue-features.js — which optional panels this venue uses.
//
// PURE, AND ZERO IMPORTS ON PURPOSE. Both halves of the app ask it — Orders, where
// an allergen is DECLARED, and the Catalogue, where it is read, rolled up and
// printed — so it sits in js/ root beside allergen-model.js and price-model.js
// rather than inside either feature's folder. A second copy of this judgement is a
// second answer to "does this venue use allergens", and the two would disagree on
// the day one of them was edited.
//
// ⚠️⚠️ A DISPLAY SWITCH, NEVER A DATA SWITCH. Turning allergens off hides the
// screens; it deletes nothing, and every tick, stamp and nutrition figure already
// stored comes back untouched the moment it is switched on again. The forms still
// READ what is stored and save it back unchanged — see the note in
// js/orders/ingredient-form.js, which is where that property has to hold.
//
// ⚠️ THE DEFAULT IS ON, AND THE DIRECTION IS THE WHOLE SAFETY ARGUMENT. `!== false`
// means a location document that has never heard of these keys, one that failed to
// load, and one carrying a corrupt value all answer ON. The opposite direction
// would let a typo, a half-written document or a slow first paint quietly remove
// the one part of this app that can send somebody to hospital — and nothing on
// screen would say so. It is the same direction, for the same reason, as showStock
// in js/orders/orders-config.js.
//
// ⚠️ AND IT IS NOT INSIDE `sections`. sectionOn() reads a MISSING key as true, so
// these would work by accident today and become impossible to switch off cleanly
// later; `sections` also decides which Home cards exist, which is a different
// question from what one card shows. Same reasoning as recipePhoto — see
// functions/recipe-photo-model.js.

// Does this venue track allergens at all?
//
// When this is false the app must not merely hide the tick boxes: the recipe's
// allergen card, the allergen sheet and the LABEL go with them. A label without its
// allergen line is worse than no label, so the way to it disappears too.
export function allergensOn(locationDoc) {
  return read(locationDoc, 'showAllergens');
}

// Does this venue track nutrition figures?
//
// Independent of the above: a bakery may well declare allergens (the law) and never
// type a single kilojoule (not the law, for most of what it sells).
export function nutritionOn(locationDoc) {
  return read(locationDoc, 'showNutrition');
}

// The keys, in one place, so the callable and its tests cannot drift from the app.
export const FEATURE_KEYS = Object.freeze(['showAllergens', 'showNutrition']);

function read(locationDoc, key) {
  if (!locationDoc || typeof locationDoc !== 'object') return true;
  return locationDoc[key] !== false;
}
