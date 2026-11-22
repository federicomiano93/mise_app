import { describe, expect, it } from 'vitest';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import { baseLook, cakeLooks, coatingLook, decorationLook, fillingLook, looksKey, soakLook } from './cakeLook';

const DARK = '#3a1d12';

describe('the look of a coating', () => {
  it('chocolate in either language is dark and glazed', () => {
    for (const name of ['Glassa al cioccolato', 'Ganache fondente', 'Chocolate glaze', 'Cocoa coating', 'Cacao']) {
      expect(coatingLook([name])).toEqual({ colour: DARK, glaze: true });
    }
  });
  it('white chocolate is ivory, not dark, and a plain «white» does not shine', () => {
    expect(coatingLook(['Cioccolato bianco']).colour).toBe('#f1e8d2');
    expect(coatingLook(['White chocolate']).colour).toBe('#f1e8d2');
    expect(coatingLook(['Panna bianca']).colour).toBe('#f6eedd');
    expect(coatingLook(['Copertura bianca'])).toEqual({ colour: '#f1e8d2', glaze: false });
  });
  it('a cream is matte; a word like «glassa» or «specchio» makes any colour shine', () => {
    expect(coatingLook(['Panna montata'])).toEqual({ colour: '#f6eedd', glaze: false });
    expect(coatingLook(['Glassa a specchio alla fragola']).glaze).toBe(true);
    expect(coatingLook(['Glassa']).colour).toBeNull();
    expect(coatingLook(['Glassa']).glaze).toBe(true);
  });
  it('knows the other flavours in both languages', () => {
    expect(coatingLook(['Crema al pistacchio']).colour).toBe('#b6c277');
    expect(coatingLook(['Pistachio cream']).colour).toBe('#b6c277');
    for (const name of ['Fragola', 'Lampone', 'Frutti di bosco', 'Frutti rossi', 'Strawberry', 'Raspberry', 'Mixed berries']) {
      expect(coatingLook([name]).colour).toBe('#d9566e');
    }
    expect(coatingLook(['Mirtillo']).colour).toBe('#4a5a96');
    expect(coatingLook(['Blueberry jam']).colour).toBe('#4a5a96');
    expect(coatingLook(['Limone']).colour).toBe('#f4e58a');
    expect(coatingLook(['Lemon curd']).colour).toBe('#f4e58a');
    for (const name of ['Caffè', 'Coffee', 'Tiramisù']) expect(coatingLook([name]).colour).toBe('#9b6b45');
    for (const name of ['Nocciola', 'Hazelnut', 'Gianduia']) expect(coatingLook([name]).colour).toBe('#b98456');
    expect(coatingLook(['Caramello'])).toEqual({ colour: '#c98a3a', glaze: true });
    expect(coatingLook(['Caramel'])).toEqual({ colour: '#c98a3a', glaze: true });
    expect(coatingLook(['Meringa']).colour).toBe('#fbf8f0');
    expect(coatingLook(['Italian meringue']).colour).toBe('#fbf8f0');
    for (const name of ['Panna', 'Chantilly', 'Crema', 'Cream', 'Vaniglia', 'Vanilla']) expect(coatingLook([name]).colour).toBe('#f6eedd');
  });
  it('ignores accents and case', () => {
    expect(coatingLook(['CIOCCOLATO FONDENTE']).colour).toBe(DARK);
    expect(coatingLook(['CAFFÈ']).colour).toBe('#9b6b45');
    expect(coatingLook(['tiramisù']).colour).toBe('#9b6b45');
  });
  it('matches nothing it does not know: the token colour stays', () => {
    expect(coatingLook(['Pasta di zucchero'])).toEqual({ colour: null, glaze: false });
    expect(coatingLook([])).toEqual({ colour: null, glaze: false });
    expect(coatingLook([''])).toEqual({ colour: null, glaze: false });
  });
  it('the FIRST card that matches decides, a card that matches nothing is skipped', () => {
    expect(coatingLook(['Pasta di zucchero', 'Cioccolato', 'Pistacchio']).colour).toBe(DARK);
    expect(coatingLook(['Pistacchio', 'Cioccolato']).colour).toBe('#b6c277');
  });
});

