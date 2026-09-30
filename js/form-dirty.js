// form-dirty.js — «has anything been typed into this form since it opened?»
//
// Used by the tablet split on suppliers.html (tapping another row replaces what is open in
// the pane) and by js/ingredient-create.js (Back on a new ingredient's card, from a recipe
// row or from a supplier's order screen): a card with unsaved typing must ask before it is
// thrown away (P20).
//
// GENERIC ON PURPOSE. The two cards are big (allergen ticks, prices, packs, nutrition) and
// live in js/ root; teaching this file about each field would rot the day one is added. So
// it snapshots EVERY input, select and textarea right after the form is built and compares
// at leave time.
//
// ⚠️ ONLY THE FIELDS THAT EXISTED AT SNAPSHOT TIME ARE COMPARED. A field the card draws
// later (a panel opened, a list grown) is not «a change» — the false alarm would teach
// people to tap OK without reading, which is worse than the rare missed prompt.
//
// PURE: it reads `.value` / `.checked` off whatever `querySelectorAll` returns, so it is
// tested without a DOM (this project has no jsdom).

// Controls that carry no typed value.
const IGNORED_TYPES = ['button', 'submit', 'reset', 'image', 'file'];

// -> [{ field, value, checked }]
export function snapshotFields(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return [];
  return [...root.querySelectorAll('input, select, textarea')]
    .filter((field) => !IGNORED_TYPES.includes(field.type))
    .map((field) => ({ field, value: field.value, checked: !!field.checked }));
}

// true when any snapshotted field now differs from what it held at snapshot time.
export function snapshotChanged(snapshot) {
  return (snapshot || []).some(({ field, value, checked }) =>
    field.value !== value || !!field.checked !== checked);
}
