import {
  getAllProducts, getClientById, getProductById, getWhatsappClients, getWhatsappLists,
} from '@mise/shared/calculator-config';
import type {
  CalculatorConfig, Client, FreeLine, OrderPrefillWindow, WhatsappClient, WhatsappList, WhatsappListClient,
} from '@mise/shared/calculator-config';
import type { MessageKey } from '../i18n/en';

// What the WhatsApp lists editor does with the configuration, as plain functions (ports of the working copy in
// js/calculator-whatsapp-settings.js): the screen edits ONE item — a list with its client entries, or a direct client —
// and Save writes THAT ITEM over the LATEST configuration, replacing the one with its id or adding it. No other list,
// client or key of the configuration is touched, so another phone's change to anything else survives.
//
// ⚠️ SAVING NEVER REPLACES A WHOLE MAP WITH THE ONE THE SCREEN OPENED WITH (the current app wrote back its whole
// copy). The same goes for a delete: it removes ONE id from the latest configuration.

// The part an entry of a list and a direct client have in common: the product ids it sends and its free lines.
export type Lines = {
  readonly products: string[];
  readonly extras: FreeLine[];
};

// The item on screen: a list, or a direct client.
export type WorkingItem =
  | { readonly group: 'list'; readonly item: WhatsappList }
  | { readonly group: 'direct'; readonly item: WhatsappClient };

export const isBlank = (text: unknown): boolean => typeof text !== 'string' || text.trim() === '';

// The window options of the top screen: the words are the current app's dictionary keys (`ORDER_PREFILL_LABELS`).
export const PREFILL_LABEL_KEYS: Readonly<Record<OrderPrefillWindow, MessageKey>> = {
  both: 'help.yesterdayAndToday',
  yesterday: 'help.yesterdayOnly',
  today: 'help.todayOnly',
};

// ── Making and finding ─────────────────────────────────────────────────────────

// A short random id after a prefix: `wl-` for a list, `wc-` for a direct client (the current app's `genId`).
export function newId(prefix: 'wl' | 'wc', random: () => number = Math.random): string {
  return prefix + '-' + random().toString(36).slice(2, 8);
}

export function newList(random?: () => number): WhatsappList {
  return { id: newId('wl', random), title: '', clients: [] };
}

export function newDirect(random?: () => number): WhatsappClient {
  return { id: newId('wc', random), name: '', products: [], extras: [] };
}

export function findList(config: unknown, id: string): WhatsappList | undefined {
  return getWhatsappLists(config).find(list => list.id === id);
}

export function findDirect(config: unknown, id: string): WhatsappClient | undefined {
  return getWhatsappClients(config).find(direct => direct.id === id);
}

// An independent copy to edit: a list read from the configuration is never changed in place.
export function copyItem<T extends WhatsappList | WhatsappClient>(item: T): T {
  return JSON.parse(JSON.stringify(item)) as T;
}

// Whether the working copy differs from what the screen opened with.
export function sameItem(a: WorkingItem, b: WorkingItem): boolean {
  return a.group === b.group && JSON.stringify(a.item) === JSON.stringify(b.item);
}

export function nameOf(working: WorkingItem): string {
  return working.group === 'list' ? working.item.title : working.item.name;
}

export function withName(working: WorkingItem, name: string): WorkingItem {
  return working.group === 'list'
    ? { group: 'list', item: { ...working.item, title: name } }
    : { group: 'direct', item: { ...working.item, name } };
}

// ── Writing over the LATEST configuration ──────────────────────────────────────

// The item with the same id replaces the old one, in its place; an item the latest configuration lacks (it is new, or
// was deleted on another phone meanwhile — the person has just saved it deliberately) is added at the end.
export function putItem<T extends { readonly id: string }>(items: readonly T[], item: T): T[] {
  const at = items.findIndex(known => known.id === item.id);
  if (at === -1) return [...items, item];
  return items.map((known, index) => (index === at ? item : known));
}

export function removeItem<T extends { readonly id: string }>(items: readonly T[], id: string): T[] {
  return items.filter(known => known.id !== id);
}

// Save: only the edited item is written over the latest configuration.
export function withItem(latest: CalculatorConfig, working: WorkingItem): CalculatorConfig {
  return working.group === 'list'
    ? { ...latest, whatsappLists: putItem(getWhatsappLists(latest), working.item) }
    : { ...latest, whatsappClients: putItem(getWhatsappClients(latest), working.item) };
}

// Delete from the top: one id out of the latest configuration.
export function withoutItem(latest: CalculatorConfig, group: 'list' | 'direct', id: string): CalculatorConfig {
  return group === 'list'
    ? { ...latest, whatsappLists: removeItem(getWhatsappLists(latest), id) }
    : { ...latest, whatsappClients: removeItem(getWhatsappClients(latest), id) };
}

export function withPrefillWindow(latest: CalculatorConfig, window: OrderPrefillWindow): CalculatorConfig {
  return { ...latest, orderPrefillWindow: window };
}

// ── A list's client entries ────────────────────────────────────────────────────

export function entryOf(list: WhatsappList, clientId: string): WhatsappListClient | undefined {
  return list.clients.find(entry => entry.clientId === clientId);
}

// A client is in a list once: adding it again changes nothing.
export function addEntry(list: WhatsappList, clientId: string): WhatsappList {
  if (entryOf(list, clientId)) return list;
  return { ...list, clients: [...list.clients, { clientId, products: [], extras: [] }] };
}

export function removeEntry(list: WhatsappList, clientId: string): WhatsappList {
  return { ...list, clients: list.clients.filter(entry => entry.clientId !== clientId) };
}

