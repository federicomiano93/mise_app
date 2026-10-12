import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The three editing screens of Settings — Extra dough, Divisor, Dough history — and the way they all save: a
// working copy, Save disabled until something changed, a question, then ONE transaction through the store; a
// refused save leaves the screen as it was; leaving with edits asks.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const saveButton = () => main().getByRole('button', { name: 'Save' });
const question = (name: string | RegExp) => screen.findByRole('alertdialog', { name }, LOAD);
const pathOf = (view: { router: { state: { location: { pathname: string } } } }) => view.router.state.location.pathname;

async function open(path: string, { config = configOf(), lang = 'en' as 'en' | 'it', source = fakeCalculatorSource({ config }) } = {}) {
  const view = renderCalculator(path, { source, lang });
  await main().findByRole('heading', { level: 2 }, LOAD);
  return { ...view, source };
}

// Press Save and answer «Save» to the question.
async function saveAndConfirm(user: Awaited<ReturnType<typeof open>>['user'], asked = 'Save these changes?') {
  await user.click(saveButton());
  const dialog = await question(asked);
  await user.click(within(dialog).getByRole('button', { name: 'Save' }));
}

describe('Extra dough', () => {
  const brioche = () => main().getByRole('switch', { name: 'Brioche' });

  it('has one switch per recipe, all on by default, and a Save that waits for a change', async () => {
    await open('/calculator/settings/extra');
    expect(main().getByRole('heading', { level: 2, name: 'Extra dough' })).toBeInTheDocument();
    expect(main().getAllByRole('switch').map(item => item.getAttribute('aria-labelledby') && item.closest('div')?.textContent))
      .toEqual(['Focaccia', 'Brioche', 'Sourdough']);
    for (const item of main().getAllByRole('switch')) expect(item).toBeChecked();
    expect(saveButton()).toBeDisabled();
    expect(main().getByText(/^Show the “Extra dough” box in each recipe tab/)).toBeInTheDocument();
  });

  it('shows the switch of a recipe that was turned off', async () => {
    await open('/calculator/settings/extra', { config: configOf({ extraDough: { brioche: false } }) });
    expect(brioche()).not.toBeChecked();
  });

  it('enables Save on a change and disables it again when the change is put back', async () => {
    const { user } = await open('/calculator/settings/extra');
    await user.click(brioche());
    expect(saveButton()).toBeEnabled();
    await user.click(brioche());
    expect(saveButton()).toBeDisabled();
  });

  it('asks «Save these changes?», writes exactly the changed switch, and returns to the hub', async () => {
    const { user, source, ...view } = await open('/calculator/settings/extra');
    await user.click(brioche());
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toHaveLength(1);
    expect(source.savedConfigs[0]).toMatchObject({
      extraDough: { focaccia: true, brioche: false, sourdough: true },
      configModel: 4,
    });
    // Nothing else in the document moved.
    expect(source.savedConfigs[0]?.recipes).toHaveLength(3);
    expect(source.savedConfigs[0]).toMatchObject({ askDoughDay: true, showClientOrdersButton: true });
  });

  it('writes nothing when the question is answered with Cancel', async () => {
    const { user, source, ...view } = await open('/calculator/settings/extra');
    await user.click(brioche());
    await user.click(saveButton());
    await user.click(within(await question('Save these changes?')).getByRole('button', { name: 'Cancel' }));
    expect(source.savedConfigs).toEqual([]);
    expect(pathOf(view)).toBe('/calculator/settings/extra');
    expect(brioche()).not.toBeChecked();
  });

  it('keeps another phone\'s change to a recipe it did not touch', async () => {
    const { user, source } = await open('/calculator/settings/extra');
    await user.click(brioche());
    // Meanwhile another phone turned Sourdough off.
    act(() => { source.config = configOf({ extraDough: { sourdough: false }, configRev: 1 }); source.push(); });
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(source.savedConfigs[0]).toMatchObject({ extraDough: { focaccia: true, brioche: false, sourdough: false } });
  });

  it('after a refused save keeps the screen dirty with its edits, says why, and gives Save back', async () => {
    const { user, source, ...view } = await open('/calculator/settings/extra');
    source.refuse.configSave = true;
    await user.click(brioche());
    await saveAndConfirm(user);
    const dialog = await question('Not saved: this app is out of date. Reload it and try again.');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });

    expect(pathOf(view)).toBe('/calculator/settings/extra');
    expect(brioche()).not.toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(isBusy()).toBe(true);

    // And the next try works.
    source.refuse.configSave = false;
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toHaveLength(2);
  });

  it('ignores a second tap on Save while the write is in the air, and holds the busy marker meanwhile', async () => {
    const { user, source, ...view } = await open('/calculator/settings/extra');
    source.holdConfigSaves();
    await user.click(brioche());
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });

    await user.click(saveButton());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.savedConfigs).toHaveLength(1);
    expect(isBusy()).toBe(true);

    source.settleConfigSaves();
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toHaveLength(1);
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('waits for the venue\'s configuration before it copies it, and draws no switch meanwhile', async () => {
    const source = fakeCalculatorSource({ config: configOf({ extraDough: { brioche: false } }) });
    source.hold();
    renderCalculator('/calculator/settings/extra', { source });
    expect(await screen.findByText('Loading…', undefined, LOAD)).toBeInTheDocument();
    expect(main().queryByRole('switch')).not.toBeInTheDocument();
    act(() => { source.release(); });
    expect(await main().findByRole('switch', { name: 'Brioche' }, LOAD)).not.toBeChecked();
  });

  it('says its words in Italian', async () => {
    const { user } = await open('/calculator/settings/extra', { lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Impasto extra' })).toBeInTheDocument();
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(main().getByRole('button', { name: 'Salva' }));
    await question('Vuoi salvare queste modifiche?');
  });
});

