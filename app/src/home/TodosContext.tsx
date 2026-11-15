import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { useDataServices } from '../data/DataContext';
import { useSession } from '../session/SessionContext';
import { createTodosStore } from './todosStore';
import type { TodosSnapshot, TodosStore } from './todosStore';

// One to-do store for as long as the Home is on screen: made from the open venue's source, started on
// mount and stopped on unmount, so the listener exists only while somebody looks at the list (P14).
//
// The venue cannot change under it: a venue switch reloads the whole app (session.ts).
const TodosContext = createContext<TodosStore | null>(null);

export function TodosProvider({ children }: { children: ReactNode }) {
  const services = useDataServices();
  const { locationId } = useSession();
  // The Home is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('The Home needs an open venue.');
  const [store] = useState(() => createTodosStore(services.todos(locationId)));

  useEffect(() => {
    store.start();
    return () => store.stop();
  }, [store]);

  return <TodosContext.Provider value={store}>{children}</TodosContext.Provider>;
}

export function useTodosStore(): TodosStore {
  const store = useContext(TodosContext);
  if (!store) throw new Error('useTodosStore must be used inside a <TodosProvider>.');
  return store;
}

// The current list. The store hands back the SAME object until something changes.
export function useTodos(): TodosSnapshot {
  const store = useTodosStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
