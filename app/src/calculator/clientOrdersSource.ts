// clientOrdersSource.ts — everything the BAKERY does with client ordering, in Firestore, and nothing else.
//
// A port of js/client-orders-data.js, write for write, because firestore.rules (the `client-accounts`,
// `client-settings`, `client-menus` and `client-orders` blocks) accept exactly these shapes and nothing else:
// publish what each client may order, mint and revoke the ordering links, watch the orders that arrive, read
// the past ones on demand, and record that one has been put into the Calculator. Behind an interface, so the
// store (clientOrdersStore.ts) is a spec with a fake source and never needs a database to be tested.
//
// The client's own page (order.html, js/client-orders/) is a separate app; it shares only the pure model
// (@mise/shared/client-order-model), never this file.
//
// Under the open venue:
//   • client-settings/orders — the ordering deadline, `{ bakery, cutoff, updatedAt }`; watched live.
//   • client-menus/{clientId} — what one client may order; republished when the address book changes.
//   • client-accounts/{uid} — the grant behind one ordering link (canManage only, in the rules).
//   • client-orders/{date}_{clientId} — an order a client typed; still-to-come ones watched, past ones read once.
//
// ⚠️ NO ROLE IS READ HERE, ON PURPOSE: the screens hide what a person cannot do, firestore.rules decides (P2).
//
// ⚠️ FIRESTORE COMES FROM THE SESSION'S BACKEND (`firestore()`), never from getFirestore(): its settings are
// fixed by its first use (src/firestore-access.spec.ts). The ordering account comes from the backend too
// (`createLinkAccount`, a second Firebase app), so this file never starts Firebase itself.

import { MAX_HISTORY_READ } from '@mise/shared/client-order-history';
import { isValidOrderClientId, linkEmailFor, menuChanged, menuFor } from '@mise/shared/client-order-model';
import { buildPath } from '@mise/shared/location-id';
import type { Query } from 'firebase/firestore';
import type { FirestoreKit } from '../session/firebaseBackend';
import type { AnswerMeta, StoredDoc } from './calculatorSource';
import { checkId } from './calculatorSource';

// A client as the address book holds it (config/calculator `clients[]`): only what a menu is made of.
export interface MenuClient {
  readonly id: string;
  readonly name?: unknown;
  readonly products?: unknown;
}

// Who the menus say they come from: the venue's own name and country (the client's page cannot read the venue).
export interface MenuVenue {
  readonly name: string;
  readonly country: string | null;
}

// One ordering link's grant, as stored in client-accounts/{uid}.
export interface OrderingAccount {
  readonly uid: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly createdAt: string;
  // The secret inside the link; kept so the link can be sent again (see firestore.rules). Missing on a grant
  // written without it: such a link cannot be shown, only replaced.
  readonly linkToken: string | null;
}

export interface CreatedLink {
  readonly uid: string;
  readonly token: string;
}

export interface ClientOrdersSource {
  // client-settings/orders, live: its `cutoff` text, or null when the document does not exist. A refusal or a
  // listener that never starts calls onError, never onChange.
  watchCutoff(onChange: (cutoff: string | null, meta: AnswerMeta) => void, onError: (err: unknown) => void): () => void;
  // Writes the deadline ('' = no deadline). Resolves when the server has it (offline: never); rejects when refused.
  saveCutoff(cutoff: string): Promise<void>;
  // The orders for `fromDate` (YYYY-MM-DD) and later, live. Ordering is the caller's.
  watchUpcoming(
    fromDate: string,
    onChange: (list: StoredDoc[], meta: AnswerMeta) => void,
    onError: (err: unknown) => void,
  ): () => void;
  // The orders dated in [since, before), newest first, at most `cap`, read ONCE.
  readPast(range: { readonly before: string; readonly since: string; readonly cap?: number }): Promise<StoredDoc[]>;
  // Has this venue EVER received an order? One document read.
  hasAnyOrder(): Promise<boolean>;
  // Records that this exact version of the order went into the Calculator. Resolves when the server has it
  // (offline: never); rejects when refused — an order deleted meanwhile included.
  markApplied(order: { readonly id: string; readonly updatedAt?: unknown }): Promise<void>;
  // Republishes every client's menu, writing ONLY the ones that moved; resolves with how many were written.
  publishMenus(clients: readonly MenuClient[], venue: MenuVenue): Promise<number>;
  // Every ordering link's grant of the venue, read once. Rejects when it cannot be read.
  listAccounts(): Promise<OrderingAccount[]>;
  // Mints a link for one client: a fresh account, its grant, then (when replacing) the old grant revoked, then
  // the client's menu published. Rejects at the first step that fails (see the function for what is left).
  createLink(client: MenuClient, venue: MenuVenue, replacingUid: string | null): Promise<CreatedLink>;
  // Deletes one grant: the link stops working. Resolves when the server has done it.
  revokeLink(uid: string): Promise<void>;
}

