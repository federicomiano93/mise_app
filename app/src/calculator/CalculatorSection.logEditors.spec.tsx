import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { NOW, logOf, sheetOf, versionOf } from '../testing/logFixtures';
import { BRIOCHE, FOCACCIA, LOAD, SOURDOUGH, configOf, renderCalculator } from '../testing/renderCalculator';
import { ACTION_EVENT } from '../telemetry/usage';

// Add dough and Edit dough (step 3c-3, slice C2): a working copy, Save that waits, the question, the new log or the
// new version, and the way out — back to the list, back to the log — with the discard question on the way.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const COMBO = {
  id: 'combo', name: 'Combo', logic: 'traysTotal', order: 4, visible: true, trayWeight: 1000,
  ingredients: [{ key: 'flour', label: 'Flour', grams: 600 }, { key: 'water', label: 'Water', grams: 400 }],
};
const LINKED = { ...BRIOCHE, id: 'linked', name: 'Linked', catalogueId: 'cat-1', ingredients: [], order: 5 };

const config = (over: Record<string, unknown> = {}) =>
  configOf({ logRetentionHours: 24, recipes: [FOCACCIA, BRIOCHE, SOURDOUGH, COMBO], ...over });

const main = () => within(screen.getByRole('main'));
// ⚠️ jsdom applies no media query, so the list stays in the page behind the editor: the editor's own Back and Save are
// the LAST ones in the page.
const back = () => main().getAllByRole('button', { name: 'Back' }).at(-1)!;
const save = () => main().getAllByRole('button', { name: 'Save' }).at(-1)!;
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);

type View = Awaited<ReturnType<typeof open>>;

async function open(path: string, { logs = [] as ({ id: string } & Record<string, unknown>)[], lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config: config(), logs }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  await waitFor(() => { expect(main().queryByText(/^(Loading…|Caricamento…)$/)).toBeNull(); }, LOAD);
  return { ...view, source };
}

async function answer(view: View, asked: string | RegExp, button: string) {
  await view.user.click(within(await question(asked)).getByRole('button', { name: button }));
}

const choice = (name: string) => main().getByRole('button', { name });
const region = (name: string) => main().getByRole('region', { name });

