// order-text.ts — the WhatsApp message for an order. PURE: no DOM, no Firestore.
//
// TypeScript port of js/orders/order-text.js for Mise 2. Behaviour is identical, input for input:
// order-text.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the original
// paid for in bugs.
//
// Extracted from preview.js because the same text is now built from two different
// sources: the draft (the order you are typing) and a history record (an order
// already placed, which you may want to send, or send again). Keeping one builder
// means the supplier can never receive two differently-formatted messages for the
// same order.
//
// The format (one supplier — «Ordine» on an Italian venue; with several suppliers each
// one's lines sit under a bold *Supplier name* heading):
//   *Order — The Italian Club*
//
//   - Bacon: 5
//   - Mozzarella: 2
//
// The pack weight is NOT in the message (the owner's decision, 5 Oct 2026: «togli il peso
// dal messaggio whatsapp»). ⚠️ ONE EXCEPTION, ours: two lines of the same block with the same
// name keep their weights — «- Flour 5kg: 2», «- Flour 25kg: 3» — or nobody could tell them
// apart (messageLabels). The screens still show the weight everywhere.
//
// The order unit (casse/box) is a private reminder on the order screen and is NOT in
// the message — the supplier gets the number only.
// ⚠️ ONE EXCEPTION: a line of an ingredient that can be ordered in more than one unit
// («cartone» or «busta») says which — «- Flour: 2 × busta» — because 2 of the
// wrong one is a different order. The item carries `unit` only for those lines
// (order-unit.ts decides), so every other line stays byte-identical.
//
// The name in the title is the LOCATION PLACING THE ORDER, passed in by the caller
// from the session. It used to be the constant 'The Italian Club', which was harmless
// with one location and wrong the moment there were two: a supplier would receive
// another location's order signed with this one's name. With no name the title
// falls back to a plain '*Order*' — anonymous is recoverable, wrong is not.

import { lineUnit, cleanUnit, qtyWithUnit } from './order-unit';
import { labelWord } from './market';

// One line of a message: a name, its weight, a quantity and, only for an ingredient that can be ordered in more
// than one unit, the unit.
export interface OrderItem { name: unknown; weight: unknown; qty: unknown; unit?: string }

// ⚠️ THE TITLE WORD FOLLOWS THE VENUE'S COUNTRY, NOT THE SCREEN. The supplier reads this
// message in the language of the place the food is bought in, whatever language the owner's
// phone speaks. `language` is outputLanguage(location) — 'it' | 'en' | null — passed in by
// the caller so this file stays pure; null (country not set) falls back to English.
export function orderTitle(locationName?: unknown, language: unknown = null): string {
  const word = labelWord('orderTitle', language);
  const name = String(locationName || '').trim();
  return name ? `*${word} — ${name}*` : `*${word}*`;
}

// Round a quantity the same way every other Orders module does (archive.ts).
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

// "Bacon 2.27kg" — the name with its weight, skipping an empty one.
export function itemLabel(name?: unknown, weight?: unknown): string {
  return [name, weight].filter(Boolean).join(' ');
}

// How two labels are put in order, everywhere a supplier's products are listed — the
// message, the order screen, the read-only list (archive.ts compareByLabel). NUMERIC, so
// «Flour 5kg» comes before «Flour 25kg»: a plain localeCompare reads digits as letters and
// put the 25kg bag first. One collator, so the screen and the message cannot drift apart.
export const compareLabels: (a: string, b: string) => number = new Intl.Collator(undefined, { numeric: true }).compare;

// The rows one supplier's order is built from: everything with a quantity
// typed, and nothing else. ⚠️ THE ONE SELECTION EVERY SCREEN THAT SHOWS "what
// is in this supplier's order right now" MUST CALL — the WhatsApp send screen and the
// tablet read-only summary sheet both call this rather than each
// filtering `entries` its own way, so the two can never quietly select a
// different set of rows from the same draft.
export function orderedItems(ingredients?: readonly unknown[] | null, entries?: unknown): OrderItem[] {
  const byId = entries as Record<string, { qty?: number } & Record<string, unknown>> | null | undefined;
  return (ingredients || [])
    .filter(ing => (byId?.[(ing as { id: string }).id]?.qty || 0) > 0)
    .map(ing => {
      const i = ing as { id: string; name?: unknown; weight?: unknown };
      const item: OrderItem = { name: i.name, weight: i.weight || '', qty: byId![i.id]!.qty };
      const unit = lineUnit(ing, byId![i.id]);
      return unit ? { ...item, unit } : item;
    });
}