export interface ClientOrdersDeps {
  // Creates an account on a SECOND Firebase app and resolves with its uid (session/firebaseBackend.ts).
  createLinkAccount(email: string, password: string): Promise<string>;
  // The ISO time written into `updatedAt` / `createdAt` / `appliedAt`.
  nowIso(): string;
  // 32 random bytes from the browser's own generator.
  randomBytes(): Uint8Array;
}

const MENUS = 'client-menus';
const ACCOUNTS = 'client-accounts';
const ORDERS = 'client-orders';
const SETTINGS = 'client-settings';
const SETTINGS_DOC = 'orders';

// The link's secret: 32 random bytes, base64url without padding (js/client-orders-data.js `mintToken`). Never
// Math.random(), which is predictable enough that a few links would reveal the rest.
export function tokenFrom(bytes: Uint8Array): string {
  if (bytes.length < 32) throw new Error('An ordering link needs 32 random bytes.');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function browserRandomBytes(): Uint8Array {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes;
}

// A grant as stored, or null for a document that is not one (no client id): such a grant names nobody.
export function accountOf(uid: string, data: Record<string, unknown>): OrderingAccount | null {
  const clientId = typeof data.clientId === 'string' ? data.clientId : '';
  if (!clientId) return null;
  return {
    uid,
    clientId,
    clientName: typeof data.clientName === 'string' ? data.clientName : '',
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    linkToken: typeof data.linkToken === 'string' && data.linkToken ? data.linkToken : null,
  };
}

export function createFirestoreClientOrdersSource(
  firestore: () => Promise<FirestoreKit>,
  locationId: string,
  deps: ClientOrdersDeps,
): ClientOrdersSource {
  // Throws on a venue id that could point a write anywhere else (@mise/shared/location-id).
  const menusPath = buildPath(locationId, MENUS);
  const accountsPath = buildPath(locationId, ACCOUNTS);
  const ordersPath = buildPath(locationId, ORDERS);
  const settingsPath = buildPath(locationId, SETTINGS);

  // ⚠️ THE VENUE IS STAMPED HERE, never trusted from the caller: the rules want `bakery` to name the folder.
  const stamped = <T extends Record<string, unknown>>(data: T) => ({ ...data, bakery: locationId });

  // A live listener whose Firestore may not be loaded yet (calculatorSource.ts `listen`).
  function listen(subscribe: (kit: FirestoreKit) => () => void, onError: (err: unknown) => void): () => void {
    let stopped = false;
    let unsubscribe: (() => void) | null = null;
    firestore().then(kit => {
      if (stopped) return;
      unsubscribe = subscribe(kit);
    }).catch(err => {
      if (!stopped) onError(err);
    });
    return () => {
      stopped = true;
      unsubscribe?.();
      unsubscribe = null;
    };
  }

  function wantedMenu(client: MenuClient, venue: MenuVenue) {
    return menuFor(client, venue.name, venue.country);
  }

  async function writeMenu(client: MenuClient, venue: MenuVenue): Promise<void> {
    const { fs, db } = await firestore();
    await fs.setDoc(
      fs.doc(db, menusPath, checkId(client.id)),
      stamped({ ...wantedMenu(client, venue), updatedAt: deps.nowIso() }),
    );
  }

  async function revokeLink(uid: string): Promise<void> {
    const safeUid = checkId(uid);
    const { fs, db } = await firestore();
    await fs.deleteDoc(fs.doc(db, accountsPath, safeUid));
  }

  return {
    watchCutoff: (onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.doc(kit.db, settingsPath, SETTINGS_DOC),
      { includeMetadataChanges: true },
      snap => onChange(
        snap.exists() ? String((snap.data() as Record<string, unknown>).cutoff ?? '') : null,
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.error('Ordering deadline listener failed:', err);
        onError(err);
      },
    ), err => {
      console.error('Ordering deadline listener never started:', err);
      onError(err);
    }),

    // ⚠️ ONE DOCUMENT, WRITTEN WHOLE, three keys (the rules' closed list). It lives outside config/calculator
    // because the client page must read it, and that document is the whole address book.
    async saveCutoff(cutoff) {
      const { fs, db } = await firestore();
      await fs.setDoc(
        fs.doc(db, settingsPath, SETTINGS_DOC),
        stamped({ cutoff: String(cutoff ?? ''), updatedAt: deps.nowIso() }),
      );
    },

    // ⚠️ A RANGE ON ONE FIELD, NOT THE WHOLE COLLECTION (P14): orders accumulate for ever and the bakery only
    // needs the ones still to come. A single-field range needs no composite index.
    watchUpcoming: (fromDate, onChange, onError) => listen(kit => kit.fs.onSnapshot(
      kit.fs.query(
        kit.fs.collection(kit.db, ordersPath) as Query,
        kit.fs.where('date', '>=', String(fromDate)),
      ),
      { includeMetadataChanges: true },
      snap => onChange(
        snap.docs.map(d => ({ ...d.data(), id: d.id })),
        { fromServer: !snap.metadata.fromCache },
      ),
      err => {
        console.error('Client orders listener failed:', err);
        onError(err);
      },
    ), err => {
      console.error('Client orders listener never started:', err);
      onError(err);
    }),

    // ⚠️ ORDERED BY THE `date` FIELD, NEVER BY THE DOCUMENT ID: Firestore refuses descending key scans (the
    // v1.9.0 release of Orders). Two inequalities on `date` plus orderBy('date') need no composite index.
    // ⚠️ READ ONCE, NOT WATCHED: a past order does not change (P14). The window HIDES, it never deletes.
    async readPast({ before, since, cap = MAX_HISTORY_READ }) {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(
        fs.collection(db, ordersPath) as Query,
        fs.where('date', '<', String(before)),
        fs.where('date', '>=', String(since)),
        fs.orderBy('date', 'desc'),
        fs.limit(Math.max(1, Number(cap) || MAX_HISTORY_READ)),
      ));
      return snap.docs.map(d => ({ ...d.data(), id: d.id }));
    },

    async hasAnyOrder() {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.query(fs.collection(db, ordersPath) as Query, fs.limit(1)));
      return !snap.empty;
    },

    // ⚠️ `appliedFor` STORES WHICH VERSION was used, not merely that one was: it is what lets the screen say
    // «this changed after you used it» instead of comparing two clocks. A patch, not a whole write, so a
    // correction landing in the same second cannot be overwritten by it; updateDoc is refused on a document that
    // no longer exists, so a deleted order is never recreated.
    async markApplied(order) {
      const safeId = checkId(order.id);
      const { fs, db } = await firestore();
      await fs.updateDoc(fs.doc(db, ordersPath, safeId), {
        bakery: locationId,
        appliedAt: deps.nowIso(),
        appliedFor: String(order.updatedAt || ''),
      });
    },

    // ⚠️ IT MUST RUN WHEN THE ADDRESS BOOK CHANGES: a client cannot order a product whose menu was never
    // published, and nothing about that failure is visible from the bakery's side. Writing only what moved is
    // what keeps that safe (P14). A client with no link still gets its menu, so a link made later works at once.
    // A client whose id cannot name an order (an underscore, a slash) is skipped, as in the current app.
    async publishMenus(clients, venue) {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.collection(db, menusPath));
      const published = new Map(snap.docs.map(d => [d.id, d.data() as Record<string, unknown>]));
      let written = 0;
      for (const client of clients) {
        if (!client || !isValidOrderClientId(client.id)) continue;
        if (!menuChanged(published.get(client.id), wantedMenu(client, venue))) continue;
        await writeMenu(client, venue);
        written += 1;
      }
      return written;
    },

    async listAccounts() {
      const { fs, db } = await firestore();
      const snap = await fs.getDocs(fs.collection(db, accountsPath));
      return snap.docs
        .map(d => accountOf(d.id, d.data() as Record<string, unknown>))
        .filter((account): account is OrderingAccount => account !== null);
    },

    // ⚠️ THE ORDER OF THE STEPS IS THE SAFETY (js/client-orders-data.js `createOrderingLink`):
    //   1. the account (on a second Firebase app — the person's own session is never touched);
    //   2. its grant, which is what makes the link work;
    //   3. only then the old grant revoked, so there is no moment in which the client has neither link;
    //   4. the client's menu, so the page has something to show.
    // A failure after step 1 leaves an account that can do nothing (no grant names it): harmless.
    async createLink(client, venue, replacingUid) {
      if (!client || !isValidOrderClientId(client.id)) {
        throw Object.assign(new Error('This client cannot have an ordering link.'), { code: 'invalid-client' });
      }
      const token = tokenFrom(deps.randomBytes());
      // ⚠️ ONE SECRET FOR BOTH HALVES OF THE ACCOUNT: the email and the password travel together in the same
      // link, so two secrets would protect nothing. The address is built by the shared model, so this side and
      // the client page can never disagree about it.
      const uid = await deps.createLinkAccount(linkEmailFor(token), token);
      const { fs, db } = await firestore();
      await fs.setDoc(fs.doc(db, accountsPath, checkId(uid)), stamped({
        clientId: client.id,
        clientName: String(client.name || ''),
        createdAt: deps.nowIso(),
        linkToken: token,
      }));
      if (replacingUid && replacingUid !== uid) await revokeLink(replacingUid);
      await writeMenu(client, venue);
      return { uid, token };
    },

    revokeLink,
  };
}

// The address that IS the link: the client's page with the venue and the secret in the FRAGMENT, after the #,
// because a fragment is never sent to a server and never lands in a web-server log (js/client-orders-data.js
// `orderingLinkFor`).
// ⚠️ THE CLIENT'S PAGE IS order.html AT THE SITE'S ROOT, not beside Mise 2: until the switch Mise 2 is served from
// `<site>/mise2/`, after it from the site's root, and order.html stays where it is in both (its own port is
// step 3h). So the folder `mise2/`, when the app is served from it, is stepped out of.
export function orderingLinkFor(token: string, locationId: string, pageHref: string): string {
  const folder = new URL('.', pageHref);
  const root = folder.pathname.endsWith('/mise2/') ? new URL('..', folder) : folder;
  const page = new URL('order.html', root);
  return `${page.origin}${page.pathname}#b=${encodeURIComponent(locationId)}&k=${encodeURIComponent(token)}`;
}
