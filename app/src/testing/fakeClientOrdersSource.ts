import { isValidOrderClientId, menuChanged, menuFor } from '@mise/shared/client-order-model';
import type { AnswerMeta, StoredDoc } from '../calculator/calculatorSource';
import type {
  ClientOrdersSource, CreatedLink, MenuClient, MenuVenue, OrderingAccount,
} from '../calculator/clientOrdersSource';

// A client-orders source for the specs, in memory: the orders, the deadline, the menus and the grants are plain
// values; a write lands at once (or is refused, with `refuse`, or held, with `holdWrites`), and every live watcher
// is told, like Firestore would. By default every answer comes from the server; `push({ fromServer: false })` sends
// one from the browser's own database.
type OrdersListener = { fromDate: string; onChange: (list: StoredDoc[], meta: AnswerMeta) => void; onError: (err: unknown) => void };
type CutoffListener = { onChange: (cutoff: string | null, meta: AnswerMeta) => void; onError: (err: unknown) => void };

const FROM_SERVER: AnswerMeta = { fromServer: true };

export type FakeClientOrdersSource = ClientOrdersSource & {
  orders: Map<string, StoredDoc>;
  // The deadline document's `cutoff`, or null when there is no document.
  cutoff: string | null;
  menus: Map<string, Record<string, unknown>>;
  accounts: Map<string, OrderingAccount>;
  // The next calls of this kind fail.
  refuse: {
    orders: boolean; cutoff: boolean; cutoffSave: boolean; applied: boolean; past: boolean;
    accounts: boolean; create: boolean; revoke: boolean; menus: boolean;
  };
  // Every «applied» write, in order.
  applied: { id: string; appliedFor: string }[];
  // Every deadline written, in order.
  savedCutoffs: string[];
  // Every menu written, in order (client id).
  menuWrites: string[];
  // Every past-orders read, in order.
  pastReads: { before: string; since: string }[];
  // Writes (deadline, applied) wait until settleWrites().
  holdWrites(): void;
  settleWrites(): void;
  // Tells every watcher again (as another phone's write would).
  push(meta?: AnswerMeta): void;
  // Holds back every answer until release() (Firestore still loading).
  hold(): void;
  release(): void;
  watching(): number;
};

export function fakeClientOrdersSource(seed: {
  orders?: StoredDoc[];
  cutoff?: string | null;
  accounts?: OrderingAccount[];
} = {}): FakeClientOrdersSource {
  const orders = new Map((seed.orders ?? []).map(order => [order.id, order] as const));
  const accounts = new Map((seed.accounts ?? []).map(account => [account.uid, account] as const));
  const ordersWatchers = new Set<OrdersListener>();
  const cutoffWatchers = new Set<CutoffListener>();
  const refuse = {
    orders: false, cutoff: false, cutoffSave: false, applied: false, past: false,
    accounts: false, create: false, revoke: false, menus: false,
  };
  let held = false;
  let writesHeld = false;
  const heldWrites: Array<() => void> = [];
  let nextUid = 1;

  const fail = (what: string) => Object.assign(new Error(`${what} refused`), { code: 'permission-denied' });

  function tellOrders(listener: OrdersListener, meta: AnswerMeta): void {
    if (refuse.orders) {
      listener.onError(fail('orders'));
      return;
    }
    listener.onChange([...orders.values()].filter(order => String(order.date) >= listener.fromDate), meta);
  }
  function tellCutoff(listener: CutoffListener, meta: AnswerMeta): void {
    if (refuse.cutoff) {
      listener.onError(fail('cutoff'));
      return;
    }
    listener.onChange(source.cutoff, meta);
  }
  function write(run: () => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const go = () => {
        try {
          run();
          resolve();
        } catch (err) {
          reject(err);
        }
      };
      if (writesHeld) heldWrites.push(go);
      else go();
    });
  }

  const source: FakeClientOrdersSource = {
    orders,
    cutoff: seed.cutoff === undefined ? null : seed.cutoff,
    menus: new Map(),
    accounts,
    refuse,
    applied: [],
    savedCutoffs: [],
    menuWrites: [],
    pastReads: [],

    watchUpcoming(fromDate, onChange, onError) {
      const listener = { fromDate, onChange, onError };
      ordersWatchers.add(listener);
      if (!held) tellOrders(listener, FROM_SERVER);
      return () => ordersWatchers.delete(listener);
    },
    watchCutoff(onChange, onError) {
      const listener = { onChange, onError };
      cutoffWatchers.add(listener);
      if (!held) tellCutoff(listener, FROM_SERVER);
      return () => cutoffWatchers.delete(listener);
    },
    saveCutoff(cutoff) {
      return write(() => {
        if (refuse.cutoffSave) throw fail('cutoff save');
        source.savedCutoffs.push(cutoff);
        source.cutoff = cutoff;
        for (const listener of cutoffWatchers) tellCutoff(listener, FROM_SERVER);
      });
    },
    async readPast({ before, since }) {
      source.pastReads.push({ before, since });
      if (refuse.past) throw fail('past');
      return [...orders.values()]
        .filter(order => String(order.date) < before && String(order.date) >= since)
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    },
    async hasAnyOrder() {
      if (refuse.past) throw fail('any');
      return orders.size > 0;
    },
    markApplied(order) {
      return write(() => {
        if (refuse.applied) throw fail('applied');
        const stored = orders.get(order.id);
        if (!stored) throw Object.assign(new Error('gone'), { code: 'not-found' });
        const appliedFor = String(order.updatedAt || '');
        source.applied.push({ id: order.id, appliedFor });
        orders.set(order.id, { ...stored, appliedAt: '2026-10-13T08:00:00.000Z', appliedFor });
        for (const listener of ordersWatchers) tellOrders(listener, FROM_SERVER);
      });
    },
    async publishMenus(clients: readonly MenuClient[], venue: MenuVenue) {
      if (refuse.menus) throw fail('menus');
      let written = 0;
      for (const client of clients) {
        if (!client || !isValidOrderClientId(client.id)) continue;
        const wanted = menuFor(client, venue.name, venue.country);
        if (!menuChanged(source.menus.get(client.id), wanted)) continue;
        source.menus.set(client.id, { ...wanted });
        source.menuWrites.push(client.id);
        written += 1;
      }
      return written;
    },
    async listAccounts() {
      if (refuse.accounts) throw fail('accounts');
      return [...accounts.values()];
    },
    async createLink(client, venue, replacingUid): Promise<CreatedLink> {
      if (refuse.create) throw fail('create');
      const uid = `uid-${nextUid++}`;
      const token = `token-${uid}`;
      accounts.set(uid, { uid, clientId: client.id, clientName: String(client.name || ''), createdAt: '', linkToken: token });
      if (replacingUid) accounts.delete(replacingUid);
      source.menus.set(client.id, { ...menuFor(client, venue.name, venue.country) });
      source.menuWrites.push(client.id);
      return { uid, token };
    },
    async revokeLink(uid) {
      if (refuse.revoke) throw fail('revoke');
      accounts.delete(uid);
    },

    holdWrites() {
      writesHeld = true;
    },
    settleWrites() {
      writesHeld = false;
      for (const go of heldWrites.splice(0)) go();
    },
    push(meta = FROM_SERVER) {
      for (const listener of ordersWatchers) tellOrders(listener, meta);
      for (const listener of cutoffWatchers) tellCutoff(listener, meta);
    },
    hold() {
      held = true;
    },
    release() {
      held = false;
      source.push();
    },
    watching: () => ordersWatchers.size + cutoffWatchers.size,
  };
  return source;
}
