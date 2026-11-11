import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { editorSource, intoForm, recipe } from '../testing/foodcostEditorFixtures';
import { bareProduct, EMPLOYEE, LOAD, MANAGER, product, renderFoodcost } from '../testing/renderFoodcost';

// The tidy card (Federico, 11 Nov 2026; docs/parity/foodcost.md, «Tidy card and «?» as built (step 3a)»): the summary, six sections
// each with a «?» that explains it, a closed «Cost breakdown», and no «Full card» frame, no «Calculated costs» box. What the SCREEN
// does, in the read view, in the form and in the phone's preview dialog; the arithmetic is shared/src (foodcost-model, per-kg-model).

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;

const FLOUR_LINE = { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' };
const SALT_LINE = { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' };
const GHOST_LINE = { kind: 'ingredient', ingredientId: 'ghost', qty: 5, unit: 'g' };

const SECTIONS = ['Product', 'Made of', 'Baking', 'Packaging', 'Work', 'Price'];
// The form's «?» texts; the read view says the same, except where a sentence only makes sense with boxes to type in (READ_HELP, step 3b).
const HELP: Record<string, RegExp> = {
  'Summary per piece': /^The figures are for one piece\. Food cost is the cost of ingredients and packaging/,
  Product: /^Pieces per batch: how many finished pieces/,
  'Made of': /^Write what goes into the dough, weighed raw\. Tap a name to change it\. On the right is what the amount written costs\.$/,
  Baking: /^Weigh the dough before and after the oven/,
  Packaging: /^Boxes, bags, cases, labels/,
  Work: /^The time to make one batch.*If you leave it empty/,
  Price: /^The price on the label, VAT included/,
};
const READ_HELP: Record<string, RegExp> = {
  ...HELP,
  'Made of': /^What goes into the dough, weighed raw\. On the right is what the amount written costs\.$/,
  Baking: /^The dough weighed before and after the oven\..*With no cooked weight, the product does not lose weight\.$/,
  Work: /^The time to make one batch, from weighing to the finished product\. Without it, labour is not counted\.$/,
};

const pencil = () => screen.getByRole('button', { name: 'Edit product' });
const sectionTitles = () => screen.getAllByRole('heading', { level: 3 })
  .map(heading => heading.textContent ?? '')
  .filter(title => !/^(Summary|Riepilogo)/.test(title));
const summary = () => screen.getByRole('group', { name: /^(Summary|Riepilogo)/ });
const figure = (label: string | RegExp, scope: HTMLElement = summary()): HTMLElement =>
  within(scope).getByText(label, { selector: 'dt' }).closest('div') as HTMLElement;
const detailsButton = (scope: HTMLElement = summary()) => within(scope).getByRole('button', { name: /^(Details|Dettagli)$/ });

async function read(id: string, fake: ReturnType<typeof editorSource>, options = {}) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
  await screen.findByRole('button', { name: /^(Edit product|Modifica il prodotto)$/ }, LOAD);
  return { ...view, fake };
}

async function form(id: string, fake: ReturnType<typeof editorSource>, options = {}) {
  const view = renderFoodcost(`/food-cost/product/${id}`, { source: fake, ...options });
  await intoForm(view.user);
  return { ...view, fake };
}

const GREEN = () => editorSource([product('Green')]);
// Flour priced, salt not: one line without a cost. Add a ribbon nobody priced per piece for two.
const SALTY = () => editorSource([product('Salty', { components: [FLOUR_LINE, SALT_LINE] })]);
const SALTY_WRAPPED = () => editorSource([product('Salty', {
  components: [FLOUR_LINE, SALT_LINE],
  packaging: [{ ingredientId: 'ribbon', qtyPcs: 1 }],
})]);
// A loaf of one kilo of dough, 880 g out of the oven.
const LOAF = (fields: Record<string, unknown> = {}) => editorSource(
  [product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], cookedGrams: 880, model: 3, ...fields })],
  { recipes: [recipe('Dough')] },
);

