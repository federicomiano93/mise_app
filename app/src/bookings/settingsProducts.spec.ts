import { describe, expect, it } from 'vitest';
import { readPriceList } from '@mise/shared/price-list';
import {
  NO_CHOICE, changesSincePublish, choiceOf, choicesFrom, itemsToPublish, productRows, publishDiffers, removableOf, sameChoices,
  tickChoice,
} from './settingsProducts';

// The «Prodotti» group of the bookings settings: Food cost's products → the working copy → the published list.

const recipes: Record<string, unknown> = {
  r1: { ingredients: [{ label: 'Farina' }, { label: 'Cipolla' }, { label: 'Acciughe' }] },
};
const lookup = (id: string) => recipes[id];
const products = [
  { id: 'p1', name: 'Pizza di cipolla', sellingMode: 'weight', sellingPrice: 16, components: [{ recipeId: 'r1', qtyKg: 1 }] },
  { id: 'p2', name: 'Cornetto', sellingMode: 'piece', sellingPrice: 1.5 },
  { id: 'p3', name: 'Torta senza prezzo', sellingMode: 'piece', sellingPrice: null },
  { id: 'p4', name: '  ', sellingMode: 'piece', sellingPrice: null },
];

describe('productRows', () => {
  it('the products with a selling price, A→Z, each with its recipe\'s ingredients; the others by name', () => {
    const { rows, unpriced } = productRows(products, lookup, 'it');
    expect(rows.map(r => r.item.name)).toEqual(['Cornetto', 'Pizza di cipolla']);
    expect(rows[1]?.prefill).toEqual(['Farina', 'Cipolla', 'Acciughe']);
    expect(rows[0]?.prefill).toEqual([]);
    expect(unpriced).toEqual(['Torta senza prezzo']);
  });
});

describe('the working copy and what is published', () => {
  const { rows } = productRows(products, lookup, 'it');
  const published = readPriceList({ items: [
    { productId: 'p1', name: 'Pizza di cipolla', price: 16, per: 'kg', favourite: true, weights: [1, 0.5], removable: ['Cipolla'] },
  ] });

  it('the published list ticks its products with what was chosen', () => {
    const choices = choicesFrom(published);
    expect(choiceOf(choices, 'p1')).toEqual({ ticked: true, favourite: true, perPiece: false, weights: [0.5, 1], removable: ['Cipolla'] });
    expect(choiceOf(choices, 'p2')).toEqual(NO_CHOICE);
  });

  it('publishing the same choices publishes nothing new', () => {
    expect(publishDiffers(itemsToPublish(rows, choicesFrom(published)), published)).toBe(false);
  });

  it('ticking a product pre-fills «can be left out» from its recipe, as a choice; no recipe, nothing', () => {
    const pizza = rows[1]!;
    const cornetto = rows[0]!;
    expect(tickChoice(NO_CHOICE, pizza, true)).toEqual({ ...NO_CHOICE, ticked: true, removable: ['Farina', 'Cipolla', 'Acciughe'] });
    expect(tickChoice(NO_CHOICE, cornetto, true)).toEqual({ ...NO_CHOICE, ticked: true, removable: null });
    // A choice already made is kept, ticked again or not.
    expect(tickChoice({ ...NO_CHOICE, removable: ['Cipolla'] }, pizza, true).removable).toEqual(['Cipolla']);
    expect(tickChoice({ ...NO_CHOICE, ticked: true, removable: ['Cipolla'] }, pizza, false)).toMatchObject({ ticked: false, removable: ['Cipolla'] });
  });

  it('⚠️ a product never chosen is never published with the recipe\'s list by a Save that changed something else', () => {
    const choices = new Map([['p1', { ...NO_CHOICE, ticked: true }]]);
    expect(itemsToPublish(rows, choices)[0]?.removable).toBeNull();
    const step2 = readPriceList({ items: [{ productId: 'p1', name: 'Pizza di cipolla', price: 16, per: 'kg' }] });
    expect(publishDiffers(itemsToPublish(rows, choicesFrom(step2)), step2)).toBe(false);
    // The dialog opens on the recipe's ingredients until something is chosen; once chosen, never again.
    expect(removableOf(NO_CHOICE, rows[1]!)).toEqual(['Farina', 'Cipolla', 'Acciughe']);
    expect(removableOf({ ...NO_CHOICE, removable: [] }, rows[1]!)).toEqual([]);
  });

  it('weights only for a product sold by the kilo', () => {
    const choices = new Map([['p2', { ...NO_CHOICE, ticked: true, weights: [1] }]]);
    expect(itemsToPublish(rows, choices)[0]?.weights).toEqual([]);
  });

  it('only ticked products are published, at Food cost\'s price now', () => {
    const choices = new Map([['p1', { ...NO_CHOICE, ticked: false }], ['p2', { ...NO_CHOICE, ticked: true }]]);
    expect(itemsToPublish(rows, choices).map(i => [i.productId, i.price])).toEqual([['p2', 1.5]]);
  });

  it('unsaved changes: what is chosen for an unticked product is not one', () => {
    const a = new Map([['p1', { ...NO_CHOICE, ticked: true }]]);
    expect(sameChoices(a, new Map([['p1', { ...NO_CHOICE, ticked: true }], ['p2', { ...NO_CHOICE, favourite: true }]]))).toBe(true);
    expect(sameChoices(a, new Map([['p1', { ...NO_CHOICE, ticked: true, favourite: true }]]))).toBe(false);
    expect(sameChoices(a, new Map())).toBe(false);
  });

  it('says what changed in Food cost since the last publish', () => {
    expect(changesSincePublish(rows, published)).toEqual({ stale: false, gone: 0 });
    const old = readPriceList({ items: [
      { productId: 'p1', name: 'Pizza di cipolla', price: 15, per: 'kg' },
      { productId: 'gone', name: 'Vecchio', price: 2, per: 'piece' },
    ] });
    expect(changesSincePublish(rows, old)).toEqual({ stale: true, gone: 1 });
  });
});
