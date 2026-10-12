import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { vatGuideFor } from '@mise/shared/vat-guide';
import { editorSource } from '../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../testing/renderFoodcost';

// How a product is sold, its VAT (the country's menu and guide), its target and its price, and the
// price the app suggests.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const IT = { location: { country: 'IT' } };

const saveBar = () => screen.getByRole('button', { name: 'Save' });
const vatMenu = () => screen.getByRole('combobox', { name: 'VAT rate' });
const otherRate = () => screen.queryByRole('textbox', { name: 'Another VAT rate, as a percentage' });
const priceBox = () => screen.getByRole('textbox', { name: 'Selling price including VAT' });
const targetBox = () => screen.getByRole('textbox', { name: 'Food cost target, as a percentage' });
const suggestion = () => screen.queryByRole('group', { name: 'Suggested price' });
const guideButton = () => screen.getByRole('button', { name: 'Which products take which VAT rate' });
const options = (menu: HTMLElement) => within(menu).getAllByRole('option').map(option => option.textContent);

async function confirmSave(user: UserEvent) {
  await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Save' }));
}

async function open(fields: Record<string, unknown> | null = {}, session: Record<string, unknown> = {}) {
  const fake = editorSource(fields === null ? [] : [product('Green', fields)]);
  const view = renderFoodcost(fields === null ? '/food-cost/new' : '/food-cost/product/Green', { source: fake, session });
  await screen.findByRole('combobox', { name: 'Product name' }, LOAD);
  return { ...view, fake };
}

describe('how it is sold', () => {
  it('offers the three ways, with no default', async () => {
    await open(null);
    const mode = screen.getByRole('combobox', { name: 'How it is sold' });
    expect(options(mode)).toEqual(['— Choose —', 'By the piece', 'By weight (per kg)', 'By the pack']);
    expect(mode).toHaveValue('');
  });

  it('shows the pieces box for a piece and the pack boxes for a pack, and nothing for weight', async () => {
    const { user } = await open(null);
    const mode = screen.getByRole('combobox', { name: 'How it is sold' });
    const pieces = () => screen.queryByRole('textbox', { name: 'How many pieces come out of one batch' });
    const packSize = () => screen.queryByRole('textbox', { name: 'What one pack holds' });

    expect(pieces()).not.toBeInTheDocument();
    expect(packSize()).not.toBeInTheDocument();

    await user.selectOptions(mode, 'piece');
    expect(pieces()).toBeInTheDocument();
    expect(packSize()).not.toBeInTheDocument();

    await user.selectOptions(mode, 'weight');
    expect(pieces()).not.toBeInTheDocument();
    expect(packSize()).not.toBeInTheDocument();

    // A pack: what it holds, in grams, kilos or pieces — and pieces per batch only for pieces.
    await user.selectOptions(mode, 'pack');
    expect(packSize()).toBeInTheDocument();
    expect(pieces()).not.toBeInTheDocument();
    const unit = screen.getByRole('combobox', { name: 'Unit' });
    expect(options(unit)).toEqual(['— Choose —', 'g', 'kg', 'pieces']);
    await user.selectOptions(unit, 'pcs');
    expect(pieces()).toBeInTheDocument();
    expect(screen.getByText('The weight in one pack, or how many pieces.')).toBeInTheDocument();
  });

  it('says packaging is counted per the way the product is sold, once there is a line', async () => {
    await open({ packaging: [{ ingredientId: 'box', qtyPcs: 1 }], sellingMode: 'weight', piecesPerBatch: null });
    expect(screen.getByText('Quantity per kg')).toBeInTheDocument();
  });
});

