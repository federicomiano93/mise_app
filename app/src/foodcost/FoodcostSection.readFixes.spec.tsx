import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { FROM_RECIPE_LINK } from '@mise/shared/recipe-link';
import { editorSource, recipe } from '../testing/foodcostEditorFixtures';
import { entriesBehind } from '../testing/recipeLinkHelpers';
import { bareProduct, LOAD, product, renderFoodcost, split } from '../testing/renderFoodcost';

// Four findings of the review of the read-first card (item 25 of docs/mise2-port-owed.md): a saved product keeps the recipe it
// came from, a refused first save is not «Product deleted.», the scroll starts at the top when read and form switch, and the box
// opens when the summary goes. Each spec fails without its fix.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const pencil = () => screen.getByRole('button', { name: 'Edit product' });
const saveBar = () => screen.getByRole('button', { name: 'Save' });
const where = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

async function confirmSave(user: { click: (el: Element) => Promise<void> }) {
  const asked = await screen.findByRole('alertdialog', undefined, LOAD);
  await user.click(within(asked).getByRole('button', { name: 'Save' }));
}

// The history the recipe's button leaves behind: the recipe, then the entry carrying the marker.
const fromRecipe = () => [
  '/recipes/dough',
  { pathname: '/food-cost', search: '?recipe=dough', state: FROM_RECIPE_LINK },
];

describe('a new product made from a recipe remembers the recipe once saved', () => {
  it('Save lands on the product with the recipe in its address; Back goes to the recipe in one step', async () => {
    const { router, user } = renderFoodcost('/food-cost', {
      entries: fromRecipe(),
      source: editorSource([product('Tart')], { recipes: [recipe('dough', { name: 'Dough' })] }),
    });
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(where(router)).toBe('/food-cost/product/fake-1?recipe=dough');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(where(router)).toBe('/recipes/dough'); });
    expect(await entriesBehind(router)).toBe(0);
  });
});

describe('a first save the database refuses', () => {
  const NOT_SAVED = 'Couldn’t save “Cornetto” — check your connection.';
  const denied = () => Object.assign(new Error('permission-denied'), { code: 'permission-denied' });

  // The refusal comes `late` (after the product is drawn, as the server's answer does) or at once (before it was ever drawn).
  async function saveNew(fake: ReturnType<typeof editorSource>, { late, streamFirst }: { late: boolean; streamFirst: boolean }) {
    let refuse: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { refuse = resolve; });
    vi.mocked(fake.saveProduct).mockImplementationOnce(async () => {
      if (late) await gate;
      if (streamFirst) fake.push();
      throw denied();
    });
    const { router, user } = renderFoodcost('/food-cost/new', { source: fake });
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), 'Cornetto');
    await user.click(saveBar());
    await confirmSave(user);
    if (late) {
      await screen.findByRole('button', { name: 'Edit product' }, LOAD);
      await act(async () => { refuse(); await gate; });
    }
    return router;
  }

  for (const late of [true, false]) {
    const when = late ? 'after its read view was drawn' : 'before its read view was drawn';
    it(`with the stream live, ${when}: the message is «not saved», never «Product deleted.», and the list is shown`, async () => {
      const router = await saveNew(editorSource([]), { late, streamFirst: true });
      expect(await screen.findByText(NOT_SAVED, undefined, LOAD)).toBeInTheDocument();
      await waitFor(() => { expect(where(router)).toBe('/food-cost'); });
      expect(screen.queryByText('Product deleted.')).not.toBeInTheDocument();
    });

    it(`with no live stream (the store rolls it back itself), ${when}: the same`, async () => {
      const fake = editorSource([]);
      fake.hold();
      const router = await saveNew(fake, { late, streamFirst: false });
      expect(await screen.findByText(NOT_SAVED, undefined, LOAD)).toBeInTheDocument();
      await waitFor(() => { expect(where(router)).toBe('/food-cost'); });
      expect(screen.queryByText('Product deleted.')).not.toBeInTheDocument();
    });
  }

  it('a new product saved fine and deleted elsewhere afterwards is announced (a settled save hides nothing)', async () => {
    const fake = editorSource([]);
    const { router, user } = renderFoodcost('/food-cost/new', { source: fake });
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), 'Cornetto');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    await act(async () => { fake.products.delete('fake-1'); fake.push(); });
    expect(await screen.findByText('Product deleted.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(where(router)).toBe('/food-cost'); });
  });

  it('a stale snapshot lacking a first save still in the air does not bounce the person: the product comes back', async () => {
    const fake = editorSource([]);
    let finish: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    vi.mocked(fake.saveProduct).mockImplementationOnce(async (id, data) => {
      await gate;
      fake.products.set(id, { ...data, id });
      fake.push();
    });
    const { router, user } = renderFoodcost('/food-cost/new', { source: fake });
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), 'Cornetto');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    // A snapshot queued before the write: it lacks the product.
    await act(async () => { fake.push(); });
    expect(where(router)).toBe('/food-cost/product/fake-1');
    expect(screen.queryByText('Product deleted.')).not.toBeInTheDocument();
    await act(async () => { finish(); await gate; });
    expect(await screen.findByRole('button', { name: 'Edit product' }, LOAD)).toBeInTheDocument();
    expect(where(router)).toBe('/food-cost/product/fake-1');
  });

  it("a new product's first save refused while its FORM is open says «not saved», not «Product deleted.»", async () => {
    const fake = editorSource([]);
    let refuse: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { refuse = resolve; });
    vi.mocked(fake.saveProduct).mockImplementationOnce(async () => {
      await gate;
      fake.push();
      throw Object.assign(new Error('permission-denied'), { code: 'permission-denied' });
    });
    const { router, user } = renderFoodcost('/food-cost/new', { source: fake });
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), 'Cornetto');
    await user.click(saveBar());
    await confirmSave(user);
    await user.click(await screen.findByRole('button', { name: 'Edit product' }, LOAD));
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    await act(async () => { refuse(); await gate; });
    expect(await screen.findByText('Couldn’t save “Cornetto” — check your connection.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(where(router)).toBe('/food-cost'); });
    expect(screen.queryByText('Product deleted.')).not.toBeInTheDocument();
  });

  it('a product saved with nothing costed is read only once: New then its row again on the split opens it to its form', async () => {
    split();
    const { user } = renderFoodcost('/food-cost', { source: editorSource([bareProduct('Bare'), product('Green')]) });
    await user.click(await screen.findByRole('button', { name: /^Bare/ }, LOAD));
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    await user.click(screen.getByRole('button', { name: /New product/ }));
    await screen.findByRole('heading', { level: 2, name: 'New product' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Bare!/ }));
    expect(await screen.findByRole('combobox', { name: 'Name' }, LOAD)).toHaveValue('Bare!');
  });

  it('a product really deleted elsewhere is still announced', async () => {
    const fake = editorSource([product('Green')]);
    const { router } = renderFoodcost('/food-cost/product/Green', { source: fake });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    await act(async () => { fake.products.delete('Green'); fake.push(); });
    expect(await screen.findByText('Product deleted.', undefined, LOAD)).toBeInTheDocument();
    await waitFor(() => { expect(where(router)).toBe('/food-cost'); });
  });
});