describe('the order of the card', () => {
  it('read: the summary, then six sections, then the closed «Cost breakdown», then history and delete — no frame', async () => {
    await read('Green', GREEN());
    expect(sectionTitles()).toEqual(SECTIONS);
    const order = [
      summary(),
      screen.getByRole('region', { name: 'Product' }), screen.getByRole('region', { name: 'Made of' }), screen.getByRole('region', { name: 'Baking' }),
      screen.getByRole('region', { name: 'Packaging' }), screen.getByRole('region', { name: 'Work' }), screen.getByRole('region', { name: 'Price' }),
      screen.getByRole('button', { name: 'Cost breakdown' }), screen.getByRole('button', { name: 'Margin history' }),
    ];
    order.reduce((before, next) => {
      expect(before.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return next;
    });
    expect(screen.queryByText('Full card')).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
  });

  it('form: the same order, the summary first, the foot last', async () => {
    await form('Green', GREEN());
    expect(sectionTitles()).toEqual(SECTIONS);
    const order = [
      summary(), screen.getByRole('region', { name: 'Product' }), screen.getByRole('region', { name: 'Price' }),
      screen.getByRole('button', { name: 'Cost breakdown' }), screen.getByRole('button', { name: 'Margin history' }),
    ];
    order.reduce((before, next) => {
      expect(before.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      return next;
    });
    expect(screen.queryByText('Full card')).not.toBeInTheDocument();
    expect(document.querySelector('details')).toBeNull();
  });

  it('has no «Calculated costs» box and no production-cost or food-cost box, in the read view or in the form', async () => {
    const { user } = await read('Green', GREEN());
    const gone = () => {
      expect(screen.queryByRole('region', { name: 'Calculated costs' })).not.toBeInTheDocument();
      expect(screen.queryByText('Calculated costs')).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Production cost' })).not.toBeInTheDocument();
      expect(screen.queryByRole('group', { name: 'Food cost' })).not.toBeInTheDocument();
    };
    gone();
    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' });
    gone();
  });

  it('names the ways of selling and the work as «How it is sold» and «Work»', async () => {
    await form('Green', GREEN());
    expect(screen.getByRole('combobox', { name: 'How it is sold' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Work' })).toBeInTheDocument();
    expect(screen.queryByText('Work time')).not.toBeInTheDocument();
  });

  it('says the same in Italian: «Come si vende» and «Lavoro»', async () => {
    renderFoodcost('/food-cost/product/Green', { source: GREEN(), ...ITALY });
    await screen.findByRole('button', { name: 'Modifica il prodotto' }, LOAD);
    expect(sectionTitles()).toEqual(['Prodotto', 'Composto da', 'Cottura', 'Imballaggio', 'Lavoro', 'Prezzo']);
    expect(within(screen.getByRole('region', { name: 'Prodotto' })).getByText('Come si vende', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dettaglio costi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Spiegazione: Lavoro' })).toBeInTheDocument();
  });
});

describe('the «?» of each section', () => {
  it.each(Object.keys(HELP))('«%s» opens its explanation under the title and closes it with the same tap — read view', async title => {
    const { user } = await read('Green', GREEN());
    const toggle = screen.getByRole('button', { name: `Explanation: ${title}` });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    const text = document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(text).not.toBeNull();
    expect(text).not.toBeVisible();
    expect(text.textContent).toMatch(READ_HELP[title] as RegExp);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(text).toBeVisible();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(text).not.toBeVisible();
  });

  it.each(Object.keys(HELP))('«%s» does the same in the form', async title => {
    const { user } = await form('Green', GREEN());
    const toggle = screen.getByRole('button', { name: `Explanation: ${title}` });
    const text = document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(text).not.toBeVisible();
    await user.click(toggle);
    expect(text).toBeVisible();
    expect(text.textContent).toMatch(HELP[title] as RegExp);
    await user.click(toggle);
    expect(text).not.toBeVisible();
  });

  it('opens one at a time on its own: the others stay shut', async () => {
    const { user } = await read('Green', GREEN());
    await user.click(screen.getByRole('button', { name: 'Explanation: Work' }));
    expect(screen.getByRole('button', { name: 'Explanation: Work' })).toHaveAttribute('aria-expanded', 'true');
    for (const other of ['Product', 'Made of', 'Baking', 'Packaging', 'Price']) {
      expect(screen.getByRole('button', { name: `Explanation: ${other}` })).toHaveAttribute('aria-expanded', 'false');
    }
  });

  it('works from the keyboard', async () => {
    const { user } = await read('Green', GREEN());
    screen.getByRole('button', { name: 'Explanation: Price' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Explanation: Price' })).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Explanation: Price' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('the summary says what its figures are per, by the way of selling', async () => {
    await read('Weighed', editorSource([product('Weighed', { sellingMode: 'weight', piecesPerBatch: null })]));
    const toggle = screen.getByRole('button', { name: 'Explanation: Summary per kg' });
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')?.textContent).toMatch(/^The figures are for 1 kg sold\./);
  });

  it('the explanations of the old notes live behind the «?» now: none of those sentences stays on the page', async () => {
    await form('Green', GREEN());
    for (const gone of [
      'The weight in one pack, or how many pieces.',
      'How many finished pieces one batch of the recipes above makes.',
      /^Boxes, bags, labels — how many for each piece/,
      /^The time it takes to make one batch, from weighing/,
      /^The share of the net price you want/,
      'The price on the label. The app takes the VAT off before working out the food cost.',
    ]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
  });
});

describe('the cost of a kilo, in the summary', () => {
  it('without a cooked weight: «1 kg costs (no oven loss)» and the cost of a kilo', async () => {
    await read('Green', GREEN());
    expect(within(summary()).getByText('1 kg costs (no oven loss)')).toBeInTheDocument();
    expect(within(summary()).getByText('1 kg costs (no oven loss)').closest('div')).toHaveTextContent('£2.00');
  });

  it('with a cooked weight: «1 kg cooked costs», the SAME figure as the «Baking» result line', async () => {
    await form('Loaf', LOAF());
    const row = within(summary()).getByText('1 kg cooked costs').closest('div') as HTMLElement;
    expect(row).toHaveTextContent('£2.27');
    // 880 g out of 1000 g: the line under the weights says the same figure.
    const baking = screen.getByRole('region', { name: 'Baking' });
    expect(within(baking).getByText('£2.27', { selector: 'strong' })).toBeInTheDocument();
  });

  it('is a dash while the cooked weight is heavier than the raw one (the red warning stays in sight)', async () => {
    await form('Loaf', LOAF({ cookedGrams: 1200 }));
    expect(within(summary()).getByText('1 kg cooked costs').closest('div')).toHaveTextContent('—');
    expect(screen.getByText('The cooked dough cannot weigh more than the raw dough.')).toBeVisible();
  });

});

describe('a cost with a line left out never looks complete', () => {
  it('says «more than» on the cost, the food cost, the ideal price and its net, the materials, the kilo and the whole batch — «less than» on the margin', async () => {
    const { user } = await read('Salty', SALTY());
    await user.click(detailsButton());
    expect(figure('Cost')).toHaveTextContent('more than £0.20');
    expect(figure('Food cost')).toHaveTextContent('more than 20.00% · target 25.00%');
    expect(figure('Ideal price')).toHaveTextContent('more than £0.96');
    expect(within(summary()).getByText('more than £0.80 without VAT, for a 25.00% food cost')).toBeInTheDocument();
    expect(figure('Raw materials')).toHaveTextContent('more than £0.20');
    expect(figure('Whole batch (10 pieces)')).toHaveTextContent('more than £2.00');
    expect(within(summary()).getByText('1 kg costs (no oven loss)').closest('div')).toHaveTextContent('more than £1.96');
    expect(figure(/^Margin/)).toHaveTextContent('less than £0.80');
  });

  it('counts the lines without a cost, with «Which?» under it, and the old long sentence is gone', async () => {
    await read('Salty', SALTY());
    expect(within(summary()).getByText('1 line has no cost: the real cost is higher.')).toBeInTheDocument();
    expect(within(summary()).getByRole('button', { name: 'Which?' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/so it really costs more than this/)).not.toBeInTheDocument();
  });

  it('says «2 lines» for two', async () => {
    await read('Salty', SALTY_WRAPPED());
    expect(within(summary()).getByText('2 lines have no cost: the real cost is higher.')).toBeInTheDocument();
  });

  it('says it in Italian: «1 riga senza costo» and «più di»', async () => {
    renderFoodcost('/food-cost/product/Salty', { source: SALTY(), ...ITALY });
    await screen.findByRole('button', { name: 'Modifica il prodotto' }, LOAD);
    expect(within(summary()).getByText('1 riga senza costo: il costo vero è più alto.')).toBeInTheDocument();
    expect(figure('Costo')).toHaveTextContent('più di 0,20 €');
    expect(figure(/^Margine/)).toHaveTextContent('meno di 0,80 €');
  });

  it('is the same in the phone’s preview dialog, which keeps its title and its checklist', async () => {
    const { user } = renderFoodcost('/food-cost', { source: SALTY_WRAPPED() });
    await user.click(await screen.findByRole('button', { name: /^Salty/ }, LOAD));
    const dialog = await screen.findByRole('dialog', { name: 'Salty' }, LOAD);
    expect(within(dialog).getByText('Summary per piece')).toBeInTheDocument();
    expect(figure('Cost', dialog)).toHaveTextContent('more than');
    expect(figure('Food cost', dialog)).toHaveTextContent('more than');
    expect(figure(/^Margin/, dialog)).toHaveTextContent('less than');
    expect(within(dialog).getByText('1 kg costs (no oven loss)').closest('div')).toHaveTextContent('more than');
    expect(within(dialog).getByText('2 lines have no cost: the real cost is higher.')).toBeInTheDocument();
    expect(within(dialog).getByText('Still missing:')).toBeInTheDocument();
    expect(within(dialog).getByText('Give every packaging item a price per piece')).toBeInTheDocument();
    // …and no «?»: the dialog is a glance, the explanations are the card’s.
    expect(within(dialog).queryByRole('button', { name: /^Explanation:/ })).not.toBeInTheDocument();
  });

  it('shows the kilo of a complete product in the dialog too', async () => {
    const { user } = renderFoodcost('/food-cost', { source: GREEN() });
    await user.click(await screen.findByRole('button', { name: /^Green/ }, LOAD));
    const dialog = await screen.findByRole('dialog', { name: 'Green' }, LOAD);
    expect(within(dialog).getByText('1 kg costs (no oven loss)').closest('div')).toHaveTextContent('£2.00');
    expect(within(dialog).queryByText(/line has no cost|lines have no cost/)).not.toBeInTheDocument();
  });
});

describe('«Still missing:» in the card', () => {
  it('is in the summary when the summary is drawn: a target is what a costed product may still lack', async () => {
    await read('Free', editorSource([product('Free', { foodCostTarget: null })]));
    const box = summary();
    expect(within(box).getByText('Still missing:')).toBeInTheDocument();
    expect(within(box).getByText('Enter a food cost target')).toBeInTheDocument();
  });

  it('is not there when nothing is missing', async () => {
    await read('Green', GREEN());
    expect(screen.queryByText('Still missing:')).not.toBeInTheDocument();
  });

  it('takes the summary’s place when nothing is costed: a small card with the same list, and the sections', async () => {
    await form('Bare', editorSource([bareProduct('Bare')]));
    expect(screen.queryByRole('group', { name: /^Summary/ })).not.toBeInTheDocument();
    const list = screen.getByText('Still missing:').parentElement as HTMLElement;
    expect(within(list).getByText('Add at least one recipe or ingredient to this product')).toBeInTheDocument();
    expect(within(list).getByText('Choose the VAT rate')).toBeInTheDocument();
    expect(sectionTitles()).toEqual(SECTIONS);
  });

  it('is in the read view too, after a save leaves nothing costed', async () => {
    const { user } = await form('Bare', editorSource([bareProduct('Bare')]));
    await user.type(screen.getByRole('combobox', { name: 'Name' }), '!');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', undefined, LOAD)).getByRole('button', { name: 'Save' }));
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(screen.getByText('Still missing:')).toBeInTheDocument();
    expect(sectionTitles()).toEqual(['Product', 'Made of', 'Packaging', 'Work', 'Price']);
  });
});

describe('«Details»', () => {
  it('is closed at mount and holds raw materials, packaging and the whole batch of a product sold by the piece', async () => {
    const { user } = await read('Boxed', editorSource([product('Boxed', { packaging: [{ ingredientId: 'box', qtyPcs: 2 }] })]));
    const button = detailsButton();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(figure('Raw materials')).not.toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(figure('Raw materials')).toHaveTextContent('£0.20');
    expect(figure('Packaging')).toHaveTextContent('£0.50');
    expect(figure('Whole batch (10 pieces)')).toHaveTextContent('£7.00');
    expect(figure('Price without VAT')).toHaveTextContent('£1.00');
  });

  it('says «Whole batch» alone for a product not sold by the piece', async () => {
    await read('Weighed', editorSource([product('Weighed', { sellingMode: 'weight', piecesPerBatch: null })]));
    expect(figure('Whole batch')).toHaveTextContent('£2.00');
    expect(within(summary()).queryByText(/pieces\)/)).not.toBeInTheDocument();
  });

  it('says «1 piece» for one', async () => {
    await read('One', editorSource([product('One', { piecesPerBatch: 1 })]));
    expect(figure('Whole batch (1 piece)')).toHaveTextContent('£2.00');
  });

  it('adds the labour row and the share the work takes, to whoever runs the place', async () => {
    await read('Worked', editorSource([product('Worked', { labourMinutes: 60, labourPeople: 1 })], { settings: { labourCostPerHour: 12 } }), { session: MANAGER });
    await vi.waitFor(() => { expect(figure('Labour')).toHaveTextContent('£1.20'); });
    expect(summary()).toHaveTextContent('Labour 120.00% · everything 140.00% of the net price');
    expect(figure('Cost')).toHaveTextContent('£1.40');
  });

  it('shows an employee no labour row and no labour share', async () => {
    await read('Worked', editorSource([product('Worked', { labourMinutes: 60, labourPeople: 1 })], { settings: { labourCostPerHour: 12 } }), { session: EMPLOYEE });
    expect(within(summary()).queryByText('Labour', { selector: 'dt' })).not.toBeInTheDocument();
    expect(summary()).not.toHaveTextContent('everything');
  });
});

describe('«Cost breakdown»', () => {
  it('is closed at mount, a real button with aria-expanded and aria-controls, and opens to the kilo line by line', async () => {
    const { user } = await read('Green', GREEN());
    const button = screen.getByRole('button', { name: 'Cost breakdown' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const body = document.getElementById(button.getAttribute('aria-controls') ?? '') as HTMLElement;
    expect(body).not.toBeVisible();
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(body).toBeVisible();
    expect(within(body).getByText('What 1 kg of product costs, line by line.')).toBeInTheDocument();
    expect(within(body).getByText('Total for 1 kg')).toBeInTheDocument();
    await user.click(button);
    expect(body).not.toBeVisible();
  });

  it('says «cooked» in its caption when a cooked weight is typed', async () => {
    const { user } = await read('Loaf', LOAF());
    await user.click(screen.getByRole('button', { name: 'Cost breakdown' }));
    expect(screen.getByText('What 1 kg of cooked product costs, line by line.')).toBeVisible();
  });

  it('opens from the keyboard too', async () => {
    const { user } = await read('Green', GREEN());
    screen.getByRole('button', { name: 'Cost breakdown' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Cost breakdown' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('what asks to be done stays in sight, never behind a «?»', () => {
  it('a line without a cost: the count and «Which?»', async () => {
    await read('Salty', SALTY());
    expect(within(summary()).getByText('1 line has no cost: the real cost is higher.')).toBeVisible();
    expect(within(summary()).getByRole('button', { name: 'Which?' })).toBeVisible();
  });

  it('a cooked weight heavier than the raw one: the red warning, in the form and in the read view', async () => {
    const { user } = await read('Loaf', LOAF({ cookedGrams: 1200 }));
    expect(screen.getByText('The cooked dough cannot weigh more than the raw dough.')).toBeVisible();
    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' });
    expect(screen.getByText('The cooked dough cannot weigh more than the raw dough.')).toBeVisible();
  });

  it('a recipe that loses weight with no cooked weight: the hint to weigh it', async () => {
    await form('Loaf', editorSource(
      [product('Loaf', { components: [{ recipeId: 'Dough', qtyKg: 1 }], model: 3 })],
      { recipes: [recipe('Dough', { lossPct: 12 })] },
    ));
    expect(screen.getByText(/loses 12\.00% in the oven: weigh the cooked dough\./)).toBeVisible();
  });

  it('an item that no longer exists', async () => {
    await read('Gone', editorSource([product('Gone', { components: [FLOUR_LINE, GHOST_LINE] })]));
    expect(screen.getByText('This item no longer exists', { selector: 'dd' })).toBeVisible();
  });

  it('the hourly cost not set, to whoever can set it', async () => {
    await form('Worked', editorSource([product('Worked', { labourMinutes: 30, labourPeople: 1 })], { settings: null }), { session: MANAGER });
    expect(await screen.findByText('Set the hourly labour cost in Settings to see what the work costs.')).toBeVisible();
  });
});
