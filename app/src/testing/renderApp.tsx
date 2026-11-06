import { createMemoryRouter } from 'react-router';
import type { RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { I18nProvider } from '../i18n/I18nProvider';
import type { Language } from '../i18n/i18n';
import { routes as appRoutes } from '../routes';

type Options = {
  lang?: Language;
  // A different route table, for a spec that needs a section that throws.
  routes?: RouteObject[];
};

// Draws the real app at a path, in a language, inside a memory router (no address bar, no
// reload) and gives back the router, to read where the app is, and a user, to click with.
//
// ⚠️ jsdom applies no media query, so BOTH navigations are in the page: always scope a query
// with within(screen.getByRole('navigation', { name: … })).
export function renderApp(path: string, { lang = 'en', routes = appRoutes }: Options = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const user = userEvent.setup();
  const messages = lang === 'it' ? italian : en;

  render(
    <I18nProvider initialLanguage={lang} initialMessages={messages}>
      <RouterProvider router={router} />
    </I18nProvider>,
  );

  return { router, user };
}