// The address-book clients a list may still take: every one not already in it (the chooser's rows).
export function clientsToAdd(list: WhatsappList, clients: readonly Client[]): Client[] {
  const already = new Set(list.clients.map(entry => entry.clientId));
  return clients.filter(client => !already.has(client.id));
}

// ── The products and free lines of an entry or a direct client ────────────────

// Applies a change to the lines of ONE entry of a list (found by its client), or of the direct client when `clientId`
// is null. Anything else about the item is kept.
export function editLines(
  working: WorkingItem, clientId: string | null, change: (lines: Lines) => Lines,
): WorkingItem {
  if (working.group === 'direct') return { group: 'direct', item: { ...working.item, ...change(working.item) } };
  if (clientId === null) return working;
  return {
    group: 'list',
    item: {
      ...working.item,
      clients: working.item.clients.map(entry => (entry.clientId === clientId ? { ...entry, ...change(entry) } : entry)),
    },
  };
}

export function linesOf(working: WorkingItem, clientId: string | null): Lines | undefined {
  if (working.group === 'direct') return working.item;
  return clientId === null ? undefined : entryOf(working.item, clientId);
}

export function withProduct(lines: Lines, productId: string): Lines {
  if (lines.products.includes(productId)) return lines;
  return { ...lines, products: [...lines.products, productId] };
}

export function withoutProduct(lines: Lines, productId: string): Lines {
  return { ...lines, products: lines.products.filter(id => id !== productId) };
}

// A new free line has NO id yet: it settles when the configuration is saved (normalizeConfig gives it `wx-<slug>`,
// unique inside the entry, and drops a blank one). ⚠️ The id is never recomputed as a name is typed — it keys the
// quantity box of the order form, and changing it would move somebody's typed number to a different row.
export function withFreeLine(lines: Lines, name: string): Lines {
  return { ...lines, extras: [...lines.extras, { id: '', name }] };
}

export function withRenamedLine(lines: Lines, index: number, name: string): Lines {
  return { ...lines, extras: lines.extras.map((line, at) => (at === index ? { ...line, name } : line)) };
}

export function withoutFreeLine(lines: Lines, index: number): Lines {
  return { ...lines, extras: lines.extras.filter((_line, at) => at !== index) };
}

// The names of the products a target sends (a product since deleted from the address book is skipped).
export function productNames(config: unknown, lines: Lines): string[] {
  const names: string[] = [];
  for (const id of lines.products) {
    const product = getProductById(config, id);
    if (product) names.push(product.name);
  }
  return names;
}

// Everything that will appear in the message for this target: its products AND its free lines. The summary on a card
// counts both, or an entry that carries only free lines would read «nothing to send» while the message it sends is full.
export function lineNames(config: unknown, lines: Lines): string[] {
  const typed = lines.extras.map(line => String(line.name ?? '').trim()).filter(name => name !== '');
  return [...productNames(config, lines), ...typed];
}

export type AddedLine =
  | { readonly kind: 'blank' }
  | { readonly kind: 'duplicate'; readonly name: string }
  | { readonly kind: 'added'; readonly lines: Lines };

// Typing a name that is in neither list. A name the message already carries is refused, rather than sending the client
// the same thing on two lines.
export function tryAddFreeLine(config: unknown, lines: Lines, typed: string): AddedLine {
  const name = typed.trim();
  if (name === '') return { kind: 'blank' };
  if (lineNames(config, lines).includes(name)) return { kind: 'duplicate', name };
  return { kind: 'added', lines: withFreeLine(lines, name) };
}

// ── Level 3: what can be added ─────────────────────────────────────────────────

export type PickerRow = { readonly id: string; readonly name: string };

// The address book as the picker sees it: unique by NAME, because the message only ever carries a name.
//
// ⚠️ WHEN TWO CLIENTS SELL THE SAME NAME, THIS CLIENT'S OWN COPY WINS. Picking the first one found would file a client's
// own product under «other products» — exactly backwards — whenever somebody else happened to be earlier in the book.
export function pickerProducts(config: unknown, client: Client | null): { rows: PickerRow[]; ownIds: Set<string> } {
  const ownIds = new Set((client?.products ?? []).map(product => product.id));
  const byName = new Map<string, PickerRow>();
  for (const product of getAllProducts(config)) {
    const seen = byName.get(product.name);
    if (!seen || (!ownIds.has(seen.id) && ownIds.has(product.id))) byName.set(product.name, { id: product.id, name: product.name });
  }
  return { rows: [...byName.values()], ownIds };
}

// The client a target belongs to, or null for a direct client — a typed name with no address-book entry, so it has no
// products «of its own».
export function targetClient(config: unknown, clientId: string | null): Client | null {
  return clientId === null ? null : getClientById(config, clientId);
}

export type PickerGroups = {
  // This client's own products not yet in the message.
  readonly own: PickerRow[];
  // Everybody else's (or all of them, when the client has none of its own left).
  readonly others: PickerRow[];
  // How many different products the address book has at all (0 → «no products in the address book yet»).
  readonly total: number;
  // The names the message already carries: products and free lines.
  readonly added: ReadonlySet<string>;
};

export function pickerGroups(config: unknown, client: Client | null, lines: Lines): PickerGroups {
  const added = new Set(lineNames(config, lines));
  const { rows, ownIds } = pickerProducts(config, client);
  const available = rows.filter(row => !added.has(row.name));
  return {
    own: available.filter(row => ownIds.has(row.id)),
    others: available.filter(row => !ownIds.has(row.id)),
    total: rows.length,
    added,
  };
}
