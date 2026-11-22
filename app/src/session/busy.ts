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
// they opened on (bookings/BookingSettingsScreen.tsx).
// ⚠️ DELIBERATELY NOT A HOLDER: an unsaved cake set aside for the Recipes (cakes/cakeParking.ts). It sits in memory with nobody on its
// screen, possibly for ever; a hold for it would keep the device off every update and every rollback, and the person who left it may
// never come back. Losing it to a reload the app starts by itself is still the price, but a forced close no longer loses it: while a cake form
// is dirty a copy is also written on the device, and the list offers it again (the recipe editor it was parked for holds the mark while dirty).
// ⚠️ THE BROWSER'S OWN QUESTION: while anything but the kiosk's rest holds the mark, closing or reloading the page makes the browser ask
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

// The kiosk's rest screen is a hold that means «nobody is looking», not «somebody has typed something»: it is marked as a REST hold, which
// the browser's «leave this page?» question ignores (shell/useLeaveWarning.ts).
const resting = new Set<() => void>();

export function markBusy(options: { rest?: boolean } = {}): () => void {
  const release = () => { holders.delete(release); resting.delete(release); };
  holders.add(release);
  if (options.rest === true) resting.add(release);
  return release;
}

// Is somebody holding something that is NOT the kiosk's rest? The browser asks «leave this page?» only then: a resting tablet has
// written nothing that a closed window would lose.
export function hasUnsavedWork(): boolean {
  for (const holder of holders) {
    if (!resting.has(holder)) return true;
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
