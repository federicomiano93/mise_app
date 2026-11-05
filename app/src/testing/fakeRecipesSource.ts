import { vi } from 'vitest';
import type { RecipesMeta, RecipesSource, StoredDoc } from '../recipes/recipesSource';

// A Recipe catalogue source for the specs of screens, in memory: the recipes are a plain map, and
// every live watcher is told when they change, like Firestore would. The store itself is covered
// against its own fake in recipesStore.spec.ts; a screen's spec only needs a database that behaves.
type Listener = { onChange: (list: StoredDoc[], meta: RecipesMeta) => void; onError: (err: unknown) => void };
// This fake is a database that is online: every answer comes from the server.
const FROM_SERVER: RecipesMeta = { fromServer: true };

export type FakeRecipesSource = RecipesSource & {
  recipes: Map<string, StoredDoc>;
  // The next watch fails (the rules refused it, or the stream died).
  refuse: { recipes: boolean };
  // Tells every watcher again (as another phone's write would).
  push(): void;
  // Kills every live stream, as a lost permission would.
  breakStream(): void;
  // Holds back the first answer until release() (Firestore still loading).
  hold(): void;
  release(): void;
};

export function fakeRecipesSource(seed: { recipes?: StoredDoc[] } = {}): FakeRecipesSource {
  const recipes = new Map((seed.recipes ?? []).map(doc => [doc.id, doc] as const));
  const watchers = new Set<Listener>();
  const refuse = { recipes: false };
  let held = false;
  const refused = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

  const fake: FakeRecipesSource = {
    recipes, refuse,
    push() {
      if (!held) for (const w of watchers) w.onChange([...recipes.values()], FROM_SERVER);
    },
    breakStream() {
      for (const w of [...watchers]) {
        watchers.delete(w);
        w.onError(refused());
      }
    },
    hold() { held = true; },
    release() { held = false; fake.push(); },

    watchRecipes: vi.fn<RecipesSource['watchRecipes']>((onChange, onError) => {
      const listener: Listener = { onChange, onError };
      watchers.add(listener);
      // Like onSnapshot: the first answer arrives after the call returns.
      queueMicrotask(() => {
        if (!watchers.has(listener)) return;
        if (refuse.recipes) {
          watchers.delete(listener);
          onError(refused());
        } else if (!held) {
          onChange([...recipes.values()], FROM_SERVER);
        }
      });
      return () => { watchers.delete(listener); };
    }),
  };
  return fake;
}
