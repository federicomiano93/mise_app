import { createMemoryRouter } from 'react-router';
import type { InitialEntry, RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataProvider } from '../data/DataContext';
import type { DataServices } from '../data/DataContext';
import { onRouteError } from '../errors/routeErrors';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Language } from '../i18n/i18n';
import { routes as appRoutes } from '../routes';
import { SessionProvider } from '../session/SessionContext';
import { fakeImportSource } from '../suppliers/invoiceImport/testing/fakeImportSource';
import { fakeMergeSource } from '../suppliers/merge/testing/fakeMergeSource';
import { fakePriceChangesSource } from '../suppliers/priceChanges/testing/fakePriceChangesSource';
import type { Session } from '../session/session';
import { fakeCalculatorSource } from './fakeCalculatorSource';
import { fakeClientOrdersSource } from './fakeClientOrdersSource';
import { fakeFoodcostSource } from './fakeFoodcostSource';
import { fakeOrdersSource } from './fakeOrdersSource';
import { fakeRecipesSource } from './fakeRecipesSource';
import { fakePastriesSource } from './fakePastriesSource';
import { fakeStocktakeSource } from './fakeStocktakeSource';
import { fakeSuppliersSource } from './fakeSuppliersSource';
import { fakeStore } from './fakeSession';

type Options = {
  lang?: Language;
  // A different route table, for a spec that needs a section that throws.
  routes?: RouteObject[];
  // What the session says, on top of the default: the owner of one venue, signed in and ready.
  session?: Partial<Session>;
  // The sections' data. By default every section gets an empty in-memory source.
  data?: Partial<DataServices>;
  // The history the router starts with, the last entry being the current one (an entry can carry a state):
  // for a spec that goes Back to the screen it came from. `path` is ignored when this is given.
  entries?: InitialEntry[];
};

// Draws the real app at a path, in a language, inside a memory router (no address bar, no
// reload) and gives back the router, to read where the app is, a user, to click with, and the
// fake session store, to read what the screens asked of it and to move it to another status.
//
// ⚠️ jsdom applies no media query, so BOTH navigations are in the page: always scope a query
// with within(screen.getByRole('navigation', { name: … })).
export function renderApp(path: string, { lang = 'en', routes = appRoutes, session, data, entries }: Options = {}) {
  const router = createMemoryRouter(routes, entries
    ? { initialEntries: entries, initialIndex: entries.length - 1 }
    : { initialEntries: [path] });
  const user = userEvent.setup();
  const messages = lang === 'it' ? italian : en;
  const store = fakeStore(session);
  const services: DataServices = { pastries: () => fakePastriesSource(), stocktake: () => fakeStocktakeSource(),
    foodcost: () => fakeFoodcostSource(), calculator: () => fakeCalculatorSource(),
    clientOrders: () => fakeClientOrdersSource(), recipes: () => fakeRecipesSource(),
    photo: () => ({ readRecipe: () => Promise.reject(new Error('no photo reader in this spec')), setRecipePhoto: () => Promise.reject(new Error('no photo switch in this spec')) }),
    suppliers: () => fakeSuppliersSource(), invoiceImport: () => fakeImportSource(),
    priceChanges: () => fakePriceChangesSource(), merge: () => fakeMergeSource(),
    orders: () => fakeOrdersSource(), ...data };

  render(
    <I18nProvider initialLanguage={lang} initialMessages={messages}>
      <SessionProvider store={store}>
        <DataProvider services={services}>
          <RouterProvider router={router} onError={onRouteError} />
        </DataProvider>
      </SessionProvider>
    </I18nProvider>,
  );

  return { router, user, store };
}