describe('the VAT menu', () => {
  it('is the country\'s: 20, 5 and 0 in Britain', async () => {
    await open(null);
    expect(options(vatMenu())).toEqual(['— Choose —', '20% — standard', '5% — reduced', '0% — zero-rated', 'Another rate…']);
  });

  it('is the country\'s: 22, 10 and 4 in Italy, whatever the interface language', async () => {
    await open(null, IT);
    expect(options(vatMenu())).toEqual(['— Choose —', '22% — standard', '10% — reduced', '4% — super-reduced', 'Another rate…']);
  });

  it('shows a stored rate the menu lacks as «another rate», unchanged', async () => {
    await open({ vatRate: 20 }, IT);
    expect(vatMenu()).toHaveValue('other');
    expect(otherRate()).toHaveValue('20');
  });

  it.each([
    ['zero-rated, a real answer', 0, '0'],
    ['not chosen', null, ''],
  ])('tells %s', async (_word, vatRate, shown) => {
    await open({ vatRate });
    expect(vatMenu()).toHaveValue(shown);
  });

  it('shows the free box only for «another rate», with the rate that will be saved', async () => {
    const { user } = await open({ vatRate: 5 });
    expect(vatMenu()).toHaveValue('5');
    expect(otherRate()).not.toBeInTheDocument();

    await user.selectOptions(vatMenu(), 'other');
    expect(otherRate()).toHaveValue('5');

    // A different rate typed there is the one that costs and the one that is saved.
    await user.clear(otherRate() as HTMLElement);
    await user.type(otherRate() as HTMLElement, '12,5');
    await user.selectOptions(vatMenu(), '20');
    expect(otherRate()).not.toBeInTheDocument();
    await user.selectOptions(vatMenu(), 'other');
    expect(otherRate()).toHaveValue('20');
  });

  it('writes the chosen rate', async () => {
    const { user, fake } = await open({ vatRate: 20 });
    await user.selectOptions(vatMenu(), '0');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved[0]).toMatchObject({ data: { vatRate: 0 }, snapshot: { vatRate: 0 } });
  });

  it('refuses a free rate the rules would refuse, naming the box', async () => {
    const { user } = await open({ vatRate: 20 });
    await user.selectOptions(vatMenu(), 'other');
    await user.clear(otherRate() as HTMLElement);
    await user.type(otherRate() as HTMLElement, '101');
    await user.click(saveBar());
    expect(await screen.findByText(/^Check «Another VAT rate, as a percentage»/)).toBeInTheDocument();
    expect(otherRate()).toHaveAttribute('aria-invalid', 'true');
    expect(otherRate()).toHaveFocus();
  });
});

