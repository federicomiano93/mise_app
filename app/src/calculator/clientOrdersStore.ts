// clientOrdersStore.ts — the bakery's side of the clients' own orders, while the Calculator is open: the orders
// still to come and the ordering deadline (both watched), the ordering links (read when a client's screen asks),
// the past orders (read on demand by the screen), and the writes — the deadline, «this order went into the
// Calculator», a link minted or turned off, the menus republished after the address book changed.
//
// Plain TypeScript, no React: a spec drives it with a fake source (testing/fakeClientOrdersSource.ts). A port of
// the state half of js/calculator-client-orders.js and of the link half of js/calculator-settings.js, over
// clientOrdersSource.ts.
//
// ⚠️ NOTHING HERE MOVES A NUMBER IN THE CALCULATOR. Putting an order into the quantity boxes is the screen's
// inspect-then-apply (the person reads it and taps); this store only records afterwards that it was used.
//
// ⚠️ LOCAL-FIRST WHERE THE DATABASE QUEUES, WAITING WHERE IT CANNOT (P20): the deadline and «applied» are single
// writes the browser's own database keeps until the signal comes back, so they are handed over and the screen
// moves on — a refusal that arrives later is SAID (a `ClientOrdersMessage`). Minting and turning off a link need
// the server (an account is created on Auth), so those are promises the screen waits for.

import { CUTOFF_DEFAULT, normalizeCutoff, toISODate } from '@mise/shared/client-order-model';
import type { AnswerMeta, StoredDoc } from './calculatorSource';
import type { ClientOrdersSource, CreatedLink, MenuClient, MenuVenue, OrderingAccount } from './clientOrdersSource';

// An order as the stream holds it: the document's fields beside its id. Shapes are the client page's
// (@mise/shared/client-order-model `buildOrder`); every reader is tolerant of a missing field.
export type ClientOrder = StoredDoc;

export type ClientOrdersMessage =
  // The deadline written from this phone was refused (or could not be written): the old one is back on screen.
  | { readonly kind: 'cutoff-not-saved' }
  // An order WAS put into the Calculator but recording it failed: the screen can no longer warn when the client
  // changes it afterwards — the one thing standing between a late correction and the wrong amount of bread.
  | { readonly kind: 'applied-not-recorded' };

export type AccountsState = 'idle' | 'loading' | 'ready' | 'failed';

export interface ClientOrdersSnapshot {
  // The orders the stream holds (dated today or later when it started), soonest day first, then the client who
  // has waited longest. A tablet left open across midnight still holds yesterday's: `stillComing` drops them.
  readonly orders: readonly ClientOrder[];
  // An answer came (from the server or the browser's own database), or the stream failed.
  readonly ordersLoaded: boolean;
  // The SERVER has answered once: until then «no orders» may only be this phone's old copy.
  readonly ordersFromServer: boolean;
  // The stream died (refused, or never started): the screen says the orders could not be loaded.
  readonly ordersFailed: boolean;
  // The deadline in effect: 'HH:MM', or '' for none. A venue that never set one reads as the default 16:00 here
  // (the CLIENT page reads it the other way, on purpose: here it only decides what a screen says); a broken stream
  // reads as '' — no «late» mark rather than a wrong one. A deadline being written shows at once.
  readonly cutoff: string;
  // The deadline as the SERVER holds it has arrived once: the deadline editor copies it only then.
  readonly cutoffFromServer: boolean;
  // A deadline written here has not been answered yet.
  readonly cutoffSaving: boolean;
  // clientId → its ordering link's grant; meaningful once `accountsState` is 'ready'.
  readonly accounts: Readonly<Record<string, OrderingAccount>>;
  readonly accountsState: AccountsState;
  // A deadline or an «applied» handed over and not yet answered: while true the section holds the busy marker.
  readonly unsent: boolean;
}

export interface ClientOrdersDepsLite {
  now(): number;
  warn(message: string, detail?: unknown): void;
}

