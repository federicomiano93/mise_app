import { createHashRouter } from 'react-router';
import { routes } from './routes';

// ⚠️ HASH ROUTES (#/orders), NOT PATHS (/orders). The app is served by GitHub Pages, which
// cannot rewrite an unknown path back to index.html: a path like /mise_app/orders would be a
// 404 on every reload and every shared link. Everything after the # never reaches the server.
export const router = createHashRouter(routes);