// One supplier's items as sorted `{ label, qty }` lines — the EXACT shape and
// order the message's own lines are built from. The tablet summary sheet
// calls this too, so a supplier's summary can never
// show something different from what the message they receive actually says.
export function summaryLines(items?: readonly OrderItem[] | null): { label: string; qty: number; unit?: string }[] {
  return sortItems(items).map(it => {
    const line = { label: itemLabel(it.name, it.weight), qty: num(it.qty) };
    const unit = cleanUnit(it.unit);
    return unit ? { ...line, unit } : line;
  });
}

// The label each line of ONE block carries in the MESSAGE a supplier receives: the name
// alone. Owner's decision, 5 Oct 2026 — the pack weight is not sent. ⚠️ ONE EXCEPTION: when
// two lines of the same block read the same name (trimmed, case-insensitive), those lines
// — and only those — keep their weight, because «- Flour: 2» and «- Flour: 3» could not be
// told apart. Screens (summaryLines, itemLabel) keep the weight everywhere.
// `entries`: [{ name, weight }] → labels, same order.
export function messageLabels(entries: readonly { name?: unknown; weight?: unknown }[]): string[] {
  const key = (e: { name?: unknown }): string => String(e.name || '').trim().toLowerCase();
  const counts = new Map<string, number>();
  entries.forEach(e => counts.set(key(e), (counts.get(key(e)) || 0) + 1));
  return entries.map(e => ((counts.get(key(e)) as number) > 1 ? itemLabel(e.name, e.weight) : String(e.name || '')));
}

// One supplier's block: bold name, then "- label: qty" lines, BY NAME.
//
// The sort lives here, in the one place every message passes through, and not in the
// callers. Two reasons. The draft used to send items in raw Firestore order while the
// order screen shows them sorted, so the message never matched what the operator had
// just checked. And now the same order can be sent twice — once from the draft, later
// re-sent from History — so without a single deterministic order the supplier would
// receive the same order twice with the lines shuffled, and reasonably read it as a
// different order.
// group: { supplierName, items: [{ name, weight, qty }] }
//
// `heading` false leaves the bold supplier line out: a message that carries ONE supplier
// is addressed to that supplier, who needs no reminder of their own name.
function sectionFor({ supplierName, items }: OrderGroup, heading = true, language: unknown = null): string {
  const sorted = sortItems(items);
  const labels = messageLabels(sorted);
  const lines = sorted.map((it, i) => `- ${labels[i]}: ${qtyWithUnit(num(it.qty), cleanUnit(it.unit))}`).join('\n');
  return heading ? `*${supplierName || fallbackSupplierName(language)}*\n${lines}` : lines;
}

// The heading of a supplier with no name — the venue's country language, like the title.
export function fallbackSupplierName(language: unknown = null): string {
  return labelWord('orderTitle', language);
}

// The subject of an order sent by email: the body is in the venue's country language, so
// the subject must be too (it used to follow the screen).
export function emailSubject(locationName?: unknown, language: unknown = null): string {
  return labelWord('emailSubject', language).replace('{name}', String(locationName || '').trim());
}

// By displayed label, so the message reads in the order the eye expects.
export function sortItems<T extends { name?: unknown; weight?: unknown }>(items?: readonly T[] | null): T[] {
  return (items || []).slice().sort((a, b) =>
    compareLabels(itemLabel(a.name, a.weight), itemLabel(b.name, b.weight)));
}

// One group of a message: a supplier and what is ordered from it.
export interface OrderGroup { supplierName?: unknown; items?: readonly OrderItem[] | null }

// One flat shopping list: every item from every group, no supplier headings.
//
// Two lines carrying the SAME label AND unit are added together — 2 buste and 1 cartone
// are never summed (nor converted), so a line with a unit is grouped on both. That is what a shopping list
// wants — the same flour bought from two suppliers is still "buy this much flour" to
// the person walking round the shop. (In the grouped format they stay apart, because
// there each line is addressed to a different supplier.)
//
// Rows adding up to nothing are dropped: this format is read as "what to buy", and
// "- Bacon: 0" is not something to buy.
function flatLines(groups: readonly OrderGroup[]): string[] {
  interface Total { label: string; name: unknown; weight: unknown; unit: string; qty: number }
  const totals = new Map<string, Total>();
  groups.forEach(group => (group.items || []).forEach(item => {
    const label = itemLabel(item.name, item.weight);
    const unit = cleanUnit(item.unit);
    // Keyed on the lower-cased unit so «Busta» and «busta» are one line; the text shown
    // is the first spelling met. A NUL separator cannot occur in a typed label.
    const key = `${label}\u0000${unit.toLowerCase()}`;
    const seen = totals.get(key);
    totals.set(key, { label, name: item.name, weight: item.weight, unit: seen ? seen.unit : unit, qty: (seen?.qty || 0) + num(item.qty) });
  }));

  const sorted = [...totals.values()]
    .filter(line => line.qty > 0)
    .sort((a, b) => a.label.localeCompare(b.label) || a.unit.localeCompare(b.unit));
  const labels = messageLabels(sorted);
  return sorted.map(({ unit, qty }, i) => `- ${labels[i]}: ${qtyWithUnit(qty, unit)}`);
}

