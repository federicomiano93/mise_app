// The marks a move inside Bookings carries in the router's state (18 Nov 2026).

// A booking opened from the list: its Back is the browser's Back, so the history never holds the list twice. `keepFocus`: the
// page leaves the focus to the booking, which puts it on its own title (shell/Page.tsx KEEP_FOCUS).
export const FROM_LIST = { fromBookingsList: true, keepFocus: true } as const;

export function cameFromList(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromBookingsList' in state;
}

// Back to the list after a save: the list opens on the booking's day, and the page keeps the focus where the editor puts it.
export function afterSave(date: string, id: string | null): { readonly bookingSavedDate: string; readonly bookingSavedId: string | null; readonly keepFocus: true } {
  return { bookingSavedDate: date, bookingSavedId: id, keepFocus: true };
}

// The booking just saved, whose row takes the focus when the list shows it.
export function savedIdOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('bookingSavedId' in state)) return null;
  const value = (state as { bookingSavedId: unknown }).bookingSavedId;
  return typeof value === 'string' && value !== '' ? value : null;
}

export function savedDateOf(state: unknown): string | null {
  if (typeof state !== 'object' || state === null || !('bookingSavedDate' in state)) return null;
  const value = (state as { bookingSavedDate: unknown }).bookingSavedDate;
  return typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value) ? value : null;
}

// The editor of a new booking opened to put back a save the server refused (bookingsStore.ts, RefusedSave).
export const RESTORE_REFUSED = { restoreRefusedBooking: true } as const;

export function restoresRefused(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'restoreRefusedBooking' in state;
}