describe('the look of a filling', () => {
  it('a ganache shines, a custard has vanilla specks, a cream too', () => {
    expect(fillingLook(['Ganache'])).toEqual({ colour: DARK, glossy: true, specks: false });
    expect(fillingLook(['Crema pasticcera'])).toEqual({ colour: '#e9bc3f', glossy: false, specks: true });
    expect(fillingLook(['Chantilly']).specks).toBe(true);
  });
  it('a pistachio cream is pistachio, not cream', () => {
    expect(fillingLook(['Crema al pistacchio']).colour).toBe('#b6c277');
  });
});

describe('the look of a decoration', () => {
  it('names what stands on top', () => {
    expect(decorationLook(['Riccioli di cioccolato']).kind).toBe('curls');
    expect(decorationLook(['Granella di pistacchio']).kind).toBe('grains');
    expect(decorationLook(['Hazelnut crumble']).kind).toBe('grains');
    expect(decorationLook(['Frutti di bosco']).kind).toBe('berries');
    expect(decorationLook(['Strawberries']).kind).toBe('berries');
    expect(decorationLook(['Mirtilli']).kind).toBe('blueberries');
    expect(decorationLook(['Panna montata']).kind).toBe('rosettes');
    expect(decorationLook(['Meringhe']).kind).toBe('rosettes');
    expect(decorationLook(['Meringa']).kind).toBe('rosettes');
  });
  it('a lemon or coffee decoration keeps the round pieces, in its colour', () => {
    expect(decorationLook(['Limone'])).toEqual({ kind: 'plain', colour: '#f4e58a' });
    expect(decorationLook(['Coffee beans'])).toEqual({ kind: 'plain', colour: '#9b6b45' });
  });
  it('an unknown name is the plain pieces in the token colour', () => {
    expect(decorationLook(['Fiori eduli'])).toEqual({ kind: 'plain', colour: null });
  });
});

describe('the shape follows the form word, the colour follows the flavour', () => {
  it('a decoration: «panna al cioccolato» is piped cream in chocolate, «granella di cioccolato» grains in chocolate', () => {
    expect(decorationLook(['Panna al cioccolato'])).toEqual({ kind: 'rosettes', colour: DARK });
    expect(decorationLook(['Granella di cioccolato'])).toEqual({ kind: 'grains', colour: DARK });
    expect(decorationLook(['Gocce di cioccolato']).kind).toBe('grains');
    expect(decorationLook(['Chocolate chips'])).toEqual({ kind: 'grains', colour: DARK });
    expect(decorationLook(['Scaglie di pistacchio'])).toEqual({ kind: 'curls', colour: '#b6c277' });
    expect(decorationLook(['Chocolate shavings']).kind).toBe('curls');
    expect(decorationLook(['Ciuffi di crema al caffè'])).toEqual({ kind: 'rosettes', colour: '#9b6b45' });
    expect(decorationLook(['Whipped cream']).kind).toBe('rosettes');
  });
  it('a meringue is piped, in the colour of its flavour', () => {
    expect(decorationLook(['Meringa al limone'])).toEqual({ kind: 'rosettes', colour: '#f4e58a' });
    expect(decorationLook(['Lemon meringue']).kind).toBe('rosettes');
  });
  it('with no form word the flavour decides the shape, as before', () => {
    expect(decorationLook(['Cioccolato']).kind).toBe('curls');
    expect(decorationLook(['Nocciola']).kind).toBe('grains');
    expect(decorationLook(['Limone']).kind).toBe('plain');
  });
  it('mixed berries are not blueberries only (the longer phrase first)', () => {
    expect(decorationLook(['Frutti di bosco e mirtilli'])).toEqual({ kind: 'berries', colour: '#d9566e' });
    expect(decorationLook(['Mirtilli e lamponi']).kind).toBe('berries');
    expect(decorationLook(['Mirtilli']).kind).toBe('blueberries');
  });
  it('a cream in chocolate is matte with no drips; a glaze or a ganache shines', () => {
    for (const name of ['Crema al cioccolato', 'Panna al cioccolato', 'Chocolate cream', 'Mousse al cioccolato']) {
      expect(coatingLook([name])).toEqual({ colour: DARK, glaze: false });
    }
    for (const name of ['Glassa al cioccolato', 'Ganache', 'Mirror glaze', 'Glassa a specchio']) expect(coatingLook([name]).glaze).toBe(true);
    expect(fillingLook(['Crema al cioccolato']).glossy).toBe(false);
    expect(fillingLook(['Ganache']).glossy).toBe(true);
  });
  it('the colour and the shine come from the SAME card, the first one that says anything', () => {
    // Not a cream-coloured mirror glaze: the second card is never read.
    expect(coatingLook(['Panna montata', 'Ganache'])).toEqual({ colour: '#f6eedd', glaze: false });
    expect(coatingLook(['Ganache', 'Panna montata'])).toEqual({ colour: DARK, glaze: true });
    expect(fillingLook(['Panna montata', 'Ganache']).glossy).toBe(false);
    expect(decorationLook(['Granella', 'Panna al cioccolato'])).toEqual({ kind: 'grains', colour: null });
  });
});

