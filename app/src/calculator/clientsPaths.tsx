import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import {
  CALCULATOR_PATH, ORDERS_HISTORY_PATH, ORDERS_PATH, SETTINGS_PATH, clientPath, clientsPath, inClientsEditor, orderingPath,
} from './calculatorPath';

// WHERE THE CLIENT SCREENS LIVE. The Clients editor, Orders received and Client ordering are drawn in two places: under
// the Calculator's Settings (`/calculator/settings/clients`, `/calculator/orders`), and, for the owner of the sales side
// who has no Calculator, in the Clients section (`/clients/…`). The screens are the same components; this says which
// addresses they link to, step back to and treat as «still inside the editor».
//
// The default IS the Calculator's addresses, so nothing that draws these screens inside the Calculator needs to know
// the context exists.
export type ClientsPaths = {
  // The screen above the editor and the deadline: Back from the address book or the deadline lands here (the
  // Calculator's Settings hub; the Clients section's own screen).
  readonly hub: string;
  // The address book.
  readonly list: string;
  readonly client: (id: string) => string;
  // Whether an address belongs to the editor (the list or one client): moving between them keeps its working copy,
  // so it is never leaving.
  readonly inEditor: (pathname: string) => boolean;
  readonly orders: string;
  readonly ordersHistory: string;
  // Where Back from Orders received goes when nothing is behind it (the work view; the Clients section's screen).
  readonly ordersBack: string;
  readonly ordering: string;
};

export const CALCULATOR_CLIENT_PATHS: ClientsPaths = Object.freeze({
  hub: SETTINGS_PATH,
  list: clientsPath,
  client: clientPath,
  inEditor: inClientsEditor,
  orders: ORDERS_PATH,
  ordersHistory: ORDERS_HISTORY_PATH,
  ordersBack: CALCULATOR_PATH,
  ordering: orderingPath,
});

const ClientsPathsContext = createContext<ClientsPaths>(CALCULATOR_CLIENT_PATHS);

export function ClientsPathsProvider({ value, children }: { value: ClientsPaths; children: ReactNode }) {
  return <ClientsPathsContext.Provider value={value}>{children}</ClientsPathsContext.Provider>;
}

export function useClientsPaths(): ClientsPaths {
  return useContext(ClientsPathsContext);
}
