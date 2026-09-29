// level-stack.js — closing ONE level of the registry's stack, by identity.
//
// ⚠️ WHY THIS IS NOT stack.pop(). A save or a delete answers AFTER an await. On a tablet,
// something else may have been opened in the pane meanwhile (tapping another row replaces
// it), and a pop() would then close THAT level and throw away whatever was typed into it.
// A level therefore closes itself: it removes its own entry, and if the entry is already
// gone — cleared, replaced, or closed twice — nothing happens.
//
// PURE (an array in, an array mutated), so the rule is tested without a DOM.

// Removes `entry` from `stack` and returns it, or returns null when it is not there.
// Levels above or below it are left exactly as they were.
export function removeLevel(stack, entry) {
  const index = entry ? stack.indexOf(entry) : -1;
  if (index < 0) return null;
  stack.splice(index, 1);
  return entry;
}
