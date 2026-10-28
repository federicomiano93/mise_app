// send-chooser.ts — «how should this order go?»: what each road offers, the two links, and how a batch of order pictures is
// delivered. TypeScript PARTIAL port of js/orders/send-chooser.js for Mise 2 (step 3f-3, sending). Pure: no DOM, no window.
// send-chooser.spec.ts runs every test against BOTH files and compares the names and shapes of what is ported (a partial
// port is not paired in parity.spec.ts).
//
// LEFT OUT: `chooseAndSend`, the screen and the four links it opens (window.open, the dialogs). In Mise 2 that is the app's
// send flow (app/src/orders/useSendOrder.tsx) on the shared Dialog — which also mends the original's road chooser, a
// dialog with no role, no Escape and no focus trap (finding F-4).
//
// ⚠️ THE WORDS ARE HANDED IN, not looked up: `offerFor`, `sendOffers` and `runPhotoBatch` take the translate function as a
// `t` field of their one argument, with the original's keys (`orders.send.*`, `orders.sendFormat.notSent`). The original
// reads its own dictionary and ignores the field, so the shapes stay the same and the spec runs both with the original's
// `t`.

import { routeAvailableFor, routesFor, routeSendsToSupplier, unreachable } from './send-routes';
import type { Route } from './send-routes';
import { supplierLabel } from './supplier-label';

export type Translate = (key: string, vars?: Record<string, unknown>) => string;

// The two that address one supplier each.
const PER_SUPPLIER: ReadonlySet<string> = new Set(['whatsappSupplier', 'email']);

export interface SendOffer<S> {
  readonly route: Route;
  readonly perSupplier: boolean;
  readonly reachable: S[];
  readonly cannot: S[];
  readonly note: string;
  readonly usable: boolean;
}

export interface OfferInput<S> {
  settings?: unknown;
  canManage?: unknown;
  suppliers: readonly S[];
  t: Translate;
}

// Which roads this person could take with these suppliers, each with the sentence the screen shows under it.
export function offerFor<S>({ settings, canManage, suppliers, t }: OfferInput<S>): SendOffer<S>[] {
  return routesFor(settings, { canManage }).map(route => {
    const perSupplier = PER_SUPPLIER.has(route);
    const cannot = unreachable(route, suppliers);
    const reachable = suppliers.filter(s => routeAvailableFor(route, s));

    let note = '';
    // ⚠️ THE COST OF A DIRECT ROAD IS SAID BEFORE IT IS TAKEN. One message per supplier means one chat at a time: with
    // three suppliers that is three trips out of the app and back. Discovering that halfway through is how somebody sends
    // the first and forgets the other two.
    if (perSupplier && reachable.length > 1) {
      note = t('orders.send.onePerSupplier', { n: reachable.length });
    }
    // ⚠️ AND WHO CANNOT BE REACHED IS NAMED, never silently dropped. A supplier missing from a send nobody mentioned is an
    // order that simply never happened.
    if (cannot.length) {
      const missing = t('orders.send.noContact', { n: cannot.length,
        names: cannot.map(s => supplierLabel(s)).join(', ') });
      note = note ? `${note} · ${missing}` : missing;
    }
    return { route, perSupplier, reachable, cannot, note, usable: reachable.length > 0 };
  });
}

// The roads that can be taken now. `supplierRoadsOnly` is «Send it now» (sent-check): it means putting the order in a
// SUPPLIER's hands, so the in-app list for a manager is not offered.
export function sendOffers<S>({ settings, canManage, suppliers, supplierRoadsOnly = false, t }:
  OfferInput<S> & { supplierRoadsOnly?: boolean }): SendOffer<S>[] {
  return offerFor({ settings, canManage, suppliers, t })
    .filter(o => o.usable && (!supplierRoadsOnly || routeSendsToSupplier(o.route)));
}

export interface SendJob {
  readonly ids: readonly string[];
  readonly name?: string;
  readonly text: string;
  readonly url: string;
}

