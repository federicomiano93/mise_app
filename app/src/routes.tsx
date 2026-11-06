import { Navigate } from 'react-router';
import type { RouteObject } from 'react-router';
import { RootError } from './errors/RootError';
import { AppShell } from './shell/AppShell';
import { MorePage } from './shell/MorePage';
import { NotFound } from './shell/NotFound';
import { KEEP_FOCUS } from './shell/Page';
import { SectionPlaceholder } from './shell/SectionPlaceholder';
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
      // The address with no section in it lands on Orders. KEEP_FOCUS: that is the app
      // arranging itself on first load, not a person asking to move.
      { index: true, element: <Navigate to="/orders" replace state={KEEP_FOCUS} /> },
      ...SECTIONS.map(section => ({
        path: section.path,
        element: <SectionPlaceholder sectionId={section.id} />,
      })),
      { path: MORE.path, element: <MorePage /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];
