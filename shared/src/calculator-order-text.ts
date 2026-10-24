// calculator-order-text.ts — PURE: the WhatsApp order message the Calculator sends.
//
// TypeScript FULL port of js/calculator-order-text.js for Mise 2. calculator-order-text.spec.ts runs the
// current app's tests against BOTH files and parity.spec.ts compares the exports, so the two cannot drift
// while both apps are live.
//
// No DOM, no Firebase, so every rule below is asserted in a unit test (P15). This text is what a CLIENT
// actually receives, so the shape is pinned character for character: a change nobody notices here is a change
// nobody notices in somebody's inbox.

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

export interface OrderProduct {
  id?: unknown;
  name?: unknown;
}

export interface OrderEntry {
  client?: { name?: unknown } | null;
  products?: readonly (OrderProduct | null | undefined)[] | null;
}

export interface OrderLine {
  name: unknown;
  qty: number;
}

export interface OrderSection {
  index: number;
  name: unknown;
  lines: OrderLine[];
}

// The parts of an order that have something in them: one section per client that has at least one quantity
// above zero, keeping its own index so the caller can still address that client's rows.
//
// `qtyOf(entryIndex, productId)` hands over what was typed — passed in rather than read from the page, which
// is what keeps this testable.
//
// A client with nothing typed produces NO section at all: an empty heading in a message reads as "we want
// nothing from you", which is not what it means.
export function orderSections(
  entries: readonly (OrderEntry | null | undefined)[] | unknown,
  qtyOf: ((entryIndex: number, productId: unknown) => unknown) | null | undefined,
): OrderSection[] {
  const out: OrderSection[] = [];
  const read = typeof qtyOf === 'function' ? qtyOf : () => 0;
  (Array.isArray(entries) ? entries as (OrderEntry | null | undefined)[] : []).forEach((entry, index) => {
    if (!entry || !entry.client) return;
    const lines = (Array.isArray(entry.products) ? entry.products as (OrderProduct | null | undefined)[] : [])
      .filter((p): p is OrderProduct => Boolean(p))
      .map(p => ({ name: p.name, qty: num(read(index, p.id)) }))
      .filter(l => l.qty > 0);
    if (lines.length) out.push({ index, name: entry.client.name, lines });
  });
  return out;
}

// The message itself.
//
// ⚠️ `multi` is passed IN rather than derived from sections.length, and that is not an oversight. Sending
// everything together keeps naming each client even when only one of them ended up with quantities — because
// the title is then the LIST's name, and dropping the heading would leave a message that never says who it is
// for. Sending a single client passes false, and the title is that client's own name, so the heading would
// only repeat it.
export function buildOrderMessage(
  title: unknown,
  sections: readonly Partial<OrderSection>[] | unknown,
  multi: boolean,
): string {
  const body = (Array.isArray(sections) ? sections as Partial<OrderSection>[] : [])
    .map(s => (multi ? `*${String(s.name)}*\n` : '')
      + (s.lines || []).map(l => `- ${String(l.name)}: ${l.qty}`).join('\n'))
    .join('\n\n');
  return `*${(title as string) || 'Order'}*\n\n` + body;
}

// The one place the WhatsApp address is built. No recipient number: the message is composed and WhatsApp asks
// who to send it to — which is deliberate here, because one order often goes to a person rather than to a
// stored business number.
export function whatsappUrl(text: string): string {
  return 'https://wa.me/?text=' + encodeURIComponent(text);
}
