// sendFlow.ts — sending an order by one road (parity X15–X25, step 3f-3; the send editor of v1.145.0 on top): which suppliers and
// lines go, the message of each, the links, and taking the road. The React half (the editor, the send screen) is
// useSendOrder.tsx, SendEditorDialog.tsx and SendScreen.tsx; the pure rules are @mise/shared/send-chooser (offers, links),
// @mise/shared/send-editor (the batch of editors) and @mise/shared/order-text (the message).
//
// ⚠️⚠️ EVERY ROAD THAT HANDS AN ORDER OVER SHOWS IT FIRST (the order of 14 Nov 2026 that reached a supplier with a product
// missing): one editor per message, the text exactly as buildOrderMessage wrote it, correctable, and ONE «Send». An edit
// changes only the words — History keeps the quantities that were confirmed.
//
// ⚠️⚠️ A WINDOW (OR THE SHARE SHEET) IS OPENED ONLY INSIDE THE TAP. A browser lets a page open a window or the share sheet only
// while it is answering a person's tap; one started after an await of something that is NOT that tap — a read, a timer — is
// blocked, on iPhone Safari above all. Since the editor each message has its OWN tap: the editor's «Send» press opens that
// message's window (`job.open(edited)`, built from the EDITED text) or starts the share, with nothing awaited before it, so one
// tap still opens one window (his D1 of step 3f-3). `takeRoad` itself only does the unit check and asks the editors; its awaits
// follow dialogs, whose own taps then carry on.
//
// ⚠️ A WINDOW THAT DID NOT OPEN IS NOT A SEND. `openWindow` answers whether the browser really opened it, and only the
// suppliers whose window opened (or whose picture was shared) are reported sent — for email too (his decision C of step 3f-3:
// the current app counts an email as sent without looking).

import { buildOrderMessage, emailSubject, fallbackSupplierName, indexById, itemsFromQuantities, orderedItems, whatsappUrl } from '@mise/shared/order-text';
import type { OrderItem } from '@mise/shared/order-text';
import { confirmedRows } from '@mise/shared/sent-check';
import { digitsOf, mailto } from '@mise/shared/send-chooser';
import type { SendOffer, Translate } from '@mise/shared/send-chooser';
import { runSendBatch } from '@mise/shared/send-editor';
import type { EditorAnswer, EditorJob } from '@mise/shared/send-editor';
import { routeSendsToSupplier } from '@mise/shared/send-routes';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { DraftView } from './draftSync';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import type { ListSendOutcome, PlaceItem } from './ordersStore';

// One supplier's part of a send: its id, the name a person reads, and the lines with a quantity.
export interface SendRow {
  readonly id: string;
  readonly name: string;
  readonly items: OrderItem[];
}

// What the message says around the lines: the venue's name, and the language of the venue's COUNTRY (outputLanguage) —
// the supplier reads it, so it never follows the screen.
export interface MessageSettings {
  readonly grouped: boolean;
  readonly locationName: string;
  readonly language: unknown;
}

// ⚠️ ORDERED AS THE LIST SHOWS THEM, and only the suppliers with something to send. The lines are the lens's (linesOf): a line
// sent to another supplier this time goes with THAT supplier, a switched-off line with a quantity goes like any other
// (decision T10). orderedItems is the current app's one selection of «what is in this order now», with its unit rule.
export function draftSendRows(lens: OrdersLens, draft: DraftView, ids?: readonly string[]): SendRow[] {
  const wanted = ids === undefined ? null : new Set(ids);
  return lens.suppliers
    .filter(supplier => wanted === null || wanted.has(supplier.id))
    .map(supplier => ({
      id: supplier.id,
      name: supplierLabel(supplier),
      items: orderedItems(lens.linesOf(supplier.id), draft.entries),
    }))
    .filter(row => row.items.length > 0);
}

// «Send it now» (parity X4): the rows for exactly the numbers the confirm screen confirmed, built with the send screen's own
// selection, so the message is byte for byte the one the send screen would write for the same numbers.
export function confirmedSendRows(lens: OrdersLens, items: readonly PlaceItem[], names: Readonly<Record<string, string>>): SendRow[] {
  const suppliers = items.map(item => ({ id: item.supplierId, name: names[item.supplierId] ?? item.supplierId }));
  const quantities = Object.fromEntries(items.map(item => [item.supplierId, item.quantities]));
  const units = Object.fromEntries(items.map(item => [item.supplierId, item.units]));
  const bySupplier = Object.fromEntries(items.map(item => [item.supplierId, [...lens.linesOf(item.supplierId)]]));
  return confirmedRows(suppliers, bySupplier, { quantities, units }).map(row => ({ ...row, name: String(row.name) }));
}

