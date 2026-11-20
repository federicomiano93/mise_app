// liveOrdersLines.ts — the Orders section answering the kiosk's rest screen from its own live data (staff slice 6; the current app's
// `kiosk-rest-info` window event, answered by its Orders page). While the section is open its store registers here
// (orders/OrdersContext.tsx); the rest screen then draws the store's lines and reads nothing itself (restOrders.ts). A module, not a
// context: the kiosk is mounted beside the session gate, outside the section's tree, and a section must not import the kiosk's
// screens (only this tiny register).

import type { KioskSection } from '@mise/shared/kiosk-lines';

// The store's answer: the sections, or null while its data has not all arrived (ordersStore.kioskSections()).
type Provider = () => KioskSection[] | null;

let provider: Provider | null = null;
const listeners = new Set<() => void>();
const announce = () => { listeners.forEach(listener => { listener(); }); };

// Registers the open section's answer; the returned function takes it away (only if it is still the one registered).
export function provideKioskLines(answer: Provider): () => void {
  provider = answer;
  announce();
  return () => { if (provider === answer) { provider = null; announce(); } };
}

// Told when the section opens or closes (a rest that outlives the section must start reading by itself). Returns the unsubscribe.
export function subscribeLiveKioskLines(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

// Whether the Orders section is open and answers.
export function liveKioskLinesShown(): boolean {
  return provider !== null;
}

// The live answer: the store's sections ([] while its data is still arriving), or null when the section is not open.
export function liveKioskLines(): KioskSection[] | null {
  if (provider === null) return null;
  return provider() ?? [];
}
