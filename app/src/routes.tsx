import type { RouteObject } from 'react-router';
import { RootError } from './errors/RootError';
import { SettingsPage } from './settings/SettingsPage';
import { AppShell } from './shell/AppShell';
import { MorePage } from './shell/MorePage';
import { NotFound } from './shell/NotFound';
import { SectionRoute, StartRedirect } from './shell/SectionRoute';
import { hasScreen } from './shell/sectionScreens';
import { MORE, SECTIONS } from './shell/sections';

// The route table, separate from the router that serves it: the app builds a hash router from
// it (router.ts), the specs build a memory router from the SAME table, so what is tested is
// what ships.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    // A failure in the shell itself. A failure inside one section never gets this far: the
    // shell's PartBoundary catches it first and the navigation stays on screen.
    errorElement: <RootError />,
    children: [
      // The address with no section in it lands on the first section this person is shown.
      { index: true, element: <StartRedirect /> },
      ...SECTIONS.map(section => ({
        // A built section owns every address under its own path (`/pastries/Tuesday/edit`) and
        // reads the rest itself; `/pastries/*` also matches `/pastries`. One route, so moving
        // between its screens never remounts it (and never throws away what it holds).
        path: hasScreen(section.id) ? `${section.path}/*` : section.path,
        // Settings is every signed-in person's own (their account, the way out), so it has no
        // gate; every other section is on only for those the venue shows it to.
        element: section.id === 'settings' ? <SettingsPage /> : <SectionRoute sectionId={section.id} />,
      })),
      { path: MORE.path, element: <MorePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
