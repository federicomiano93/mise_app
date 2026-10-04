// save-guard.js — one in-flight guard for a screen's header Save.
//
// With Save in the green header it is always under the thumb, so a second tap while the
// first write is still travelling is easy. The guard makes that tap do nothing, shows the
// button as disabled for the duration (and gives it back afterwards — to `idleDisabled()`
// for the screens whose Save is disabled until something changed), and tells the screen's
// Back / Home buttons to ignore a tap until the save has settled (`guard.saving`).
//
// It adds no dialog and decides nothing about the save itself: `run(fn)` simply runs `fn`
// once at a time. The confirmation dialogs stay inside `fn`, so the button is disabled
// while they are open too — harmless, the dialog is modal — and comes back if they are
// cancelled.

export function createSaveGuard(getButton, idleDisabled = () => false) {
  let saving = false;
  const paint = (disabled) => {
    const btn = getButton();
    if (btn) btn.disabled = disabled;
  };
  return {
    get saving() { return saving; },
    async run(fn) {
      if (saving) return undefined;
      saving = true;
      paint(true);
      try {
        return await fn();
      } finally {
        saving = false;
        paint(idleDisabled());
      }
    },
  };
}