describe('leaving with unsaved edits', () => {
  const leaveQuestion = () => question('You have unsaved changes. Leave without saving? Your changes will be lost.');

  it('Back asks, and Cancel keeps the edits where they are', async () => {
    const { user, source, ...view } = await open('/calculator/settings/extra');
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await leaveQuestion()).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe('/calculator/settings/extra');
    expect(main().getByRole('switch', { name: 'Brioche' })).not.toBeChecked();
    expect(source.savedConfigs).toEqual([]);
  });

  it('Back asks, and Discard leaves without saving', async () => {
    const { user, source, ...view } = await open('/calculator/settings/extra');
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await leaveQuestion()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toEqual([]);
  });

  it('the rail asks too: every way out goes through the router\'s blocker', async () => {
    const { user, ...view } = await open('/calculator/settings/extra');
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await leaveQuestion()).getByRole('button', { name: 'Cancel' }));
    expect(pathOf(view)).toBe('/calculator/settings/extra');

    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));
    await user.click(within(await leaveQuestion()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/stocktake'); });
  });

  it('asks nothing when nothing was changed, or when the change was put back', async () => {
    const { user, ...view } = await open('/calculator/settings/extra');
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('holds the busy marker while edits are unsaved, and lets go when they are thrown away', async () => {
    const { user } = await open('/calculator/settings/extra');
    expect(isBusy()).toBe(false);
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    expect(isBusy()).toBe(true);
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    expect(isBusy()).toBe(false);
  });

  it('lets go of the busy marker when the screen goes away', async () => {
    const { user } = await open('/calculator/settings/extra');
    await user.click(main().getByRole('switch', { name: 'Brioche' }));
    await user.click(main().getByRole('button', { name: 'Back' }));
    await user.click(within(await leaveQuestion()).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });
});

describe('Divisor', () => {
  it('lists the recipes, and a recipe opens its products', async () => {
    const { user, ...view } = await open('/calculator/settings/divisor');
    expect(main().getByRole('heading', { level: 2, name: 'Divisor' })).toBeInTheDocument();
    expect(main().getByText(/^Pick which products each recipe’s divisor box splits into crates/)).toBeInTheDocument();
    expect(main().getAllByRole('button').map(button => button.getAttribute('aria-label') ?? button.textContent))
      .toEqual(['Back', 'Focaccia', 'Brioche', 'Sourdough']);
    await user.click(main().getByRole('button', { name: 'Focaccia' }));
    expect(pathOf(view)).toBe('/calculator/settings/divisor/focaccia');
    expect(await main().findByRole('heading', { level: 2, name: 'Focaccia divisor' }, LOAD)).toBeInTheDocument();
  });

  it('lists a recipe\'s products once each, paused ones left out', async () => {
    await open('/calculator/settings/divisor/focaccia');
    // «Focaccia tray» is ordered by two clients: one row. «Paused loaf» is paused: none.
    expect(main().getAllByRole('checkbox').map(box => box.closest('label')?.textContent))
      .toEqual(['Focaccia tray', 'Focaccia slab', 'Cheese by the kilo']);
  });

  it('shows what is ticked, and Save waits for a change', async () => {
    await open('/calculator/settings/divisor/focaccia', { config: configOf({ divisorIncluded: { focaccia: ['slab'] } }) });
    expect(main().getByRole('checkbox', { name: 'Focaccia slab' })).toBeChecked();
    expect(main().getByRole('checkbox', { name: 'Focaccia tray' })).not.toBeChecked();
    expect(saveButton()).toBeDisabled();
  });

  it('writes the ticked product ids of that recipe only, and returns to the list of recipes', async () => {
    const { user, source, ...view } = await open('/calculator/settings/divisor/focaccia', {
      config: configOf({ divisorIncluded: { brioche: ['roll'] } }),
    });
    await user.click(main().getByRole('checkbox', { name: 'Focaccia tray' }));
    await user.click(main().getByRole('checkbox', { name: 'Focaccia slab' }));
    await saveAndConfirm(user);
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/divisor'); });
    expect(source.savedConfigs).toHaveLength(1);
    expect(source.savedConfigs[0]).toMatchObject({ divisorIncluded: { focaccia: ['tray', 'slab'], brioche: ['roll'] } });
  });

  it('«Untick all» clears the recipe\'s ticks, and Save writes the empty list', async () => {
    const { user, source } = await open('/calculator/settings/divisor/focaccia', {
      config: configOf({ divisorIncluded: { focaccia: ['tray', 'slab'] } }),
    });
    await user.click(main().getByRole('button', { name: 'Untick all' }));
    for (const box of main().getAllByRole('checkbox')) expect(box).not.toBeChecked();
    await saveAndConfirm(user);
    await waitFor(() => { expect(source.savedConfigs).toHaveLength(1); });
    expect(source.savedConfigs[0]).toMatchObject({ divisorIncluded: { focaccia: [] } });
  });

  it('a recipe with no products says so and has no Save', async () => {
    await open('/calculator/settings/divisor/sourdough');
    expect(main().getByText('No products in this tab yet.')).toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(main().queryByRole('button', { name: 'Untick all' })).not.toBeInTheDocument();
  });

  it('a recipe that is not there goes back to the list of recipes', async () => {
    const view = await open('/calculator/settings/divisor/nonsense');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings/divisor'); });
    expect(await main().findByRole('button', { name: 'Focaccia' }, LOAD)).toBeInTheDocument();
  });

  it('asks before throwing ticks away, and a refused save keeps them', async () => {
    const { user, source, ...view } = await open('/calculator/settings/divisor/focaccia');
    source.refuse.configSave = true;
    await user.click(main().getByRole('checkbox', { name: 'Focaccia tray' }));
    await saveAndConfirm(user);
    const dialog = await question('Not saved: this app is out of date. Reload it and try again.');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));
    expect(main().getByRole('checkbox', { name: 'Focaccia tray' })).toBeChecked();
    expect(saveButton()).toBeEnabled();
    expect(pathOf(view)).toBe('/calculator/settings/divisor/focaccia');
  });

  it('says its title in Italian', async () => {
    await open('/calculator/settings/divisor/focaccia', { lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Divisore di Focaccia' })).toBeInTheDocument();
    expect(main().getByRole('button', { name: 'Togli tutte le spunte' })).toBeInTheDocument();
  });
});

describe('Dough history settings', () => {
  const card = (name: string) => within(main().getByRole('region', { name }));

  it('has one card per recipe, naming its products, with the switch and the hours', async () => {
    await open('/calculator/settings/log');
    expect(main().getByRole('heading', { level: 2, name: 'Dough history' })).toBeInTheDocument();
    expect(main().getByText(/^For each recipe: choose whether its doughs appear in the dough history/)).toBeInTheDocument();
    expect(main().getByText(/^Every confirmed dough is always kept in the database/)).toBeInTheDocument();
    expect(card('Focaccia').getByText('Focaccia tray, Focaccia slab, Cheese by the kilo')).toBeInTheDocument();
    expect(card('Sourdough').getByText('No products')).toBeInTheDocument();
    expect(card('Brioche').getByRole('switch', { name: 'Show in the dough history Brioche' })).toBeChecked();
    expect(card('Brioche').getByRole('combobox', { name: 'Dough history duration for Brioche' })).toHaveValue('24');
    expect(within(card('Brioche').getByRole('combobox')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['24 hours', '48 hours']);
  });

  it('shows what the venue has chosen', async () => {
    await open('/calculator/settings/log', {
      config: configOf({ logVisibility: { brioche: false }, logRetentionByDough: { focaccia: 48 } }),
    });
    expect(card('Brioche').getByRole('switch')).not.toBeChecked();
    expect(card('Focaccia').getByRole('combobox')).toHaveValue('48');
    expect(card('Sourdough').getByRole('combobox')).toHaveValue('24');
  });

  it('asks its own question and writes only what was changed', async () => {
    const { user, source, ...view } = await open('/calculator/settings/log', {
      config: configOf({ logRetentionByDough: { sourdough: 48 } }),
    });
    await user.click(card('Brioche').getByRole('switch'));
    await user.selectOptions(card('Focaccia').getByRole('combobox'), '48');
    await saveAndConfirm(user, 'Save these dough history settings?');
    await waitFor(() => { expect(pathOf(view)).toBe('/calculator/settings'); });
    expect(source.savedConfigs).toHaveLength(1);
    expect(source.savedConfigs[0]).toMatchObject({
      logVisibility: { focaccia: true, brioche: false, sourdough: true },
      logRetentionByDough: { focaccia: 48, brioche: 24, sourdough: 48 },
    });
  });

  it('keeps Save disabled until something changed, and asks before throwing a change away', async () => {
    const { user } = await open('/calculator/settings/log');
    expect(saveButton()).toBeDisabled();
    await user.selectOptions(card('Focaccia').getByRole('combobox'), '48');
    expect(saveButton()).toBeEnabled();
    await user.click(main().getByRole('button', { name: 'Back' }));
    await question('You have unsaved changes. Leave without saving? Your changes will be lost.');
  });

  it('speaks Italian', async () => {
    await open('/calculator/settings/log', { lang: 'it' });
    expect(main().getByRole('heading', { level: 2, name: 'Storico impasti' })).toBeInTheDocument();
    expect(card('Focaccia').getByRole('combobox', { name: 'Durata nello storico impasti per Focaccia' })).toBeInTheDocument();
    expect(within(card('Focaccia').getByRole('combobox')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['24 ore', '48 ore']);
  });
});
