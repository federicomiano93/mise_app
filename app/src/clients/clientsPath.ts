import { parseCalculatorPath } from '../calculator/calculatorPath';
import type { OrdersView, SettingsTarget } from '../calculator/calculatorPath';
import type { ClientsPaths } from '../calculator/clientsPaths';

// The addresses of the Clients section, the sales owner's page (a port of clients.html). It draws the Calculator's own
// client screens, so the shapes under it are the Calculator's, behind a different prefix.
//
//   /clients                       the page: Clients, Orders received, Client ordering
//   /clients/list                  the address book
//   /clients/list/<id>             one client (an id the working copy lacks goes back to the list)
//   /clients/list/new              the list (a client is made by «Add client», which opens it by its id)
//   /clients/orders                Orders received: the orders still coming
//   /clients/orders/history        Orders received: the past ones
//   /clients/ordering              Client ordering: the deadline
//   anything else                  unknown: back to /clients
//
// There is NO WhatsApp address: its lists are a field the rules refuse this role.
export const CLIENTS_PATH = '/clients';
export const CLIENTS_LIST_PATH = `${CLIENTS_PATH}/list`;
export const CLIENTS_ORDERS_PATH = `${CLIENTS_PATH}/orders`;
export const CLIENTS_ORDERS_HISTORY_PATH = `${CLIENTS_ORDERS_PATH}/history`;
export const CLIENTS_ORDERING_PATH = `${CLIENTS_PATH}/ordering`;

export const clientsPaths: ClientsPaths = Object.freeze({
  hub: CLIENTS_PATH,
  list: CLIENTS_LIST_PATH,
  client: (id: string) => `${CLIENTS_LIST_PATH}/${encodeURIComponent(id)}`,
  inEditor: (pathname: string) => pathname === CLIENTS_LIST_PATH || pathname.startsWith(`${CLIENTS_LIST_PATH}/`),
  orders: CLIENTS_ORDERS_PATH,
  ordersHistory: CLIENTS_ORDERS_HISTORY_PATH,
  ordersBack: CLIENTS_PATH,
  ordering: CLIENTS_ORDERING_PATH,
});

export type ClientsView =
  | { readonly kind: 'hub' }
  | { readonly kind: 'list'; readonly target: SettingsTarget }
  | { readonly kind: 'orders'; readonly view: Exclude<OrdersView, 'unknown'> }
  | { readonly kind: 'ordering' }
  | { readonly kind: 'unknown' };

// `rest` is what follows /clients in the address AS IT IS WRITTEN (ids are decoded after the split, as in the
// Calculator's own addresses). The shapes under `list` and `orders` are the Calculator's, so its parser reads them.
export function parseClientsPath(rest: string | undefined): ClientsView {
  const parts = (rest ?? '').split('/').filter(part => part !== '');
  const [first, ...tail] = parts;
  if (first === undefined) return { kind: 'hub' };
  if (first === 'ordering') return tail.length === 0 ? { kind: 'ordering' } : { kind: 'unknown' };
  if (first === 'list') {
    const view = parseCalculatorPath(['settings', 'clients', ...tail].join('/'));
    if (view.kind === 'settings' && view.view.kind === 'clients') return { kind: 'list', target: view.view.target };
    return { kind: 'unknown' };
  }
  if (first === 'orders') {
    const view = parseCalculatorPath(['orders', ...tail].join('/'));
    if (view.kind === 'orders' && view.view !== 'unknown') return { kind: 'orders', view: view.view };
  }
  return { kind: 'unknown' };
}

export type ResolvedClients =
  | { readonly redirect: string }
  | { readonly hub: true }
  | { readonly list: SettingsTarget }
  | { readonly orders: 'coming' | 'history' }
  | { readonly ordering: true };

// A client is made by «Add client», which opens the new client by its id: the bare word `new` goes to the list.
export function resolveClientsPath(rest: string | undefined): ResolvedClients {
  const view = parseClientsPath(rest);
  switch (view.kind) {
    case 'hub': return { hub: true };
    case 'list': return view.target.kind === 'new' ? { redirect: CLIENTS_LIST_PATH } : { list: view.target };
    case 'orders': return { orders: view.view };
    case 'ordering': return { ordering: true };
    case 'unknown': return { redirect: CLIENTS_PATH };
  }
}

// What the usage record calls the screen at an address under /clients: the page, the editor (the list and a client),
// Orders received (coming or history) and the deadline. Anything the section would redirect is the page.
export function clientsScreenName(rest: string): string {
  const resolved = resolveClientsPath(rest);
  if ('list' in resolved) return 'clients-editor';
  if ('orders' in resolved) return 'clients-orders';
  if ('ordering' in resolved) return 'clients-ordering';
  return 'clients';
}
