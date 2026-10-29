// sendFlow.ts — sending an order by one road (parity X15–X25, step 3f-3): which suppliers and lines go, the message of each,
// the links, and taking the road. The React half (the dialogs, the send screen) is useSendOrder.tsx and SendScreen.tsx; the
// pure rules are @mise/shared/send-chooser (offers, links, the photo batch) and @mise/shared/order-text (the message).
//
// ⚠️⚠️ A WINDOW IS OPENED ONLY INSIDE THE TAP. A browser lets a page open a window (WhatsApp, the mail app) only while it is
// answering a person's tap; a window opened after an await of something that is NOT that tap — a read, a timer — is
// blocked as a pop-up, on iPhone Safari above all. So `takeRoad` is an async function whose part BEFORE its first await does
// the unit check and opens the first text window (ONE window per tap: see runTextBatch), and the screen calls it straight from the press of the road's own button
// (or of «Send» when only one road is open). Its later awaits only follow dialogs, whose own taps then carry on.
//
// ⚠️ A WINDOW THAT DID NOT OPEN IS NOT A SEND. `openWindow` answers whether the browser really opened it, and only the
// suppliers whose window opened are reported sent — for email too (finding F-3: the current app counts an email as sent
// without looking).

import { buildOrderMessage, emailSubject, orderedItems, whatsappUrl } from '@mise/shared/order-text';
import type { OrderItem } from '@mise/shared/order-text';
import { confirmedRows } from '@mise/shared/sent-check';
import { digitsOf, mailto, runPhotoBatch } from '@mise/shared/send-chooser';
import type { PhotoOutcome, SendJob, SendOffer, Translate } from '@mise/shared/send-chooser';
import { routeSendsToSupplier } from '@mise/shared/send-routes';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { DraftView } from './draftSync';
import type { OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import type { PlaceItem } from './ordersStore';

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

// The windows a road opens, one job each. The grouped chat is ONE job for every row; a road to the supplier is one job per
// supplier it can reach, matched by ID (two suppliers can share a name, and the wrong order going to the wrong supplier is
// the one mistake this must not be able to make), always grouped: a supplier gets its own order under its own name.
export function jobsFor(offer: SendOffer<StoredDoc>, rows: readonly SendRow[], settings: MessageSettings): SendJob[] {
  const { grouped, locationName, language } = settings;
  if (offer.route === 'whatsapp') {
    const text = buildOrderMessage(rows.map(row => ({ supplierName: row.name, items: row.items })), { grouped, locationName, language });
    // Never an empty chat.
    return text ? [{ ids: rows.map(row => row.id), text, url: whatsappUrl(text) }] : [];
  }
  if (offer.route !== 'whatsappSupplier' && offer.route !== 'email') return [];
  const jobs: SendJob[] = [];
  offer.reachable.forEach(supplier => {
    const row = rows.find(candidate => candidate.id === supplier.id);
    if (!row) return;
    const text = buildOrderMessage([{ supplierName: row.name, items: row.items }], { grouped: true, locationName, language });
    if (!text) return;
    const url = offer.route === 'email'
      ? mailto(supplier.email, emailSubject(locationName, language), text)
      : `https://wa.me/${digitsOf(supplier.phone)}?text=${encodeURIComponent(text)}`;
    jobs.push({ ids: [supplier.id], name: supplierLabel(supplier), text, url });
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

// How one further window went: the person's Open press opened it (or the browser blocked it), or they skipped it or backed out.
export type TextOutcome = 'opened' | 'blocked' | 'skipped' | 'cancelled';

// What `askOpen` is asked about: ONE further supplier's window. `open` opens THIS job's window and answers whether the browser
// really opened one; the dialog's Open button calls it inside its own press, then answers 'opened' or 'blocked'.
export interface OpenQuestion {
  readonly job: SendJob;
  readonly kind: 'chat' | 'email';
  readonly i: number;
  readonly n: number;
  readonly open: () => boolean;
}

export interface TextBatch {
  readonly jobs: readonly SendJob[];
  readonly open: (url: string) => boolean;
  readonly askOpen: (question: OpenQuestion) => Promise<TextOutcome>;
  readonly notify: (message: string) => Promise<unknown>;
  readonly kind?: 'chat' | 'email';
  readonly t: Translate;
}

// The text windows of a road, ONE WINDOW PER TAP.
//
// ⚠️⚠️ A BROWSER LETS ONE TAP OPEN ONE POP-UP: the first window.open uses the tap up and the rest are blocked. So the FIRST job's
// window opens here, synchronously, before any await, inside the tap that started the road; every further job gets a small
// dialog whose own Open press opens it (the same way PhotoDialog starts share() inside its Share press).
//   Skip   → that one is not sent, carry on
//   Cancel → that one and every one after it is not sent (Escape is Cancel)
//   a window the browser blocked is not sent either, and is not counted.
// Whoever was not sent is named at the end with the same words as the picture batch, never dropped silently (suppliers only: the
// single grouped chat has no name). `blocked` is true only when windows were due and none opened because the browser refused
// them all — a person who skipped or cancelled is not told their browser is at fault.
export async function runTextBatch({ jobs, open, askOpen, notify, kind = 'chat', t }: TextBatch): Promise<{ ids: string[]; blocked: boolean }> {
  const sent: string[] = [];
  const notSent: SendJob[] = [];
  let refused = 0;
  let declined = false;
  const [first, ...rest] = jobs;
  if (first) {
    if (open(first.url)) sent.push(...first.ids);
    else { notSent.push(first); refused += 1; }
  }
  for (let index = 0; index < rest.length; index++) {
    const job = rest[index];
    if (!job) continue;
    const outcome = await askOpen({ job, kind, i: index + 1, n: jobs.length, open: () => open(job.url) });
    if (outcome === 'opened') { sent.push(...job.ids); continue; }
    notSent.push(job);
    if (outcome === 'blocked') { refused += 1; continue; }
    declined = true;
    if (outcome === 'cancelled') { notSent.push(...rest.slice(index + 1)); break; }
  }
  const blocked = jobs.length > 0 && sent.length === 0 && !declined && refused === jobs.length;
  // Every window refused by the browser: the screen says «Nothing was opened» with what to do, so no second notice names them.
  const names = blocked ? [] : notSent.map(job => job.name).filter(Boolean);
  if (names.length) await notify(t('orders.sendFormat.notSent', { names: names.join(', ') }));
  return { ids: sent, blocked };
}

// The questions a road may ask on the way, answered by the screen's dialogs.
export interface SendUi {
  // A notice with an OK (the unit clash, «Not sent: …»).
  alert(message: string): Promise<void>;
  // Whether this browser can share a picture at all; without it nothing is asked and the text goes at once.
  canSharePhotos(): boolean;
  // «Photo or text?» — null is Cancel or Escape: nothing sent.
  askFormat(): Promise<'photo' | 'text' | null>;
  // Draws one picture; rejects when the browser cannot.
  render(text: string): Promise<File>;
  // The dialog for ONE picture, whose own button starts the share (parity X22).
  askPhoto(question: { job: SendJob; file: File | undefined; i: number; n: number }): Promise<PhotoOutcome>;
  // «Couldn't share the photo, sending the text instead.» with OK / Cancel.
  confirmText(): Promise<boolean>;
  // «Open the chat for {name} (2 of 3)»: the dialog for ONE further window, whose own Open button opens it (question.open).
  askOpen(question: OpenQuestion): Promise<TextOutcome>;
}

export interface RoadInput {
  readonly offer: SendOffer<StoredDoc>;
  readonly rows: readonly SendRow[];
  readonly settings: MessageSettings;
  // The refusal for a unit clash with today's record of these rows, or '' (ordersStore.conflictsNow + unitConflictText).
  // Answered at once: it runs before any window opens.
  readonly unitRefusal: (rows: readonly SendRow[]) => string;
  readonly open: (url: string) => boolean;
  readonly t: Translate;
}

export type RoadResult =
  // A unit clash was said; nothing was sent.
  | { readonly kind: 'refused' }
  // The road was backed out of on the way (Cancel on «Photo or text?»), or there was nothing to send.
  | { readonly kind: 'cancelled' }
  // Sent: the suppliers whose window really opened or whose picture was shared. `blocked`: windows were due and NONE opened.
  | { readonly kind: 'sent'; readonly ids: readonly string[]; readonly blocked: boolean };

// Takes one road. ⚠️ EVERYTHING UP TO THE FIRST await RUNS INSIDE THE TAP THAT CALLED IT (see the head of this file).
export async function takeRoad({ offer, rows, settings, unitRefusal, open, t }: RoadInput, ui: SendUi): Promise<RoadResult> {
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
  const jobs = jobsFor(offer, rows, settings);
  if (jobs.length === 0) return { kind: 'cancelled' };
  // ⚠️ The first window opens in this very call (see runTextBatch); a second and later one wait for their own Open press.
  const texts = async (): Promise<RoadResult> => {
    const { ids, blocked } = await runTextBatch({
      jobs, open, askOpen: ui.askOpen, notify: ui.alert, kind: offer.route === 'email' ? 'email' : 'chat', t,
    });
    return { kind: 'sent', ids, blocked };
  };

  // Email, and WhatsApp where the browser cannot share a picture: the first window opens now, inside the tap.
  if (offer.route === 'email' || !ui.canSharePhotos()) return texts();

  // ⚠️ THE TWO WHATSAPP ROADS, where a picture can be shared: «photo or text?» first (photo first).
  const format = await ui.askFormat();
  if (format === null) return { kind: 'cancelled' };
  if (format === 'text') return texts();
  // ⚠️ ALL THE PICTURES ARE DRAWN FIRST, then one dialog per picture whose own tap starts the share: share() needs a fresh
  // tap each time, and the share sheet must never be opened by a timer or by the previous one closing.
  let files: File[];
  try {
    files = await Promise.all(jobs.map(job => ui.render(job.text)));
  } catch (err) {
    console.error('Drawing the order picture failed:', err);
    // OK sends the text; Cancel or Escape sends and counts nothing.
    if (!await ui.confirmText()) return { kind: 'cancelled' };
    return texts();
  }
  const ids = await runPhotoBatch({
    jobs, files, ask: ui.askPhoto, notify: ui.alert, confirmText: ui.confirmText, open, t,
  });
  return { kind: 'sent', ids, blocked: false };
}

// The words the send-chooser port asks for, by the current app's keys, found in Mise 2's dictionary
// (sendFlow.spec.ts fails if the port asks for a key this map does not carry).
export const SEND_KEYS: Readonly<Record<string, MessageKey>> = {
  'orders.send.onePerSupplier': 'ord.send.onePerSupplier',
  'orders.send.noContact': 'ord.send.noContact',
  'orders.sendFormat.notSent': 'ord.sendFormat.notSent',
};

export function sendTranslate(t: (key: MessageKey, params?: MessageParams) => string): Translate {
  return (key, vars) => {
    const mapped = SEND_KEYS[key];
    if (mapped === undefined) throw new Error(`No Mise 2 word for ${key}`);
    return t(mapped, vars as MessageParams | undefined);
  };
}
