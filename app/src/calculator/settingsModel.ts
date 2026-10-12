import {
  LOG_RETENTION_DEFAULT, getDivisorIncluded, getLogRetentionForDough, getRecipes, getTabProducts,
  isExtraDoughEnabled, isLogVisible,
} from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';

// What the editing screens of Settings do with the configuration, as plain functions: each reads what it was
// opened with, and builds the configuration to save from the LATEST one with ONLY the parts the person changed
// (ports of the working copies in js/calculator-settings.js and js/log-settings.js).
//
// ⚠️ SAVING NEVER REPLACES A WHOLE MAP WITH THE ONE THE SCREEN OPENED WITH. Another phone may have changed the
// switch of a recipe this screen did not touch; writing the opening copy back would undo it. Only the keys the
// person changed are written over the latest map.

// The recipes' ids, in the order the screens list them.
export function recipeIds(config: CalculatorConfig): string[] {
  return getRecipes(config).map(recipe => recipe.id);
}

// The keys whose value differs between what the screen opened with and what it holds now.
export function changedKeys<T>(opening: Readonly<Record<string, T>>, now: Readonly<Record<string, T>>): string[] {
  return Object.keys(now).filter(key => now[key] !== opening[key]);
}

// ── Extra dough ───────────────────────────────────────────────────────────────

export function extraOpening(config: CalculatorConfig): Record<string, boolean> {
  return Object.fromEntries(recipeIds(config).map(id => [id, isExtraDoughEnabled(config, id)]));
}

export function applyExtra(
  latest: CalculatorConfig,
  opening: Readonly<Record<string, boolean>>,
  now: Readonly<Record<string, boolean>>,
): CalculatorConfig {
  const extraDough = { ...latest.extraDough };
  for (const id of changedKeys(opening, now)) extraDough[id] = now[id] === true;
  return { ...latest, extraDough };
}

// ── Divisor ───────────────────────────────────────────────────────────────────

export type DivisorProduct = { readonly id: string; readonly name: string };

// One row per PRODUCT of the recipe, not per client that orders it: ticking a product splits it across every
// client that orders it. A paused product has no row (getTabProducts leaves it out of everything).
export function divisorProducts(config: CalculatorConfig, recipeId: string): DivisorProduct[] {
  const seen = new Set<string>();
  const out: DivisorProduct[] = [];
  for (const row of getTabProducts(config, recipeId)) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push({ id: row.id, name: row.name });
  }
  return out;
}

export function divisorOpening(config: CalculatorConfig, recipeId: string): string[] {
  return getDivisorIncluded(config, recipeId).map(String);
}

// Ticked or not, the order of the ticks is not a change.
export function sameTicks(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('\n') === [...b].sort().join('\n');
}

export function applyDivisor(latest: CalculatorConfig, recipeId: string, ticked: readonly string[]): CalculatorConfig {
  return { ...latest, divisorIncluded: { ...latest.divisorIncluded, [recipeId]: [...ticked] } };
}

// ── Dough history ─────────────────────────────────────────────────────────────

export type LogSettings = {
  readonly visibility: Readonly<Record<string, boolean>>;
  readonly retention: Readonly<Record<string, number>>;
};

export function logOpening(config: CalculatorConfig): LogSettings {
  const ids = recipeIds(config);
  return {
    visibility: Object.fromEntries(ids.map(id => [id, isLogVisible(config, id)])),
    retention: Object.fromEntries(ids.map(id => [id, getLogRetentionForDough(config, id)])),
  };
}

export function logChanged(opening: LogSettings, now: LogSettings): boolean {
  return changedKeys(opening.visibility, now.visibility).length > 0
    || changedKeys(opening.retention, now.retention).length > 0;
}

export function applyLog(latest: CalculatorConfig, opening: LogSettings, now: LogSettings): CalculatorConfig {
  const logVisibility = { ...latest.logVisibility };
  for (const id of changedKeys(opening.visibility, now.visibility)) logVisibility[id] = now.visibility[id] === true;
  const logRetentionByDough = { ...latest.logRetentionByDough };
  for (const id of changedKeys(opening.retention, now.retention)) logRetentionByDough[id] = now.retention[id] ?? LOG_RETENTION_DEFAULT;
  return { ...latest, logVisibility, logRetentionByDough };
}