export interface ClientOrdersStore {
  getSnapshot(): ClientOrdersSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: ClientOrdersMessage) => void): () => void;
  start(): void;
  stop(): void;
  // Writes the deadline ('HH:MM' or '' for none; anything else is normalised to ''), local-first.
  saveCutoff(cutoff: string): void;
  // Records that this version of the order went into the Calculator, local-first. Call it only AFTER the
  // quantity boxes really moved.
  markApplied(order: ClientOrder): void;
  // The past orders dated in [since, before), newest first — read once, never watched. Rejects when unreadable.
  readPast(range: { readonly before: string; readonly since: string }): Promise<ClientOrder[]>;
  // Has this venue ever received an order? false when it cannot be told.
  hasAnyOrder(): Promise<boolean>;
  // Reads the ordering links' grants (again). Never rejects: a failure is `accountsState: 'failed'`.
  loadAccounts(): Promise<void>;
  // Mints a link for the client (replacing its current one, if any). Rejects when it could not be made; on
  // success the grant is in `accounts` and the token is returned for the link.
  createLink(client: MenuClient, venue: MenuVenue): Promise<CreatedLink>;
  // Turns the client's link off. Rejects when refused or unreachable.
  revokeLink(clientId: string): Promise<void>;
  // Republishes the clients' menus (best-effort: a failure is logged, never thrown — the address book is already
  // saved, and a menu that did not move is corrected by the next save).
  publishMenus(clients: readonly MenuClient[], venue: MenuVenue): Promise<void>;
}

// Soonest delivery first, and within a day the client who has been waiting longest (js/calculator-client-orders.js
// `sortOrders`).
export function sortOrders(list: readonly ClientOrder[]): ClientOrder[] {
  return list.slice().sort((a, b) =>
    String(a.date).localeCompare(String(b.date)) || String(a.updatedAt).localeCompare(String(b.updatedAt)));
}

// What is still to come on the day `todayISO`: the stream is bounded by the day it STARTED, so a screen left open
// across midnight must drop yesterday's itself.
export function stillComing(orders: readonly ClientOrder[], todayISO: string): ClientOrder[] {
  return orders.filter(order => !!order && String(order.date) >= todayISO);
}