// Sending a RECORDED order again, from History (parity H11, step 3f-4): one row per record, in the order given, with the lines
// as they were recorded — the names live where the ingredient still exists, frozen otherwise, and only the units frozen into
// the record (itemsFromQuantities). Mise 2 only: a line with no frozen unit reads with the card's CURRENT package word («2 bottiglie»), even for
// an order placed before the type existed (docs/parity/orders.md). The row's id is the record's SUPPLIER, so the
// roads to a supplier find its phone and email by id; the legacy weekly record has none and goes only by the chat. A record
// with nothing left in it is left out. `language` is the venue's output language (the supplier reads the stand-in word).
export function recordSendRows(records: readonly StoredDoc[], ingredients: readonly StoredDoc[], language: unknown): SendRow[] {
  const byId = indexById(ingredients);
  return records
    .map(record => ({
      id: typeof record.supplierId === 'string' && record.supplierId ? record.supplierId : record.id,
      name: typeof record.supplierName === 'string' && record.supplierName ? record.supplierName : fallbackSupplierName(language),
      items: itemsFromQuantities(record.quantities, byId, record.names, record.units, language),
    }))
    .filter(row => row.items.length > 0);
}

// The windows a road opens, one job each. The grouped chat is ONE job for every row; a road to the supplier is one job per
// supplier it can reach, matched by ID (two suppliers can share a name, and the wrong order going to the wrong supplier is
// the one mistake this must not be able to make), always grouped: a supplier gets its own order under its own name.
//
// ⚠️ `open(edited)` BUILDS THE LINK FROM THE TEXT THE PERSON LEFT IN THE EDITOR, not from the message as written: an edit that did
// not reach the link would be the editor lying about what the supplier gets.
export function jobsFor(offer: SendOffer<StoredDoc>, rows: readonly SendRow[], settings: MessageSettings,
  open: (url: string) => boolean = openWindow): EditorJob[] {
  const { grouped, locationName, language } = settings;
  if (offer.route === 'whatsapp') {
    const text = buildOrderMessage(rows.map(row => ({ supplierName: row.name, items: row.items })), { grouped, locationName, language });
    // Never an empty chat.
    return text ? [{ ids: rows.map(row => row.id), text, open: edited => open(whatsappUrl(edited)) }] : [];
  }
  if (offer.route !== 'whatsappSupplier' && offer.route !== 'email') return [];
  const jobs: EditorJob[] = [];
  offer.reachable.forEach(supplier => {
    const row = rows.find(candidate => candidate.id === supplier.id);
    if (!row) return;
    const text = buildOrderMessage([{ supplierName: row.name, items: row.items }], { grouped: true, locationName, language });
    if (!text) return;
    const name = supplierLabel(supplier);
    if (offer.route === 'email') {
      // A mail app shows the asterisks as they are, so the editor's preview does too (`plain`).
      jobs.push({ ids: [supplier.id], name, text, plain: true,
        open: edited => open(mailto(supplier.email, emailSubject(locationName, language), edited)) });
    } else {
      jobs.push({ ids: [supplier.id], name, text,
        open: edited => open(`https://wa.me/${digitsOf(supplier.phone)}?text=${encodeURIComponent(edited)}`) });
    }
  });
  return jobs;
}

// Opens a link in a new window and answers whether the browser really opened one (a blocked pop-up gives null).
// ⚠️ NOT 'noopener' in the call: with it window.open always answers null, and a send could never be told from a blocked one.
// The new window's link back to this page is cut by hand instead, so the page that opens can never navigate this one, which an
// owner is signed into.
export function openWindow(url: string): boolean {
  const opened = window.open(url, '_blank');
  if (!opened) return false;
  try { opened.opener = null; } catch { /* a window that already left this origin has no link back to cut */ }
  return true;
}

// The questions a road may ask on the way, answered by the screen's dialogs.
export interface SendUi {
  // A notice with an OK (the unit clash, «Not sent: …»).
  alert(message: string): Promise<void>;
  // Whether this browser can share a picture at all; without it the editor sends the text.
  canSharePhotos(): boolean;
  // «Couldn't share the photo, sending the text instead.» with OK / Cancel.
  confirmText(): Promise<boolean>;
  // The editor for ONE message (SendEditorDialog): its own «Send» press opens the window or starts the share. `photo`: draw and
  // share a picture instead of opening the text.
  askEditor(question: { job: EditorJob; i: number; n: number; photo: boolean }): Promise<EditorAnswer>;
  // The in-app list for whoever runs the place: asks «nobody will be told» if that is so, then writes the list. null: backed out
  // of at that question, nothing written. It opens no window, so it needs no tap of its own.
  sendList(rows: readonly SendRow[]): Promise<ListSendOutcome | null>;
}

