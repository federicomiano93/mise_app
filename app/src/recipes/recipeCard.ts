

import { toProductDocument } from '../foodcost/foodcostStore';

// toProductDocument stamps the app's own model itself.
type Product = Parameters<typeof toProductDocument>[0];

// The answer to «Food cost card» at the foot of a NEW recipe: a finished product, a semi-finished one, or no card.
export type CardChoice = 'finished' | 'semi' | 'none';

// The rules cap a product's name at 200 characters (firestore.rules, products).
const NAME_MAX = 200;

// The card made together with a new recipe: ONLY the recipe's name, everything else empty. Not the recipe pre-loaded into «Made of»
// (that is «Cards from the Recipe book»): this card is filled in later. Built by Food cost's own product → document function from an
// empty product, so it holds exactly the keys the rules accept (model 4, kind, no lines, no price). null for «no card» (or no name).
export function recipeCardDocument(choice: CardChoice, recipeName: string): Record<string, unknown> | null {
  if (choice === 'none') return null;
  const name = recipeName.trim().slice(0, NAME_MAX);
  if (name === '') return null;
  const empty: Product = {
    id: '', name, components: [], packaging: [],
    sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null,
    sellingPrice: null, vatRate: null, foodCostTarget: null,
    labourMinutes: null, labourPeople: null, noWeightLoss: false,
    rawGrams: null, cookedGrams: null, model: null,
    kind: choice, categoryId: null,
  };
  return toProductDocument(empty);
}
