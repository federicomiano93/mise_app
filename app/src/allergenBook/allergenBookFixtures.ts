import type { StoredDoc } from '../recipes/recipesSource';

// Invented products for the allergen book's screen specs. Nothing here is a real business's data.
const STAMP = '2026-01-01';
const declared = (id: string, allergens: string[]): StoredDoc => ({ id, name: id, allergens, allergensCheckedAt: STAMP });
export const INGREDIENTS: StoredDoc[] = [declared('flour', ['gluten-wheat']), declared('milk', ['milk']), declared('sugar', [])];

const row = (label: string, grams: number, refId?: string) => ({ label, grams, unit: 'g', ...(refId === undefined ? {} : { refId }) });
const recipeDoc = (id: string, name: string, extra: Record<string, unknown> = {}): StoredDoc =>
  ({ id, name, ingredients: [row('Farina', 300, 'flour'), row('Latte', 200, 'milk'), row('Zucchero', 100, 'sugar')], ...extra });

// In the book and complete, in a category.
export const TORTA = recipeDoc('torta', 'Torta della nonna di prova', { category: 'Torte', inBook: true });
export const BISCOTTO = recipeDoc('biscotto', 'Biscotto test', { category: 'Biscotti', inBook: true });
// In the book, complete, in no category.
export const PANE = { id: 'pane', name: 'Pane prova', inBook: true, ingredients: [row('Farina', 500, 'flour'), row('Acqua', 300, 'sugar')] } as StoredDoc;
// In the book, a row nobody has declared: its label is refused («1 ingredient not declared»).
export const INCOMPLETO = { id: 'incompleto', name: 'Panino incompleto prova', category: 'Torte', inBook: true, ingredients: [row('Farina', 300, 'flour'), row('Misterioso', 50)] } as StoredDoc;
// Not in the book.
export const FUORI = recipeDoc('fuori', 'Torta fuori dal libro', { category: 'Torte' });
// In the book by its flag, but archived: hidden everywhere.
export const VECCHIA = recipeDoc('vecchia', 'Torta archiviata di prova', { category: 'Torte', inBook: true, archived: true });

export const RECIPES: StoredDoc[] = [TORTA, BISCOTTO, PANE, INCOMPLETO, FUORI, VECCHIA];
export const LABEL_CONFIG = { recipeCategories: ['Torte', 'Biscotti'] };
