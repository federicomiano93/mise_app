import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { browserRecipesDeps, createRecipesStore } from './recipesStore';
import type { RecipesDeps, RecipesSnapshot, RecipesStore } from './recipesStore';

// One Recipe catalogue store for as long as the section is on screen: created from the open venue's
// source, started on mount and stopped on unmount — so the listener exists only while somebody is in
// the catalogue (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const RecipesContext = createContext<RecipesStore | null>(null);

export function RecipesProvider({ children, deps }: { children: ReactNode; deps?: RecipesDeps }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // The catalogue is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('The recipe catalogue needs an open venue.');
  const [store] = useState(() => createRecipesStore(services.recipes(locationId), deps ?? browserRecipesDeps()));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <RecipesContext.Provider value={store}>{children}</RecipesContext.Provider>;
}

export function useRecipesStore(): RecipesStore {
  const store = useContext(RecipesContext);
  if (!store) throw new Error('useRecipesStore must be used inside a <RecipesProvider>.');
  return store;
}

// The current data. The store hands back the SAME object until something changes.
export function useRecipes(): RecipesSnapshot {
  const store = useRecipesStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