describe('the VAT guide', () => {
  const closeGuide = () => vi.waitFor(() => { expect(screen.queryByRole('dialog')).not.toBeInTheDocument(); });

  it('opens with «your accountant confirms», the rates highest first, and the day it was checked', async () => {
    const { user } = await open({ vatRate: 20 });
    await user.click(guideButton());
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(within(dialog).getByRole('heading', { level: 2, name: 'VAT rates' })).toBeInTheDocument();
    expect(within(dialog).getByText(/for your accountant to confirm\.$/)).toBeInTheDocument();
    expect(within(dialog).getAllByRole('heading', { level: 3 }).map(heading => heading.textContent))
      .toEqual(['VAT 20%', 'VAT 5%', 'VAT 0%', 'Good to know']);
    expect(within(dialog).getByText('Sources, checked on 13 September 2026:')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('link').length).toBeGreaterThan(0);
  });

  it('offers no button on a rate nothing takes, and says «In use» beside the rate it is', async () => {
    const { user } = await open({ vatRate: 20 });
    await user.click(guideButton());
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(within(dialog).queryByRole('button', { name: 'Use 5%' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Use 20%' })).not.toBeInTheDocument();
    expect(within(dialog).getByText('In use')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Use 0%' })).toBeInTheDocument();
  });

  it('draws the items in the country\'s language, even with an English interface', async () => {
    const { user } = await open({ vatRate: 22 }, IT);
    await user.click(guideButton());
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    const italian = vatGuideFor('IT');
    expect(within(dialog).getByText(italian.rates[0]?.items[0] as string)).toBeInTheDocument();
    expect(within(dialog).getByText(italian.notes[0] as string)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: italian.sources[0]?.title })).toHaveAttribute('href', italian.sources[0]?.url);
    // …while the words around them are the interface's.
    expect(within(dialog).getByRole('heading', { level: 2, name: 'VAT rates' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Use 10%' })).toBeInTheDocument();
  });

  it('puts a chosen rate through the menu\'s own rule: the menu\'s rate, or «another rate»', async () => {
    const { user } = await open({ vatRate: 20 }, IT);
    await user.click(guideButton());
    await user.click(within(await screen.findByRole('dialog', undefined, LOAD)).getByRole('button', { name: 'Use 10%' }));
    await closeGuide();
    expect(vatMenu()).toHaveValue('10');
    expect(otherRate()).not.toBeInTheDocument();

    // Italy's 5% is in the guide but not in the menu: it lands in «another rate», unchanged.
    await user.click(guideButton());
    await user.click(within(await screen.findByRole('dialog', undefined, LOAD)).getByRole('button', { name: 'Use 5%' }));
    await closeGuide();
    expect(vatMenu()).toHaveValue('other');
    expect(otherRate()).toHaveValue('5');
  });

  it('gives the focus back to its button, on Escape and after a rate is used', async () => {
    const { user } = await open({ vatRate: 20 });
    await user.click(guideButton());
    await screen.findByRole('dialog', undefined, LOAD);
    await user.keyboard('{Escape}');
    await closeGuide();
    await vi.waitFor(() => { expect(guideButton()).toHaveFocus(); });
    expect(vatMenu()).toHaveValue('20');

    await user.click(guideButton());
    await user.click(within(await screen.findByRole('dialog', undefined, LOAD)).getByRole('button', { name: 'Use 0%' }));
    await closeGuide();
    await vi.waitFor(() => { expect(guideButton()).toHaveFocus(); });
    expect(vatMenu()).toHaveValue('0');
  });

  it('speaks Italian around the Italian items when the interface is Italian', async () => {
    const fake = editorSource([product('Green', { vatRate: 22 })]);
    const { user } = renderFoodcost('/food-cost/product/Green', { source: fake, lang: 'it', session: { language: 'it', ...IT } });
    await user.click(await screen.findByRole('button', { name: 'Quali prodotti hanno quale aliquota IVA' }, LOAD));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Aliquote IVA' })).toBeInTheDocument();
    expect(within(dialog).getByText(/^Fonti, verificate il 13 settembre 2026/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Usa 10%' })).toBeInTheDocument();
  });
});

describe('the selling price and the target', () => {
  it('labels the price with the venue\'s currency, and says it includes VAT', async () => {
    await open(null);
    expect(screen.getByText('Selling price, including VAT (£)')).toBeInTheDocument();
    expect(screen.getByText('The price on the label. The app takes the VAT off before working out the food cost.')).toBeInTheDocument();
  });

  it('labels it with the venue\'s own currency in Italy', async () => {
    await open(null, IT);
    expect(screen.getByText('Selling price, including VAT (€)')).toBeInTheDocument();
  });

  it('reads a comma as a decimal point, and empty as no price', async () => {
    const { user, fake } = await open({});
    await user.clear(priceBox());
    await user.type(priceBox(), '1,5');
    await user.clear(targetBox());
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByText('Product saved.');
    expect(fake.saved[0]).toMatchObject({ data: { sellingPrice: 1.5, foodCostTarget: null } });
  });
});

describe('the suggested price', () => {
  it('is not drawn without a cost per unit', async () => {
    await open(null);
    expect(suggestion()).not.toBeInTheDocument();
  });

  it('asks for the VAT rate and the target while they are missing', async () => {
    await open({ vatRate: null, foodCostTarget: null });
    expect(screen.getByText('Choose the VAT rate and a food cost target to see the price to sell it at.')).toBeInTheDocument();
  });

  it('gives the price that puts the food cost exactly at the target, VAT added back', async () => {
    await open({ sellingPrice: null });
    // £0.20 a piece at a 25% target is £0.80 net, £0.96 with 20% VAT.
    expect(suggestion()).toHaveTextContent('£0.96per piece');
    expect(suggestion()).toHaveTextContent('With VAT at 20%, for a 25% food cost.');
  });

  it('says a partly priced product needs a higher price than this', async () => {
    await open({ components: [
      { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' },
      { kind: 'ingredient', ingredientId: 'salt', qty: 10, unit: 'g' },
    ] });
    expect(suggestion()).toHaveTextContent('Part of this product is not priced yet, so the right price is higher than this.');
  });

  it('fills the price with «Use this price», and keeps the focus where the button was', async () => {
    const { user } = await open({ sellingPrice: 1.2 });
    await user.click(within(suggestion() as HTMLElement).getByRole('button', { name: 'Use this price' }));
    expect(priceBox()).toHaveValue('0.96');
    expect(screen.getByRole('group', { name: 'Food cost' })).toHaveTextContent('25%');
    expect(within(suggestion() as HTMLElement).getByText('This is the selling price.')).toBeInTheDocument();
    expect(within(suggestion() as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
    // The button has just gone: the focus stays in the box that says so, not lost to the page.
    expect(suggestion()?.parentElement).toHaveFocus();
  });

  it('says «This is the selling price» when the price already is the suggestion', async () => {
    await open({ sellingPrice: 0.96 });
    expect(within(suggestion() as HTMLElement).getByText('This is the selling price.')).toBeInTheDocument();
    expect(within(suggestion() as HTMLElement).queryByRole('button')).not.toBeInTheDocument();
  });
});
