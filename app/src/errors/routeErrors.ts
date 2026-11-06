import type { ClientOnErrorFunction } from 'react-router';

// What the router does with an error, besides showing the route's errorElement.
//
// ⚠️ WITHOUT AN onError, THE ROUTER LOGS A RENDER ERROR ITSELF. React Router's boundary
// (RenderErrorBoundary) writes «React Router caught the following error during render» to
// console.error, and React writes its own line for the same error — two lines with two different
// messages, which the error report (telemetry/) counts as two errors. Giving the router an
// onError makes it stop logging: React's line is the only one left.
//
// So this handler logs only what nobody else will: an error with no `errorInfo` is not a render
// error (those carry React's errorInfo and are already logged by React) but a loader, an action
// or middleware error — none exist yet, and without this line none would be logged at all.
export const onRouteError: ClientOnErrorFunction = (error, info) => {
  if (!info?.errorInfo) console.error('Route failed:', error);
};