describe('Add dough', () => {
  it('starts empty: every recipe to pick from, Save waiting, nothing else asked yet', async () => {
    const view = await open('/calculator/log/new');
    expect(main().getAllByRole('heading', { level: 2, name: 'Add dough' }).length).toBeGreaterThan(0);
    expect(main().getByText('Recipe')).toBeInTheDocument();
    for (const name of ['Focaccia', 'Brioche', 'Sourdough', 'Combo']) expect(choice(name)).toHaveAttribute('aria-pressed', 'false');
    expect(main().getByText('Pick a recipe to enter quantities.')).toBeInTheDocument();
    expect(save()).toBeDisabled();
    expect(main().queryByRole('button', { name: 'Today' })).not.toBeInTheDocument();
    expect(isBusy()).toBe(false);
    expect(view.source.saved).toEqual([]);
  });

  it('says there are no recipes when there are none', async () => {
    await open('/calculator/log/new', { source: fakeCalculatorSource({ config: config({ recipes: [] }) }) });
    expect(await main().findByText('No recipes yet. Add one in Settings → Recipes.', undefined, LOAD)).toBeInTheDocument();
  });

  it('shows a recipe picked as a pressed button, enables Save and asks for the day', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Focaccia'));
    expect(choice('Focaccia')).toHaveAttribute('aria-pressed', 'true');
    expect(choice('Brioche')).toHaveAttribute('aria-pressed', 'false');
    expect(save()).toBeEnabled();
    expect(main().getByText('When is this dough for?')).toBeInTheDocument();
    expect(choice('Today')).toHaveAttribute('aria-pressed', 'false');
    expect(choice('Tomorrow')).toHaveAttribute('aria-pressed', 'false');
    expect(isBusy()).toBe(true);
  });

  it('draws the quantities of an orders recipe by client, every product at zero', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Focaccia'));
    const roma = within(region('Cafe Roma'));
    expect(roma.getByLabelText('Focaccia tray (500g)')).toHaveValue(0);
    expect(roma.getByRole('combobox', { name: /Focaccia slab/ })).toHaveValue('0');
    expect(roma.queryByText(/Paused loaf/)).not.toBeInTheDocument();
    const sole = within(region('Bar Sole'));
    expect(sole.getByLabelText('Focaccia tray (500g)')).toHaveValue(0);
    const kilos = sole.getByLabelText('Cheese by the kilo');
    expect(kilos).toHaveValue(0);
    expect(kilos).toHaveAttribute('step', '0.5');
    expect(kilos).toHaveAttribute('inputmode', 'decimal');
    expect(sole.getByText('kg')).toBeInTheDocument();
    // Nothing for the other logics.
    expect(main().queryByLabelText('Total dough (g)')).not.toBeInTheDocument();
    expect(main().queryByLabelText('Number of trays')).not.toBeInTheDocument();
  });

  it('asks for the total on a total recipe, and for trays (with the grams they make) on a trays recipe', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Brioche'));
    expect(main().getByLabelText('Total dough (g)')).toHaveValue(0);
    expect(main().queryByRole('region', { name: 'Cafe Roma' })).not.toBeInTheDocument();

    await view.user.click(choice('Sourdough'));
    expect(main().queryByLabelText('Total dough (g)')).not.toBeInTheDocument();
    const trays = main().getByLabelText('Number of trays');
    expect(main().getByText('= 0 g')).toBeInTheDocument();
    await view.user.click(trays);
    await view.user.keyboard('3');
    expect(main().getByText('= 3,600 g')).toBeInTheDocument();
    expect(trays).toHaveAccessibleDescription('= 3,600 g');

    await view.user.click(choice('Combo'));
    expect(main().getByLabelText('Number of trays')).toHaveValue(0);
    expect(main().getByLabelText('Total dough (g)')).toHaveValue(0);
  });

  it('settles a fraction of trays to the whole number it used', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Sourdough'));
    const trays = main().getByLabelText('Number of trays');
    await view.user.click(trays);
    await view.user.keyboard('2.5');
    await view.user.tab();
    expect(trays).toHaveValue(2);
    expect(main().getByText('= 2,400 g')).toBeInTheDocument();
  });

  it('starts over when another recipe is picked', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Focaccia'));
    await view.user.click(within(region('Cafe Roma')).getByLabelText('Focaccia tray (500g)'));
    await view.user.keyboard('7');
    await view.user.click(choice('Brioche'));
    await view.user.click(choice('Focaccia'));
    expect(within(region('Cafe Roma')).getByLabelText('Focaccia tray (500g)')).toHaveValue(0);
  });

  it('without a day: says so above the two buttons, marks them, focuses the first, and writes nothing', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Focaccia'));
    await view.user.click(save());
    const alert = await main().findByRole('alert');
    expect(alert).toHaveTextContent('Choose Today or Tomorrow first.');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(choice('Today')).toHaveFocus();
    expect(choice('Today').closest('[role="group"]')?.className).toMatch(/missing/);
    expect(view.source.saved).toEqual([]);
    expect(pathOf(view)).toBe('/calculator/log/new');
    // Choosing a day takes the marks away.
    await view.user.click(choice('Tomorrow'));
    expect(main().queryByRole('alert')).not.toBeInTheDocument();
    expect(choice('Today').closest('[role="group"]')?.className).not.toMatch(/missing/);
  });

  it('asks, then writes a NEW manual log with the recipe\'s own leavening, announces it and returns to the list', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listen);
    try {
      const view = await open('/calculator/log');
      await view.user.click(await main().findByRole('button', { name: 'Add dough' }, LOAD));
      await view.user.click(choice('Focaccia'));
      await view.user.click(choice('Tomorrow'));
      await view.user.click(within(region('Cafe Roma')).getByLabelText('Focaccia tray (500g)'));
      await view.user.keyboard('4');
      await view.user.click(save());
      await answer(view, 'Save this dough?', 'Save');

      await waitFor(() => { expect(view.source.saved).toHaveLength(1); });
      const saved = view.source.saved[0] as unknown as {
        dough: string; recipeId: string; forDay: string; origin: string;
        versions: { kind: string; calculatedBy: string; items: { clientName: string; qty: number }[]; sheet: { total_g: number; param: { value: number } } }[];
      };
      expect(saved).toMatchObject({ dough: 'Focaccia', recipeId: 'focaccia', forDay: 'tomorrow', origin: 'manual' });
      expect(saved.versions).toHaveLength(1);
      expect(saved.versions[0]).toMatchObject({ kind: 'create', calculatedBy: '' });
      expect(saved.versions[0]?.sheet.param.value).toBe(0.5);
      expect(saved.versions[0]?.items.find(line => line.clientName === 'Cafe Roma' && line.qty === 4)).toBeDefined();
      expect(saved.versions[0]?.items.filter(line => line.qty > 0)).toHaveLength(1);
      expect(actions).toContain('log-added');

      await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
      await waitFor(() => { expect(main().getByRole('button', { name: 'Add dough' })).toHaveFocus(); });
      expect(await main().findByRole('button', { name: 'Focaccia' }, LOAD)).toBeInTheDocument();
      expect(isBusy()).toBe(false);
    } finally {
      window.removeEventListener(ACTION_EVENT, listen);
    }
  });

  it('saves a total recipe with the typed total', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Brioche'));
    await view.user.click(choice('Today'));
    await view.user.click(main().getByLabelText('Total dough (g)'));
    await view.user.keyboard('1200');
    await view.user.click(save());
    await answer(view, 'Save this dough?', 'Save');
    await waitFor(() => { expect(view.source.saved).toHaveLength(1); });
    const saved = view.source.saved[0] as unknown as { versions: { sheet: { total_g: number } }[] };
    expect(saved.versions[0]?.sheet.total_g).toBe(1200);
  });

  it('keeps everything when the question is answered no', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Brioche'));
    await view.user.click(choice('Today'));
    await view.user.click(save());
    await answer(view, 'Save this dough?', 'Cancel');
    expect(view.source.saved).toEqual([]);
    expect(pathOf(view)).toBe('/calculator/log/new');
    expect(save()).toBeEnabled();
  });

  it('refuses a linked recipe with a row that has no weight, with the Calculator\'s sentence, and writes nothing', async () => {
    const source = fakeCalculatorSource({
      config: config({ recipes: [LINKED] }),
      recipes: [{ id: 'cat-1', name: 'C', ingredients: [{ rid: 'r', label: 'Pinch', grams: 0, unit: 'pinch' }] }],
    });
    const view = await open('/calculator/log/new', { source });
    await view.user.click(choice('Linked'));
    await view.user.click(choice('Today'));
    await view.user.click(save());
    await answer(view, 'Save this dough?', 'Save');
    const refusal = await screen.findByRole('alertdialog', { name: /“Pinch” has no weight/ }, LOAD);
    expect(source.saved).toEqual([]);
    await view.user.click(within(refusal).getByRole('button', { name: 'OK' }));
    expect(pathOf(view)).toBe('/calculator/log/new');
    expect(save()).toBeEnabled();
  });

  it('refuses a linked recipe that is gone, saying so', async () => {
    const source = fakeCalculatorSource({ config: config({ recipes: [LINKED] }), recipes: [] });
    const view = await open('/calculator/log/new', { source });
    await view.user.click(choice('Linked'));
    await view.user.click(choice('Today'));
    await view.user.click(save());
    await answer(view, 'Save this dough?', 'Save');
    expect(await screen.findByRole('alertdialog', { name: /cannot be read from the catalogue right now/ }, LOAD)).toBeInTheDocument();
    expect(source.saved).toEqual([]);
  });

  it('Back with nothing chosen leaves without a question', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(back());
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('Back with a recipe picked asks, and Cancel keeps the screen as it is', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Focaccia'));
    await view.user.click(back());
    await answer(view, 'You have unsaved changes. Leave without saving? Your changes will be lost.', 'Cancel');
    expect(pathOf(view)).toBe('/calculator/log/new');
    expect(choice('Focaccia')).toHaveAttribute('aria-pressed', 'true');
  });

  it('Back with a recipe picked asks, and Discard leaves without writing', async () => {
    const view = await open('/calculator/log/new');
    await view.user.click(choice('Focaccia'));
    await view.user.click(back());
    await answer(view, 'You have unsaved changes. Leave without saving? Your changes will be lost.', 'Discard');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log'); });
    expect(view.source.saved).toEqual([]);
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('is the same in Italian', async () => {
    const view = await open('/calculator/log/new', { lang: 'it' });
    expect(main().getAllByRole('heading', { level: 2, name: 'Aggiungi impasto' }).length).toBeGreaterThan(0);
    await view.user.click(choice('Focaccia'));
    expect(main().getByText('Per quando è questo impasto?')).toBeInTheDocument();
    await view.user.click(main().getAllByRole('button', { name: 'Salva' }).at(-1)!);
    expect(await main().findByRole('alert')).toHaveTextContent('Scegli prima Oggi o Domani.');
    await view.user.click(choice('Oggi'));
    await view.user.click(main().getAllByRole('button', { name: 'Salva' }).at(-1)!);
    expect(await screen.findByRole('alertdialog', { name: 'Vuoi salvare questo impasto?' }, LOAD)).toBeInTheDocument();
  });
});