// Text road: open each url. Record only if the window actually opened (a blocked pop-up returns null — counting it would
// mark an order as sent that nobody saw). Mise 2 sends the email road through here too (finding F-3).
export function sendTexts(jobs: readonly SendJob[], open: (url: string) => unknown): string[] {
  const sent: string[] = [];
  jobs.forEach(j => { if (open(j.url)) sent.push(...j.ids); });
  return sent;
}

// Settle a dialog's promise once. A second answer (a share() that resolves after Skip or Cancel, or after the dialog moved
// on) is ignored, so nothing is ever counted twice and a picture the person skipped stays NOT sent.
export function settleOnce<T>(resolve: (value: T) => void, cleanup: () => void = () => {}): (value: T) => boolean {
  let settled = false;
  return value => {
    if (settled) return false;
    settled = true;
    cleanup();
    resolve(value);
    return true;
  };
}

export type ShareResult = 'shared' | 'cancelled' | 'failed';

// What a share() result means for the dialog that started it: a resolved share is done; the person closing the sheet leaves
// the dialog open (nothing sent, they can retry, skip or cancel); anything else is a failure.
export function afterShare(result: unknown): 'shared' | 'again' | 'failed' {
  return result === 'shared' ? 'shared' : result === 'cancelled' ? 'again' : 'failed';
}

export type PhotoOutcome = 'shared' | 'skipped' | 'cancelled' | 'failed';

export interface PhotoBatch<F> {
  jobs: readonly SendJob[];
  files: readonly F[];
  ask: (question: { job: SendJob; file: F | undefined; i: number; n: number }) => Promise<PhotoOutcome | string>;
  notify: (message: string) => Promise<unknown>;
  confirmText: () => Promise<boolean>;
  open: (url: string) => unknown;
  t: Translate;
}

// One picture at a time. `ask` resolves 'shared' | 'skipped' | 'cancelled' | 'failed'; it is the dialog whose own tap calls
// share().
//   shared    → sent
//   skipped   → not sent, carry on
//   cancelled → not sent, and so is everything after it
//   failed    → ask OK/Cancel; on OK THIS supplier's text is opened and counted as sent only if the window really opened;
//               Cancel or Escape = not sent, carry on
// Returns the ids that were sent. Who was not sent is named afterwards (suppliers only: the single grouped chat has no name).
export async function runPhotoBatch<F>({ jobs, files, ask, notify, confirmText: confirmFallback, open, t }: PhotoBatch<F>): Promise<string[]> {
  const sent: string[] = [];
  const notSent: SendJob[] = [];
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    if (!job) continue;
    const outcome = await ask({ job, file: files[i], i, n: jobs.length });
    if (outcome === 'shared') { sent.push(...job.ids); continue; }
    if (outcome === 'failed') {
      if (await confirmFallback() && open(job.url)) sent.push(...job.ids);
      else notSent.push(job);
      continue;
    }
    notSent.push(job);
    if (outcome === 'cancelled') { notSent.push(...jobs.slice(i + 1)); break; }
  }
  const names = notSent.map(j => j.name).filter(Boolean);
  if (names.length) await notify(t('orders.sendFormat.notSent', { names: names.join(', ') }));
  return sent;
}

// ⚠️ DIGITS ONLY. wa.me refuses a number carrying spaces, brackets or a leading "+", and refuses it by opening a page that
// says the number is invalid — which reads as the app being broken rather than the number needing tidying.
export function digitsOf(phone: unknown): string {
  return String(phone || '').replace(/\D/g, '');
}

// ⚠️ mailto OPENS THE MAIL APP; IT DOES NOT SEND. That is the honest limit of doing this without a server, and the screen
// says so rather than letting somebody believe an order has gone.
export function mailto(address: unknown, subject: unknown, body: unknown): string {
  return `mailto:${encodeURIComponent(String(address || '').trim())}`
    + `?subject=${encodeURIComponent(String(subject))}&body=${encodeURIComponent(String(body))}`;
}
