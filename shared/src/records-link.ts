// records-link.ts — the doors from «Orders» to the cards of «Ingredients & suppliers»: the addresses and the navigation
// states both sections must agree on.
//
// NEW IN MISE 2, NO ORIGINAL (the current app opens the card in a sheet over the order, not by an address). Mise 2 is one page
// with real routes, so a door in Orders is a navigate PUSH into the Suppliers section, and that section's own Back, Save and
// delete step back with the browser's Back when the entry's state says it came from a list or from a supplier's screen.
// A feature never imports another feature's folder, so what the two sides must say identically lives here;
// app/src/suppliers/ordersDoors.spec.ts pins the agreement against suppliersPath.ts and suppliersNav.ts.
//
// ⚠️ THE STATES CARRY `keepFocus` (shell/Page.tsx KEEP_FOCUS) so the page leaves the focus alone and the card puts it on its own
// title, `fromOrders` (what the door says about itself; nothing reads it yet) and the Suppliers' own keys: `fromList` + `tab`
// (the card is opened from a list) or `fromSupplierScreen` (the card is opened from that supplier's screen).

const SUPPLIERS = '/suppliers';

// shared/ is compiled without the DOM types; URLSearchParams exists in every browser and in Node.
declare const URLSearchParams: new () => { set(name: string, value: string): void; toString(): string };

export type RecordsTab = 'ingredients' | 'packaging' | 'suppliers';

// An ingredient's or packaging item's card.
export const ingredientCardAddress = (id: string): string => `${SUPPLIERS}/ingredient/${encodeURIComponent(id)}`;

// «New ingredient», starting on a supplier (null: no preset). Written through URLSearchParams, as suppliersPath.ts does, so the two
// builders agree character for character.
export function newIngredientAddress(supplierId: string | null): string {
  const base = `${SUPPLIERS}/ingredient/new`;
  if (supplierId === null) return base;
  const query = new URLSearchParams();
  query.set('supplier', supplierId);
  return `${base}?${query.toString()}`;
}

// A supplier's own screen.
export const supplierScreenAddress = (id: string): string => `${SUPPLIERS}/supplier/${encodeURIComponent(id)}`;

// A door that behaves like a row of the Suppliers list: Back is the browser's Back, and `tab` is the list beside the card.
export const fromOrdersList = (tab: RecordsTab) => ({ keepFocus: true, fromList: true, fromOrders: true, tab }) as const;

// A door that behaves like a button on that supplier's own screen («What they sell», «Add ingredient»).
export const fromOrdersSupplier = (supplierId: string) => ({ keepFocus: true, fromSupplierScreen: supplierId, fromOrders: true }) as const;
