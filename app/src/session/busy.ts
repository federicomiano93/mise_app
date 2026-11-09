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
// as not ordered or a reopen is answered (orders/ordersStore.ts). The holiday holds it while a picked day is not set yet
// (settings/AwayRow.tsx) and while a holiday change has not been answered by the server (shell/away/awayStore.ts). Added
// with the service worker (step 5): a client's ordering link while it is made or turned off (calculator/OrderingLink.tsx),
// a WhatsApp line typed and not added yet (calculator/WhatsappPicker.tsx) and what was typed on a HACCP label until it is
// printed (recipes/HaccpLabelBody.tsx).
// ⚠️ A HOLD MUST END: a screen left open with a hold that never lets go keeps that device off every update, and off the
// way back after a revert. (Not the sign-in form for that reason: a browser's autofill or a half-typed address left on
// a shared tablet would block it for days, for a box that takes seconds to retype.) Each new editor adds itself here.

const holders = new Set<symbol>();

export function markBusy(): () => void {
  const token = Symbol('busy');
  holders.add(token);
  return () => { holders.delete(token); };
}

export function isBusy(): boolean {
  return holders.size > 0;
}