describe('read and form start at the top', () => {
  const planted = (element: HTMLElement, top: number) => {
    Object.defineProperty(element, 'scrollTop', { value: top, writable: true });
    return element;
  };

  it('on a phone: the pencil, Save and Back to read each put the page at the top', async () => {
    const { user } = renderFoodcost('/food-cost/product/Green', { source: editorSource([product('Green')]) });
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    const main = planted(screen.getByRole('main'), 600);

    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    expect(main.scrollTop).toBe(0);

    main.scrollTop = 600;
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(main.scrollTop).toBe(0);

    await user.click(pencil());
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), '!');
    main.scrollTop = 600;
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    expect(main.scrollTop).toBe(0);
  });

  it('on the split: the right-hand side goes to the top and the list keeps its place', async () => {
    split();
    const { user } = renderFoodcost('/food-cost', { source: editorSource([product('Green'), product('Red')]) });
    await user.click(await screen.findByRole('button', { name: /^Green/ }, LOAD));
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);
    const detail = planted(screen.getByRole('region', { name: 'Green' }).closest('[data-view] > *') as HTMLElement, 400);
    const main = planted(screen.getByRole('main'), 900);

    await user.click(pencil());
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    expect(detail.scrollTop).toBe(0);
    expect(main.scrollTop).toBe(900);
  });
});

describe('the summary when the product stops being costed while it is read', () => {
  it('gives way to what is still missing, and comes back with the same «Details» state', async () => {
    const fake = editorSource([product('Green')]);
    const { user } = renderFoodcost('/food-cost/product/Green', { source: fake });
    await screen.findByRole('group', { name: 'Summary per piece' }, LOAD);
    expect(screen.queryByText('Still missing:')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Details' }));

    // The price of the flour goes: nothing can be costed, the summary goes, the checklist takes its place — the sections stay.
    await act(async () => { fake.prices.clear(); fake.push(); });
    await waitFor(() => { expect(screen.queryByRole('group', { name: 'Summary per piece' })).not.toBeInTheDocument(); });
    expect(screen.getByText('Still missing:')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Made of' })).toBeInTheDocument();

    // The price comes back: the summary again, «Details» still open.
    await act(async () => { fake.prices.set('flour', { priceUnit: 'kg', pricePerUnit: 2 }); fake.push(); });
    await screen.findByRole('group', { name: 'Summary per piece' }, LOAD);
    expect(screen.getByRole('button', { name: 'Details' })).toHaveAttribute('aria-expanded', 'true');
  });
});

describe('a product saved with nothing costed is read only once', () => {
  it('on the split, picking another product and coming back opens it to the form again', async () => {
    split();
    const { user } = renderFoodcost('/food-cost', { source: editorSource([bareProduct('Bare'), product('Green')]) });
    await user.click(await screen.findByRole('button', { name: /^Bare/ }, LOAD));
    await user.type(await screen.findByRole('combobox', { name: 'Name' }, LOAD), '!');
    await user.click(saveBar());
    await confirmSave(user);
    await screen.findByRole('button', { name: 'Edit product' }, LOAD);

    await user.click(screen.getByRole('button', { name: /^Green/ }));
    await screen.findByRole('region', { name: 'Green' }, LOAD);
    await user.click(screen.getByRole('button', { name: /^Bare!/ }));
    expect(await screen.findByRole('combobox', { name: 'Name' }, LOAD)).toHaveValue('Bare!');
  });
});
