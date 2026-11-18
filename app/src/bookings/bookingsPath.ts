// What the address under /bookings says to show (18 Nov 2026).
//
//   /bookings              the list (which day it shows is the section's own state: today, tomorrow, later, a past day)
//   /bookings/new          a new booking
//   /bookings/printer      this device's receipt printer (bookings step 3)
//   /bookings/settings     the venue's bookings settings (whoever manages bookings; bookings settings, 18 Nov 2026)
//   /bookings/<id>         one booking
//   /bookings/<id>/edit    its editor
//   anything else          unknown: the section goes back to /bookings
//
// An id is Firestore's automatic one (20 letters and digits); `new` can never be one.
export const BOOKINGS_PATH = '/bookings';

export type BookingsView =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'printer' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'booking'; readonly id: string }
  | { readonly kind: 'edit'; readonly id: string }
  | { readonly kind: 'unknown' };

const ID_RE = /^[A-Za-z0-9]{1,40}$/;

// `rest` is what follows /bookings: React Router's «*» (undefined or '' for /bookings itself).
export function parseBookingsPath(rest: string | undefined): BookingsView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  const [first, second] = parts;
  if (parts.length === 0) return { kind: 'list' };
  if (parts.length === 1 && first === 'new') return { kind: 'new' };
  if (parts.length === 1 && first === 'printer') return { kind: 'printer' };
  if (parts.length === 1 && first === 'settings') return { kind: 'settings' };
  if (first === undefined || first === 'new' || first === 'printer' || first === 'settings' || !ID_RE.test(first)) return { kind: 'unknown' };
  if (parts.length === 1) return { kind: 'booking', id: first };
  if (parts.length === 2 && second === 'edit') return { kind: 'edit', id: first };
  return { kind: 'unknown' };
}

export const newBookingPath = (): string => `${BOOKINGS_PATH}/new`;
export const printerPath = (): string => `${BOOKINGS_PATH}/printer`;
export const settingsPath = (): string => `${BOOKINGS_PATH}/settings`;
export const bookingPath = (id: string): string => `${BOOKINGS_PATH}/${encodeURIComponent(id)}`;
export const editBookingPath = (id: string): string => `${BOOKINGS_PATH}/${encodeURIComponent(id)}/edit`;

// The name the usage record gives each screen (shell/sections.ts screenNameFor): never the id, never a customer.
export function bookingsScreenName(rest: string): string {
  const view = parseBookingsPath(rest);
  if (view.kind === 'new' || view.kind === 'edit') return 'bookings-editor';
  if (view.kind === 'booking') return 'bookings-detail';
  if (view.kind === 'printer') return 'bookings-printer';
  if (view.kind === 'settings') return 'bookings-settings';
  return 'bookings';
}
