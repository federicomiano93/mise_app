// crossing-route.js — what Food cost does when the width crosses the tablet line (a rotation,
// a resized window). PURE, so the decision can be executed by a test: the wiring in
// foodcost-main.js only carries it out.
//
// ⚠️ The editor holds a working copy and the history holds the editor set aside, so neither
// is ever rebuilt: they are MOVED between the pane and the full screen.
//
//   'none'          the layout already matches, or the screen is not one of these (the wait)
//   'relist'        the list: drawn again in the new layout (it is read-only)
//   'move-editor'   the live editor node moves; nothing is rebuilt
//   'move-history'  the history node moves (no second fetch) and the held editor, if any,
//                   stays alive for the Back that follows
export function crossingRoute({ view, isTablet, splitOn, hasHeldEditor }) {
  if (isTablet === splitOn) return { action: 'none' };
  if (view === 'list') return { action: 'relist' };
  if (view === 'editor') return { action: 'move-editor', toTablet: isTablet };
  if (view === 'history') return { action: 'move-history', toTablet: isTablet, keepHeldEditor: !!hasHeldEditor };
  return { action: 'none' };
}
