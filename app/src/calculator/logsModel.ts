import { getLogRetentionForDough, getRecipes, isLogVisible } from '@mise/shared/calculator-config';
import { filterVisibleLogs, sortLogs } from '@mise/shared/log-model';
import type { Log, LogVersion } from '@mise/shared/log-model';

// What the Dough history's list shows, newest first: the logs of the recipes the venue shows in it, still inside
// the window each recipe keeps them for (Settings → Dough history). Display only — the database keeps every log.
//
// Visibility and retention are keyed by recipe id (filterVisibleLogs matches each log by its recipeId, falling
// back to the dough name for older logs), built recipe by recipe exactly as js/log.js `renderLog` does.
export function visibleLogs(config: unknown, logs: readonly Log[], nowMs: number): Log[] {
  const visibility: Record<string, boolean> = {};
  const retentionHours: Record<string, number> = {};
  for (const recipe of getRecipes(config)) {
    visibility[recipe.id] = isLogVisible(config, recipe.id);
    retentionHours[recipe.id] = getLogRetentionForDough(config, recipe.id);
  }
  return sortLogs(filterVisibleLogs(logs, { visibility, retentionHours, nowMs }));
}

// The versions of a log, defensively: a document that carries something else yields none.
export function versionsOf(log: Log): LogVersion[] {
  return Array.isArray(log.versions) ? log.versions : [];
}

export type VersionKind =
  | { readonly kind: 'created' }
  | { readonly kind: 'edited' }
  | { readonly kind: 'restored'; readonly from: number };

// What version `index` (0-based) of a log is: the first one is created, a restore says which version it was copied
// from (1-based, as a person counts), every other is an edit.
export function versionKind(version: LogVersion, index: number): VersionKind {
  if (version.kind === 'restore') return { kind: 'restored', from: (Number(version.restoredFrom) || 0) + 1 };
  return index === 0 ? { kind: 'created' } : { kind: 'edited' };
}
