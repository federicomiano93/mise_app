import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from '../recipes/recipesSource';
import { INGREDIENTS, LABEL_CONFIG, RECIPES } from './allergenBookFixtures';

// Draws the real app at an allergen-book address with an in-memory source behind it, for the section's specs.
export type Who = 'owner' | 'manager' | 'staff' | 'owner-kitchen';
const WHO: Record<Who, Record<string, unknown>> = {
  owner: { role: 'owner', canManage: true, isOwner: true },
  manager: { role: 'manager', canManage: true, isOwner: false },
  staff: { role: 'staff', canManage: false, isOwner: false },
  'owner-kitchen': { role: 'owner-kitchen', canManage: true, isOwner: true },
};

type Options = {
  path?: string;
  lang?: 'en' | 'it';
  country?: string | null;
  who?: Who;
  recipes?: StoredDoc[];
  location?: Record<string, unknown>;
  entries?: string[];
};

export function open({ path = '/allergen-book', lang = 'it', country = 'IT', who = 'owner', recipes = RECIPES, location = {}, entries }: Options = {}) {
  const source = fakeRecipesSource({ recipes, ingredients: INGREDIENTS, labelConfig: LABEL_CONFIG });
  const view = renderRecipes(path, {
    source,
    lang,
    session: { ...WHO[who], language: lang, location: { name: 'Forno di prova', ...(country === null ? {} : { country }), ...location } },
    ...(entries ? { entries } : {}),
  });
  return { ...view, source };
}

