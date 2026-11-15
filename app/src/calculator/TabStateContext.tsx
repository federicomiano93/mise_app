import { createContext, useContext, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { getTabProducts, getVisibleRecipes } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import type { KeyValueStorage } from '../session/backend';
import { useCalculator } from './CalculatorContext';
import { createTabState } from './calculatorTabState';
import type { TabState } from './calculatorTabState';

const TabStateContext = createContext<TabState | null>(null);

function browserStorage(): KeyValueStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked site data: nothing is remembered between visits
  }
}

// One memory of the tabs for as long as the Calculator is on screen. Specs that need another storage or
// another clock pass `state`.
export function TabStateProvider({ children, state }: { children: ReactNode; state?: TabState }) {
  const [own] = useState(() => state ?? createTabState(browserStorage(), () => Date.now()));
  return (
    <TabStateContext.Provider value={own}>
      <WorkDaySweep />
      {children}
    </TabStateContext.Provider>
  );
}

export function useTabState(): TabState {
  const state = useContext(TabStateContext);
  if (!state) throw new Error('useTabState must be used inside a <TabStateProvider>.');
  return state;
}

// Re-renders the reader whenever a tab's memory changes. Read the keys while drawing, after calling this.
export function useTabVersion(): number {
  const state = useTabState();
  return useSyncExternalStore(state.subscribe, state.getVersion);
}

function tabsOf(config: CalculatorConfig) {
  return getVisibleRecipes(config).map(recipe => ({
    id: recipe.id,
    qtyIds: getTabProducts(config, recipe.id).map(row => row.qtyId),
  }));
}

// ⚠️ A NEW WORK DAY EMPTIES YESTERDAY'S NUMBERS — before a tab is first drawn, and again when the app comes
// back to the foreground (a tablet left open overnight), but NEVER while it is on screen: a tab must not
// empty itself under the fingers of somebody reading the recipe off it.
//
// The first sweep is a layout effect, so it runs before the browser paints: the screen that is painted
// never held yesterday's numbers. A tab that appears later (the server's answer after the phone's own copy;
// a recipe another phone switched on) is swept the same way, the first time it can be drawn — but a tab
// already on screen is not touched by the configuration arriving again.
function WorkDaySweep() {
  const state = useTabState();
  const { config } = useCalculator();
  // The tabs that have been drawn (or could have been) since the Calculator opened.
  const seen = useRef(new Set<string>());

  // The store hands back the same config object until the configuration itself changes.
  useLayoutEffect(() => {
    const fresh = tabsOf(config).filter(tab => !seen.current.has(tab.id));
    for (const tab of fresh) seen.current.add(tab.id);
    state.sweep(fresh);
  }, [state, config]);

  useLayoutEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') state.sweep(tabsOf(config));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); };
  }, [state, config]);

  return null;
}