describe('Edit dough', () => {
  const hand = (over: Record<string, unknown> = {}) => logOf('hand', { origin: 'manual', dough: 'Focaccia by hand', ...over });
  const OLD_LINE = { id: 'gone', name: 'Old loaf', clientName: 'Cafe Roma', qty: 2, weightG: 400, kind: 'number', crate: { show: false, perBox: 20 } };
  const TRAY_LINE = { id: 'tray', name: 'Focaccia tray', clientName: 'Cafe Roma', qty: 4, weightG: 500, kind: 'number', crate: { show: false, perBox: 20 } };
  const withLines = hand({ versions: [versionOf({ items: [TRAY_LINE, OLD_LINE], calculatedBy: 'Marco' })] });

  it('has no screen for a log the calculator made: its address shows the log', async () => {
    const view = await open('/calculator/log/calc/edit', { logs: [logOf('calc')] });
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log/calc'); });
    expect(await main().findByRole('button', { name: 'History' }, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('says «Dough not found.» for a log that is not there', async () => {
    await open('/calculator/log/nope/edit');
    expect(await main().findByText('Dough not found.', undefined, LOAD)).toBeInTheDocument();
  });

  it('opens from the log with no question, on a copy: the name, the author, the saved rows first and Save waiting', async () => {
    const view = await open('/calculator/log/hand', { logs: [withLines] });
    await view.user.click(await main().findByRole('button', { name: 'Edit' }, LOAD));
    expect(pathOf(view)).toBe('/calculator/log/hand/edit');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(await main().findByRole('heading', { level: 3, name: 'Focaccia by hand' }, LOAD)).toBeInTheDocument();
    expect(main().getByLabelText('Calculated by')).toHaveValue('Marco');
    expect(main().getByLabelText('Calculated by')).toHaveAttribute('placeholder', 'Name (optional)');
    const roma = within(region('Cafe Roma'));
    expect(roma.getByLabelText('Focaccia tray (500g)')).toHaveValue(4);
    // A product that is no longer in the address book keeps its saved line.
    expect(roma.getByLabelText('Old loaf (400g)')).toHaveValue(2);
    // Products added to the client since come after, at zero.
    expect(roma.getByRole('combobox', { name: /Focaccia slab/ })).toHaveValue('0');
    expect(save()).toBeDisabled();
    expect(isBusy()).toBe(false);
  });

  it('enables Save on a change, disables it when the change is put back, and holds the busy marker meanwhile', async () => {
    const view = await open('/calculator/log/hand/edit', { logs: [withLines] });
    const box = await within(await main().findByRole('region', { name: 'Cafe Roma' }, LOAD)).findByLabelText('Focaccia tray (500g)');
    await view.user.clear(box);
    await view.user.keyboard('5');
    expect(save()).toBeEnabled();
    expect(isBusy()).toBe(true);
    await view.user.clear(box);
    await view.user.keyboard('4');
    expect(box).toHaveValue(4);
    expect(save()).toBeDisabled();
    expect(isBusy()).toBe(false);
  });

  it('asks, then appends an `edit` version that keeps the leavening and the old line, announces it and goes back to the log', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listen);
    try {
      const view = await open('/calculator/log/hand', { logs: [withLines] });
      await view.user.click(await main().findByRole('button', { name: 'Edit' }, LOAD));
      const box = within(await main().findByRole('region', { name: 'Cafe Roma' }, LOAD)).getByLabelText('Focaccia tray (500g)');
      await view.user.click(box);
      await view.user.keyboard('6');
      await view.user.type(main().getByLabelText('Calculated by'), '{Control>}a{/Control}  Anna ');
      await view.user.click(save());
      await answer(view, 'Save these changes as a new version?', 'Save');

      await waitFor(() => { expect(view.source.saved).toHaveLength(1); });
      const saved = view.source.saved[0] as unknown as {
        versions: { kind: string; calculatedBy: string; items: { id: string; qty: number }[]; sheet: { param: { value: number } | null } }[];
      };
      expect(saved.versions).toHaveLength(2);
      expect(saved.versions[1]).toMatchObject({ kind: 'edit', calculatedBy: 'Anna' });
      expect(saved.versions[1]?.items.find(line => line.id === 'tray')?.qty).toBe(6);
      expect(saved.versions[1]?.items.find(line => line.id === 'gone')?.qty).toBe(2);
      expect(actions).toContain('log-edited');

      await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log/hand'); });
      await waitFor(() => { expect(main().getByRole('button', { name: 'Edit' })).toHaveFocus(); });
      expect(isBusy()).toBe(false);
    } finally {
      window.removeEventListener(ACTION_EVENT, listen);
    }
  });

  it('asks before leaving with edits, and Cancel keeps them', async () => {
    const view = await open('/calculator/log/hand/edit', { logs: [withLines] });
    await view.user.type(await main().findByLabelText('Calculated by', undefined, LOAD), '!');
    await view.user.click(back());
    await answer(view, 'You have unsaved changes. Leave without saving? Your changes will be lost.', 'Cancel');
    expect(pathOf(view)).toBe('/calculator/log/hand/edit');
    expect(main().getByLabelText('Calculated by')).toHaveValue('Marco!');
  });

  it('Discard leaves to the log without writing', async () => {
    const view = await open('/calculator/log/hand/edit', { logs: [withLines] });
    await view.user.type(await main().findByLabelText('Calculated by', undefined, LOAD), '!');
    await view.user.click(back());
    await answer(view, 'You have unsaved changes. Leave without saving? Your changes will be lost.', 'Discard');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/log/hand'); });
    expect(view.source.saved).toEqual([]);
  });

  it('says the log is gone, rather than saving, when it is deleted elsewhere while open', async () => {
    const view = await open('/calculator/log/hand/edit', { logs: [withLines] });
    await view.user.type(await main().findByLabelText('Calculated by', undefined, LOAD), '!');
    view.source.logs.delete('hand');
    view.source.push();
    expect(await main().findByText('Dough not found.', undefined, LOAD)).toBeInTheDocument();
    expect(view.source.saved).toEqual([]);
  });

  describe('a trays dough', () => {
    // Made with a tray of 800 g, though the recipe now says 1000: the edit counts at 800.
    const FROZEN = { id: 'combo', name: 'Combo', logic: 'traysTotal', trayWeight: 800, ingredients: COMBO.ingredients };
    const trays = hand({
      dough: 'Combo', recipeId: 'combo',
      versions: [versionOf({
        items: [], recipe: FROZEN,
        sheet: sheetOf('Combo', { recipeId: 'combo', trays: 2, trayWeight_g: 800, total_g: 2100, ingredients: [{ name: 'Flour', grams: 2100 }] }),
      })],
    });

    it('edits the trays and the grams on top, at the tray weight the dough was made with, with no quantity rows', async () => {
      const view = await open('/calculator/log/hand/edit', { logs: [trays] });
      const boxes = await main().findByLabelText('Number of trays', undefined, LOAD);
      expect(boxes).toHaveValue(2);
      expect(main().getByText('= 1,600 g')).toBeInTheDocument();
      expect(main().getByLabelText('Total dough (g)')).toHaveValue(500);
      expect(main().queryByRole('region', { name: 'Cafe Roma' })).not.toBeInTheDocument();
      expect(main().queryByText('Products — quantities only')).not.toBeInTheDocument();

      await view.user.click(boxes);
      await view.user.keyboard('3');
      expect(main().getByText('= 2,400 g')).toBeInTheDocument();
      await view.user.click(save());
      await answer(view, 'Save these changes as a new version?', 'Save');
      await waitFor(() => { expect(view.source.saved).toHaveLength(1); });
      const saved = view.source.saved[0] as unknown as { versions: { kind: string; sheet: { trays: number; trayWeight_g: number; total_g: number } }[] };
      expect(saved.versions[1]).toMatchObject({ kind: 'edit' });
      expect(saved.versions[1]?.sheet).toMatchObject({ trays: 3, trayWeight_g: 800, total_g: 2900 });
    });
  });

  it('stays on the screen, edits kept, when the log is full — the store says why', async () => {
    const full = hand({ versions: Array.from({ length: 100 }, (_, i) => versionOf({ kind: i === 0 ? 'create' : 'edit' })) });
    const view = await open('/calculator/log/hand/edit', { logs: [full] });
    await view.user.type(await main().findByLabelText('Calculated by', undefined, LOAD), 'Anna');
    await view.user.click(save());
    await answer(view, 'Save these changes as a new version?', 'Save');
    expect(await screen.findByText('Focaccia by hand’s log is full: no more changes can be saved to it.', undefined, LOAD)).toBeInTheDocument();
    expect(view.source.saved).toEqual([]);
    expect(pathOf(view)).toBe('/calculator/log/hand/edit');
    expect(main().getByLabelText('Calculated by')).toHaveValue('Anna');
  });

  it('is the same in Italian', async () => {
    const view = await open('/calculator/log/hand/edit', { logs: [withLines], lang: 'it' });
    expect(await main().findByLabelText('Calcolato da', undefined, LOAD)).toHaveValue('Marco');
    expect(main().getByLabelText('Calcolato da')).toHaveAttribute('placeholder', 'Nome (facoltativo)');
    expect(main().getByText('Prodotti — solo quantità')).toBeInTheDocument();
    await view.user.type(main().getByLabelText('Calcolato da'), '!');
    await view.user.click(main().getAllByRole('button', { name: 'Salva' }).at(-1)!);
    expect(await screen.findByRole('alertdialog', { name: 'Vuoi salvare queste modifiche come nuova versione?' }, LOAD)).toBeInTheDocument();
  });

  it('says there are no products when a dough has none', async () => {
    const empty = hand({ recipeId: 'brioche', dough: 'Brioche', versions: [versionOf({ items: [], sheet: sheetOf('Brioche', { recipeId: 'brioche' }) })] });
    await open('/calculator/log/hand/edit', { logs: [empty], source: fakeCalculatorSource({ config: config({ clients: [] }), logs: [empty] }) });
    expect(await main().findByText('No products in this dough.', undefined, LOAD)).toBeInTheDocument();
  });
});