export interface RoadInput {
  readonly offer: SendOffer<StoredDoc>;
  readonly rows: readonly SendRow[];
  readonly settings: MessageSettings;
  // The refusal for a unit clash with today's record of these rows, or '' (ordersStore.conflictsNow + unitConflictText).
  // Answered at once: it runs before any editor opens.
  readonly unitRefusal: (rows: readonly SendRow[]) => string;
  readonly open: (url: string) => boolean;
  readonly t: Translate;
}

export type RoadResult =
  // A unit clash was said; nothing was sent.
  | { readonly kind: 'refused' }
  // The road was backed out of on the way, or there was nothing to send.
  | { readonly kind: 'cancelled' }
  // Sent: the suppliers whose window really opened or whose picture was shared. `blocked`: windows were due and NONE opened.
  // `handOff`: how the LAST message left — 'share' (the share sheet answered, so the person is already back here) or 'text' (a
  // window opened, the page may be about to leave).
  | { readonly kind: 'sent'; readonly ids: readonly string[]; readonly blocked: boolean; readonly handOff: 'share' | 'text' }
  // The in-app list for the managers: how writing it went. ⚠️ Nothing is «reached» and nothing is recorded after it, and the order
  // is NOT cleared (the list is a photograph of it; Federico's choice, 14 Aug 2026).
  | { readonly kind: 'list'; readonly outcome: ListSendOutcome };

// Takes one road. What comes before its first await (the unit check, the first editor) runs inside the tap that called it.
export async function takeRoad({ offer, rows, settings, unitRefusal, open, t }: RoadInput, ui: SendUi): Promise<RoadResult> {
  // ⚠️ THE IN-APP LIST OPENS NO WINDOW AND PUTS NOTHING IN A SUPPLIER'S HANDS: no unit check (it is never merged into the history),
  // no jobs, no «did you send it?».
  if (offer.route === 'manager') {
    const outcome = await ui.sendList(rows);
    return outcome === null ? { kind: 'cancelled' } : { kind: 'list', outcome };
  }
  // ⚠️ ASKED HERE, WHERE THE ROAD IS KNOWN, AND ONLY FOR ROADS THAT REACH THE SUPPLIER (an in-app list needs no check).
  if (routeSendsToSupplier(offer.route)) {
    let refusal = '';
    try {
      refusal = unitRefusal(rows);
    } catch (err) {
      // ⚠️ A CHECK THAT THROWS MUST NEVER KILL THE SEND: logged, and the write still refuses a real clash.
      console.error('Unit check failed, carrying on:', err);
    }
    if (refusal !== '') {
      await ui.alert(refusal);
      return { kind: 'refused' };
    }
  }
  const jobs = jobsFor(offer, rows, settings, open);
  if (jobs.length === 0) return { kind: 'cancelled' };
  // The picture road is the two WhatsApp roads where the browser can share a PNG; email, and WhatsApp without it, send the text.
  const photo = offer.route !== 'email' && ui.canSharePhotos();
  // How the LAST message left decides what the screen does next (a share leaves the person here, a window may not).
  let handOff: 'share' | 'text' = 'text';
  const tracked: EditorJob[] = jobs.map(job => ({ ...job, open: edited => {
    const opened = job.open(edited);
    if (opened) handOff = 'text';
    return opened;
  } }));
  const { ids, blocked } = await runSendBatch({
    jobs: tracked,
    ask: async ({ job, i, n }) => {
      const answer = await ui.askEditor({ job, i, n, photo });
      if (answer.outcome === 'shared') handOff = 'share';
      return answer;
    },
    notify: ui.alert,
    confirmText: ui.confirmText,
    t,
  });
  return { kind: 'sent', ids, blocked, handOff };
}

// The words the send-chooser port asks for, by the current app's keys, found in Mise 2's dictionary
// (sendFlow.spec.ts fails if the port asks for a key this map does not carry).
export const SEND_KEYS: Readonly<Record<string, MessageKey>> = {
  'orders.send.onePerSupplier': 'ord.send.onePerSupplier',
  'orders.send.noContact': 'ord.send.noContact',
  'orders.sendFormat.notSent': 'ord.sendFormat.notSent',
  'orders.sendEditor.titleOne': 'ord.sendEditor.titleOne',
  'orders.sendEditor.titleOf': 'ord.sendEditor.titleOf',
  'orders.sendEditor.titleGrouped': 'ord.sendEditor.titleGrouped',
};

export function sendTranslate(t: (key: MessageKey, params?: MessageParams) => string): Translate {
  return (key, vars) => {
    const mapped = SEND_KEYS[key];
    if (mapped === undefined) throw new Error(`No Mise 2 word for ${key}`);
    return t(mapped, vars as MessageParams | undefined);
  };
}
