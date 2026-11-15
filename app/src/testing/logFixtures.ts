// Logs for the Dough history's specs: the shape the current app stores (`locations/{lid}/logs/{id}`).

// The clock the specs freeze (Date.now): a Monday at ten in the morning, well inside a work day.
export const NOW = new Date(2026, 9, 12, 10, 0).getTime();

export const AT = { date: 'Monday 12 October', time: '9:30 AM' };

export function sheetOf(dough = 'Focaccia', over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    dough, recipeId: 'focaccia', param: null, total_g: 2000, extra_g: 0,
    ingredients: [{ name: 'Flour', grams: 1200 }, { name: 'Water', grams: 800 }],
    divisor: null, crates: [], ...over,
  };
}

export function versionOf(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'create', calculatedBy: '', at: AT,
    items: [{ id: 'tray', name: 'Focaccia tray', clientName: 'Cafe Roma', qty: 4, weightG: 500, kind: 'number', crate: { show: false, perBox: 20 } }],
    occasional: [], sheet: sheetOf(), text: 'Cafe Roma:\n  Focaccia tray: 4 pz', recipe: null, ...over,
  };
}

export function logOf(id: string, over: Record<string, unknown> = {}): { id: string } & Record<string, unknown> {
  return {
    id, bakery: 'bakery', dough: 'Focaccia', recipeId: 'focaccia', forDay: 'today', origin: 'calculator',
    createdAtMs: NOW - 60_000, versions: [versionOf()], ...over,
  };
}