// The whole message, in one of two formats.
// groups: [{ supplierName, items: [{ name, weight, qty }] }]
//
//   grouped: true  (the default) — one bold section per supplier, the heading left out
//                  when only one supplier is in the message. This is the format a
//                  SUPPLIER receives, so tests/order-text.test.mjs pins it to the byte.
//   grouped: false — one flat A→Z list with no headings: a shopping list for yourself.
//                  It does NOT say who sells what, so sending it to a supplier shows
//                  them everyone else's order too. Hence the default above.
//
// Returns '' when there is nothing to send, so callers can refuse rather than open
// WhatsApp with an empty order.
//
// ⚠️ ONE SUPPLIER, NO HEADING: with a single supplier the message is title, blank line and
// the lines. With several, each keeps its bold name — otherwise nobody could tell who sells
// what. `language` is the venue's output language (see orderTitle).
export function buildOrderMessage(
  groups?: readonly OrderGroup[] | null,
  { grouped = true, locationName = '', language = null }: { grouped?: boolean; locationName?: unknown; language?: unknown } = {},
): string {
  const withItems = (groups || []).filter(g => (g.items || []).length);
  if (!withItems.length) return '';
  const title = orderTitle(locationName, language);

  if (grouped) {
    const heading = withItems.length > 1;
    return `${title}\n\n` + withItems.map(g => sectionFor(g, heading, language)).join('\n\n');
  }

  const lines = flatLines(withItems);
  if (!lines.length) return '';
  return `${title}\n\n` + lines.join('\n');
}

// Turn a stored `quantities` map into message items, resolving names and weights from
// the CURRENT ingredient list — the same lens history uses on screen, so what the
// supplier reads matches what the operator sees.
//
// An ingredient deleted since the order was placed falls back to the name FROZEN into
// the record (`names`), and only then to a placeholder — never to its document id,
// which would send a supplier a line like "Fdx92kQ1: 4". It never vanishes from its
// own order either: a wrong-looking line is recoverable, a silently missing one is
// not. Rows with a quantity of 0 are dropped — there is no such thing as ordering
// none of something.
//
// Same order of preference as recordedName (archive); name and weight stay
// SEPARATE fields here because the message composes them itself, and a frozen name
// already carries its weight.
//
// `units` is the record's frozen `units` map: only what was frozen is shown, never the
// card's unit, so a message re-sent from History reads exactly as it did the first time.
//
// `language` is the venue's output language: the stand-in for a deleted ingredient is a word
// the supplier reads, so it follows the country like the title.
export function itemsFromQuantities(
  quantities?: unknown,
  ingredientsById?: unknown,
  names?: unknown,
  units?: unknown,
  language: unknown = null,
): OrderItem[] {
  const qs = (quantities || {}) as Record<string, unknown>;
  const live = ingredientsById as Record<string, { name?: unknown; weight?: unknown } | undefined> | null | undefined;
  const frozen = names as Record<string, unknown> | null | undefined;
  const unitOf = units as Record<string, unknown> | null | undefined;
  return Object.keys(qs)
    .map(id => {
      const l = live?.[id];
      const item: OrderItem = {
        name: l?.name || frozen?.[id] || labelWord('deletedIngredient', language),
        weight: (l && l.weight) || '',
        qty: num(qs[id]),
      };
      const unit = cleanUnit(unitOf?.[id]);
      return unit ? { ...item, unit } : item;
    })
    .filter(it => (it.qty as number) > 0)
    .sort((a, b) => compareLabels(itemLabel(a.name, a.weight), itemLabel(b.name, b.weight)));
}

// Index a list of ingredients by id, for itemsFromQuantities.
export function indexById<T extends { id?: unknown }>(items?: readonly T[] | null): Record<string, T> {
  return (items || []).reduce<Record<string, T>>((acc, it) => { acc[it.id as string] = it; return acc; }, {});
}

// The wa.me URL for a message. One place, so the "no recipient — the operator picks
// the chat" decision is stated once instead of being re-derived at every call site.
// (The whole app sends this way: whatsapp, the Calculator, and here.)
export function whatsappUrl(text?: unknown): string {
  return 'https://wa.me/?text=' + encodeURIComponent(text as string);
}
