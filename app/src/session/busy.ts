// busy.ts — "is somebody in the middle of something?", asked before the app reloads by itself.
//
// The session reloads when the server's copy of who-you-are differs from the phone's, and a new release
// of the service worker reloads the page when it takes over (shell/serviceWorker.ts — also the way back
// to the current app after a revert). Either one under somebody's fingers throws
// away a half-typed form. ⚠️ Every screen that holds unsaved edits (the editors of step 3) must
// call markBusy() while it does, and release it when saved or discarded; a self-started reload
// waits until nobody is. Today it is called by the Pastries editor (pastries/Editor.tsx, from the
// first change until it is saved or discarded) and by the quick correction of one number on a day's
// list (pastries/DayPanel.tsx, while a number is typed and not yet written). Food cost holds it in the product
// editor while dirty, in Settings while dirty, and while a save is in the air (foodcost/ProductForm.tsx,
// FoodcostSettings.tsx, FoodcostContext.tsx). The Calculator holds it while a confirmed dough has not been
// answered by the database (calculator/CalculatorContext.tsx, BusyWhileUnsent), and its Settings editors hold it while dirty
// (calculator/SettingsEditor.tsx), and so does the market order form while quantities were changed by hand
// (calculator/OrderForm.tsx). Orders holds it while typing has not reached Firestore, while a day line is saved, and while a close
// as not ordered or a reopen is answered (orders/ordersStore.ts), and while a «did it go?» question stands only on this device
// (kept in memory after a refused write, until it is answered or the section stops: ordersStore.ts, syncLocalBusy). A send holds it
// from the press until it has settled — the chooser, every editor of the batch, and the hand-over to the caller who writes the
// question (orders/useSendOrder.tsx), and each send editor holds it while it is open (orders/SendEditorDialog.tsx). The holiday holds it while a picked day is not set yet
// (settings/AwayRow.tsx) and while a holiday change has not been answered by the server (shell/away/awayStore.ts). Added
// with the service worker (step 5): a client's ordering link while it is made or turned off (calculator/OrderingLink.tsx),
// a WhatsApp line typed and not added yet (calculator/WhatsappPicker.tsx) and what was typed on a HACCP label until it is
// printed (recipes/HaccpLabelBody.tsx). Food cost's lab mode holds it for as long as it is open (foodcost/lab/LabMode.tsx), with the
// screen wake lock, like the Recipe book's mix in progress. «Who can get in» holds it while an invitation is being made and while
// its code is on screen, shown once and never stored (settings/InviteCard.tsx); its people list while a change of role, a removal or a
// new name is with the server (settings/PeopleList.tsx) and while the rename form holds typing (settings/RenameDialog.tsx). A
// booking's editor holds it while it differs from the booking it opened (or holds a refused save brought back), until it is saved
// or discarded (bookings/BookingEditor.tsx). The receipt printer's screen holds it while the address or the plain-letters choice
// differs from the one saved on this device (bookings/PrinterScreen.tsx), and the bookings settings while they differ from the ones
// they opened on (bookings/BookingSettingsScreen.tsx). The note to Claude holds it while text is typed and not yet sent or discarded
// (feedback/FeedbackDialog.tsx).
// ⚠️ DELIBERATELY NOT A HOLDER: an unsaved cake set aside for the Recipes (cakes/cakeParking.ts). It sits in memory with nobody on its
// screen, possibly for ever; a hold for it would keep the device off every update and every rollback, and the person who left it may
// never come back. Losing it to a reload the app starts by itself is still the price, but a forced close no longer loses it: while a cake form
// is dirty a copy is also written on the device, and the list offers it again (the recipe editor it was parked for holds the mark while dirty).
// ⚠️ THE BROWSER'S OWN QUESTION: while anything but a QUIET hold (the kiosk's rest, the offline «not sent yet» holds) holds the mark, closing or reloading the page makes the browser ask
// «leave this page?» (shell/useLeaveWarning.ts), so every editor that holds the mark is protected from a closed window, not only from an update.
// ⚠️ A HOLD MUST END: a screen left open with a hold that never lets go keeps that device off every update, and off the
// way back after a revert. (Not the sign-in form for that reason: a browser's autofill or a half-typed address left on
// a shared tablet would block it for days, for a box that takes seconds to retype.) Each new editor adds itself here.

// The kiosk's rest screen holds it too, and is the one holder that means «nobody is looking», not «somebody is typing»
// (kiosk/kioskController.ts, staff slice 5, #406): while the tablet rests, a reload would drop the screen lock and Android would
// switch the screen off at once. It lets go only at the rest→night step, the one moment the current app let an update in by itself,
// and asks isBusyApartFrom() whether anybody ELSE holds the marker.

// Each hold is its own release function, so a holder can ask about everybody but itself.
const holders = new Set<() => void>();

// A hold that must NOT make the browser ask «leave this page?» (shell/useLeaveWarning.ts) is marked QUIET: the kiosk's rest screen
// («nobody is looking», not «somebody has typed something»), and the offline «not sent yet» holds, whose writes Firestore's own
// offline cache keeps across a closed page. `isBusy()` (the update banner, a self-started reload) still counts them all.
// `quiet` is `true`, or a function asked at the moment of closing («is there nothing to lose right now?»).
const quiet = new Map<() => void, () => boolean>();

export function markBusy(options: { quiet?: boolean | (() => boolean) } = {}): () => void {
  const release = () => { holders.delete(release); quiet.delete(release); };
  holders.add(release);
  const q = options.quiet;
  if (q === true) quiet.set(release, () => true);
  else if (typeof q === 'function') quiet.set(release, q);
  return release;
}

// The app's own deliberate reload or navigation away (a saved printer, a changed language, «Try again»): the page is going on purpose,
// so the browser's question has nothing to ask. It lets go after a few seconds, so a navigation that never happened (a refused
// address) cannot leave the page unprotected for good.
const LEAVING_GRACE_MS = 5000;
let leavingOnPurpose = false;
export function markLeavingOnPurpose(): void {
  leavingOnPurpose = true;
  setTimeout(() => { leavingOnPurpose = false; }, LEAVING_GRACE_MS);
}

// Is somebody holding something that a closed window would LOSE? The browser asks «leave this page?» only then.
export function hasUnsavedWork(): boolean {
  if (leavingOnPurpose) return false;
  for (const holder of holders) {
    const isQuiet = quiet.get(holder);
    if (isQuiet === undefined || !isQuiet()) return true;
  }
  return false;
}

export function isBusy(): boolean {
  return holders.size > 0;
}

// «Is somebody else in the middle of something?» — for a holder that must not count its own hold (the kiosk's rest screen).
// `mine` is the release function markBusy() gave it, or null when it holds nothing.
export function isBusyApartFrom(mine: (() => void) | null): boolean {
  for (const holder of holders) {
    if (holder !== mine) return true;
  }
  return false;
}