export function createClientOrdersStore(source: ClientOrdersSource, deps: ClientOrdersDepsLite): ClientOrdersStore {
  let orders: readonly ClientOrder[] = [];
  let ordersLoaded = false;
  let ordersFromServer = false;
  let ordersFailed = false;
  // What the deadline's stream said: undefined = not yet; null = no document; '' = broken (see `cutoff`).
  let streamCutoff: string | null | undefined;
  let cutoffFromServer = false;
  // The deadlines written here and not answered yet, oldest first: the newest is the one on screen.
  const savingCutoffs: string[] = [];
  let applying = 0;
  let accounts: Readonly<Record<string, OrderingAccount>> = {};
  let accountsState: AccountsState = 'idle';
  let accountsRead = 0;
  let stops: Array<() => void> = [];
  let running = false;
  let snapshot: ClientOrdersSnapshot = build();
  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: ClientOrdersMessage) => void>();

  function effectiveCutoff(): string {
    if (savingCutoffs.length) return savingCutoffs[savingCutoffs.length - 1]!;
    if (streamCutoff === undefined || streamCutoff === null) return CUTOFF_DEFAULT;
    return normalizeCutoff(streamCutoff);
  }

  function build(): ClientOrdersSnapshot {
    return {
      orders,
      ordersLoaded,
      ordersFromServer,
      ordersFailed,
      cutoff: effectiveCutoff(),
      cutoffFromServer,
      cutoffSaving: savingCutoffs.length > 0,
      accounts,
      accountsState,
      unsent: savingCutoffs.length > 0 || applying > 0,
    };
  }

  // ⚠️ A subscriber that throws never stops the data (the current app's `guarded`, item 108).
  function changed(): void {
    snapshot = build();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        deps.warn('[client orders] a subscriber failed:', err);
      }
    }
  }

  function say(message: ClientOrdersMessage): void {
    for (const listener of [...messageListeners]) {
      try {
        listener(message);
      } catch (err) {
        deps.warn('[client orders] a message listener failed:', err);
      }
    }
  }

  function setAccount(account: OrderingAccount): void {
    const next = { ...accounts };
    for (const [clientId, known] of Object.entries(next)) {
      if (known.uid === account.uid) delete next[clientId];
    }
    next[account.clientId] = account;
    accounts = next;
  }

  async function loadAccounts(): Promise<void> {
    const read = ++accountsRead;
    accountsState = 'loading';
    changed();
    try {
      const list = await source.listAccounts();
      if (read !== accountsRead) return;
      const next: Record<string, OrderingAccount> = {};
      for (const account of list) next[account.clientId] = account;
      accounts = next;
      accountsState = 'ready';
    } catch (err) {
      if (read !== accountsRead) return;
      // ⚠️ «COULD NOT READ» IS NOT «NO LINK»: offering «Create» here would mint a second account for a client
      // whose link works, and cut it off. The screen says it could not read them instead.
      deps.warn('[client orders] could not read the ordering links:', err);
      accountsState = 'failed';
    }
    changed();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onMessage(listener) {
      messageListeners.add(listener);
      return () => messageListeners.delete(listener);
    },

    start() {
      if (running) return;
      running = true;
      stops = [
        source.watchUpcoming(
          toISODate(deps.now()),
          (list: StoredDoc[], meta: AnswerMeta) => {
            orders = sortOrders(list.filter(order => !!order && typeof order.id === 'string'));
            ordersLoaded = true;
            ordersFailed = false;
            if (meta.fromServer) ordersFromServer = true;
            changed();
          },
          (err: unknown) => {
            deps.warn('[client orders] stream failed:', err);
            // ⚠️ A DEAD STREAM NEVER LEAVES A BANNER CLAIMING ORDERS ARE WAITING: the list empties, and the
            // screen says it could not be loaded instead of «nothing still coming».
            orders = [];
            ordersLoaded = true;
            ordersFailed = true;
            changed();
          },
        ),
        source.watchCutoff(
          (cutoff, meta) => {
            streamCutoff = cutoff;
            if (meta.fromServer) cutoffFromServer = true;
            changed();
          },
          (err: unknown) => {
            deps.warn('[client orders] deadline stream failed:', err);
            // As the current app: no deadline known means no «late» mark rather than a wrong one.
            streamCutoff = '';
            changed();
          },
        ),
      ];
    },

    stop() {
      running = false;
      for (const stopOne of stops) stopOne();
      stops = [];
    },

    saveCutoff(cutoff) {
      const wanted = normalizeCutoff(cutoff);
      savingCutoffs.push(wanted);
      changed();
      const done = () => {
        const at = savingCutoffs.indexOf(wanted);
        if (at >= 0) savingCutoffs.splice(at, 1);
      };
      source.saveCutoff(wanted).then(() => {
        // The stream has (or will have) the written value; until it says so, keep showing it.
        if (streamCutoff === undefined || streamCutoff === null || normalizeCutoff(streamCutoff) !== wanted) {
          streamCutoff = wanted;
        }
        done();
        changed();
      }, (err: unknown) => {
        deps.warn('[client orders] deadline not saved:', err);
        done();
        changed();
        say({ kind: 'cutoff-not-saved' });
      });
    },

    markApplied(order) {
      applying += 1;
      changed();
      source.markApplied({ id: String(order.id), updatedAt: order.updatedAt }).then(() => {
        applying -= 1;
        changed();
      }, (err: unknown) => {
        deps.warn('[client orders] could not record that the order was used:', err);
        applying -= 1;
        changed();
        say({ kind: 'applied-not-recorded' });
      });
    },

    readPast: range => source.readPast(range),

    hasAnyOrder: () => source.hasAnyOrder().catch(() => false),

    loadAccounts,

    async createLink(client, venue) {
      const replacing = accounts[client.id]?.uid ?? null;
      const created = await source.createLink(client, venue, replacing);
      const readInAir = accountsState === 'loading';
      accountsRead += 1; // a read in the air no longer describes the links
      setAccount({
        uid: created.uid,
        clientId: client.id,
        clientName: String(client.name || ''),
        createdAt: '',
        linkToken: created.token,
      });
      // ⚠️ THE STATE IS NOT TOUCHED: «ready» after a failed read would make every OTHER client look linkless. A read
      // that was in the air (now dropped) is asked again, or the screen would say «Loading…» for ever.
      changed();
      if (readInAir) void loadAccounts();
      return created;
    },

    async revokeLink(clientId) {
      const account = accounts[clientId];
      if (!account) return;
      await source.revokeLink(account.uid);
      const readInAir = accountsState === 'loading';
      accountsRead += 1;
      accounts = Object.fromEntries(Object.entries(accounts).filter(([id]) => id !== clientId));
      changed();
      if (readInAir) void loadAccounts();
    },

    async publishMenus(clients, venue) {
      try {
        await source.publishMenus(clients, venue);
      } catch (err) {
        deps.warn('Client ordering menus not republished:', err);
      }
    },
  };
}