describe('the look of a sponge and its soak', () => {
  it('a sponge is golden, a cocoa sponge brown, anything else keeps the token', () => {
    for (const name of ['Pan di Spagna', 'Genoise', 'Vanilla sponge', 'Sponge']) expect(baseLook([name]).colour).toBe('#ecca8a');
    expect(baseLook(['Pan di Spagna al cacao']).colour).toBe('#7a4c30');
    expect(baseLook(['Chocolate sponge']).colour).toBe('#7a4c30');
    expect(baseLook(['Pasta frolla']).colour).toBeNull();
  });
  it('the soak is tinted by what it is made of', () => {
    expect(soakLook(['Bagna all’alchermes']).colour).toBe('#b4453f');
    expect(soakLook(['Bagna al rum']).colour).toBe('#c08030');
    expect(soakLook(['Liquore']).colour).toBe('#c08030');
    expect(soakLook(['Bagna al caffè']).colour).toBe('#6b4126');
    expect(soakLook(['Bagna al limone']).colour).toBe('#f1dc6e');
    expect(soakLook(['Bagna al limoncello']).colour).toBe('#c08030');
    expect(soakLook(['Rum syrup']).colour).toBe('#c08030');
    expect(soakLook(['Bagna analcolica']).colour).toBeNull();
    // «rum» inside another word is not a rum.
    expect(soakLook(['Crumble']).colour).toBeNull();
  });
});

describe('the looks of a whole cake', () => {
  const CAKE: Cake = {
    id: 'c1', name: 'Plain', diameterCm: 22, tiers: 2, discs: 2, slices: 12,
    lines: [
      { tier: 0, part: 'base', productId: 'A', grams: 500 },
      { tier: 0, part: 'coating', productId: 'B', grams: 300 },
      { tier: 1, part: 'decoration', productId: 'C', grams: 40 },
    ],
    packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: null, model: 1,
  };
  const names: Record<string, string> = { A: 'Pan di spagna', B: 'Ganache', C: 'Frutti di bosco' };
  const looks = (lookup: Record<string, string>) => cakeLooks(cakeGeometry(CAKE), id => lookup[id] ?? '');

  it('gives one look per tier, from the names of its cards', () => {
    const [first, second] = looks(names);
    expect(first?.base.colour).toBe('#ecca8a');
    expect(first?.coating).toEqual({ colour: DARK, glaze: true });
    expect(first?.decoration.kind).toBe('plain');
    expect(second?.decoration.kind).toBe('berries');
  });
  it('the key moves with the look and does not with grams, or with a rename that looks the same', () => {
    const key = looksKey(looks(names));
    expect(looksKey(looks({ ...names, A: 'Genoise' }))).toBe(key);
    expect(looksKey(looks({ ...names, B: 'Glassa al cioccolato' }))).toBe(key);
    expect(looksKey(cakeLooks(cakeGeometry({ ...CAKE, lines: CAKE.lines.map(line => ({ ...line, grams: 1 })) }), id => names[id] ?? ''))).toBe(key);
    expect(looksKey(looks({ ...names, B: 'Panna' }))).not.toBe(key);
    expect(looksKey(looks({ ...names, C: 'Riccioli di cioccolato' }))).not.toBe(key);
  });
});
