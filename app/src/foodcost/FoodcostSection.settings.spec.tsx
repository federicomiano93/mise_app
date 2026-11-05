import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD, product, renderFoodcost, sourceWith } from '../testing/renderFoodcost';

// The hourly labour cost: it waits for the stored rate, refuses a number the rules would refuse
// before it asks, asks, saves, says so, and asks before a changed number is thrown away.

beforeAll(async () => { await import('./FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const OUT_OF_RANGE = 'The hourly cost must be more than 0 and at most 10,000. Leave it empty to remove it.';
const SAVED = 'Hourly labour cost saved.';

function source(settings: Record<string, unknown> | null = { labourCostPerHour: 12.5 }) {
  return sourceWith([product('Green')], { settings });
}

const box = () => screen.findByRole('textbox', { name: 'Labour cost per hour (£)' }, LOAD);
const saveBar = () => screen.getByRole('button', { name: 'Save' });
const question = () => screen.findByRole('alertdialog', undefined, LOAD);

async function open(fake = source(), options = {}) {
  const view = renderFoodcost('/food-cost/settings', { source: fake, ...options });
  return { ...view, fake, input: await box() };
}

describe('the form', () => {
  it('shows the stored rate in a box labelled with the venue\'s currency, and the note', async () => {
    const { input } = await open();
    expect(input).toHaveValue('12.5');
    expect(screen.getByRole('heading', { level: 2, name: 'Food cost settings' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Costs' })).toBeInTheDocument();
    expect(input).toHaveAccessibleDescription(/^What one hour of one person’s work costs the business/);
  });

  it('writes the venue\'s own currency in the label', async () => {
    renderFoodcost('/food-cost/settings', { source: source(), session: { location: { country: 'IT' } } });
    expect(await screen.findByRole('textbox', { name: 'Labour cost per hour (€)' }, LOAD)).toBeInTheDocument();
  });

  it('starts empty where no rate has been set', async () => {
    const { input } = await open(source(null));
    expect(input).toHaveValue('');
  });

  // Opened by its address, the rate may not have arrived: a box copied now would be empty, and a
  // Save would clear the real rate.
  it('waits for the stored rate before it copies it into the box', async () => {
    const fake = source();
    let answer: (data: Record<string, unknown> | null, meta: { readonly fromServer: boolean }) => void = () => undefined;
    vi.mocked(fake.watchSettings).mockImplementation(onChange => {
      answer = onChange;
      return () => undefined;
    });
    renderFoodcost('/food-cost/settings', { source: fake });

    const region = await screen.findByText('Loading…', undefined, LOAD);
    expect(region.closest('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    act(() => { answer({ labourCostPerHour: 9 }, { fromServer: true }); });
    expect(await box()).toHaveValue('9');
  });
});

describe('saving', () => {
  it('asks, saves the rate, says so and returns to the list', async () => {
    const { fake, input, router, user } = await open();
    await user.clear(input);
    await user.type(input, '15');
    await user.click(saveBar());

    const dialog = within(await question());
    expect(dialog.getByText('Save the hourly labour cost?')).toBeInTheDocument();
    expect(dialog.getByText('Save these changes?')).toBeInTheDocument();
    expect(fake.saved).toEqual([]);
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(fake.saved).toHaveLength(1); });
    expect(fake.saved[0]).toMatchObject({ kind: 'rate', data: { labourCostPerHour: 15 } });
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/food-cost');
  });

  it('keeps the screen and saves nothing when the question is answered with Cancel', async () => {
    const { fake, input, router, user } = await open();
    await user.type(input, '1');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Cancel' }));

    expect(fake.saved).toEqual([]);
    expect(router.state.location.pathname).toBe('/food-cost/settings');
    expect(screen.queryByText(SAVED)).not.toBeInTheDocument();
  });

  it('clears the rate when the box is emptied', async () => {
    const { fake, input, user } = await open();
    await user.clear(input);
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(fake.saved).toHaveLength(1); });
    expect(fake.saved[0]).toMatchObject({ kind: 'rate', data: { labourCostPerHour: null } });
    expect(await screen.findByText(SAVED)).toBeInTheDocument();
  });

  it('reads a comma as a decimal point', async () => {
    const { fake, input, user } = await open(source(null));
    await user.type(input, '12,75');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(fake.saved).toHaveLength(1); });
    expect(fake.saved[0]).toMatchObject({ data: { labourCostPerHour: 12.75 } });
  });

  it('says so, in words, when the database refuses the rate and the old one comes back', async () => {
    const fake = source();
    fake.refuse.rate = true;
    const { input, user } = await open(fake);
    await user.clear(input);
    await user.type(input, '20');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('The hourly labour cost was not saved — only an owner or a manager can change it.')).toBeInTheDocument();
  });
});

// A number the rules would refuse stops the save BEFORE the question: the question used to come
// first, and a 0 cleared the stored rate in silence.
describe('a number the rules would refuse', () => {
  it.each([['0'], ['0,0'], ['10001'], ['-5'], ['abc'], ['1.2.3'], ['1e3']])('stops %s before it asks', async text => {
    const { fake, input, user } = await open();
    await user.clear(input);
    await user.type(input, text);
    await user.click(saveBar());

    expect(await screen.findByText(OUT_OF_RANGE)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.saved).toEqual([]);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveFocus();
  });

  it('takes the highlight off as soon as the number is typed again', async () => {
    const { input, user } = await open();
    await user.clear(input);
    await user.type(input, '0');
    await user.click(saveBar());
    await screen.findByText(OUT_OF_RANGE);
    await user.type(input, '5');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it.each([['0.01'], ['10000'], ['12.5']])('lets %s through to the question', async text => {
    const { input, user } = await open();
    await user.clear(input);
    await user.type(input, text);
    await user.click(saveBar());
    expect(await question()).toBeInTheDocument();
  });
});

describe('leaving with a changed number', () => {
  it('asks «Discard changes?» on Back, and stays when the answer is Cancel', async () => {
    const { fake, input, router, user } = await open();
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    const dialog = within(await question());
    expect(dialog.getByText('Discard changes?')).toBeInTheDocument();
    expect(dialog.getByText('You have unsaved changes. Discard them?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(router.state.location.pathname).toBe('/food-cost/settings');
    expect(input).toHaveValue('12.51');
    expect(fake.saved).toEqual([]);
  });

  it('leaves without saving when the answer is Discard', async () => {
    const { fake, input, router, user } = await open();
    await user.type(input, '1');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await question()).getByRole('button', { name: 'Discard' }));

    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(fake.saved).toEqual([]);
  });

  it('asks on the way out by the navigation too, not only by the Back button', async () => {
    const { input, router, user } = await open();
    await user.type(input, '1');
    await user.click(within(screen.getByRole('navigation', { name: 'Main sections' })).getByRole('link', { name: 'Stocktake' }));

    const dialog = within(await question());
    expect(dialog.getByText('Discard changes?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/food-cost/settings');
    expect(input).toBeInTheDocument();
  });

  it('asks nothing when nothing was changed', async () => {
    const { router, user } = await open();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks nothing when the number was typed and then put back', async () => {
    const { input, router, user } = await open();
    await user.type(input, '1');
    await user.type(input, '{Backspace}');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks nothing after a save', async () => {
    const { input, router, user } = await open();
    await user.type(input, '1');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('steps back to the list with the focus on the Settings button that opened it', async () => {
    const { router, user } = renderFoodcost('/food-cost', { source: source() });
    await user.click(await screen.findByRole('button', { name: 'Settings' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Back' }, LOAD));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/food-cost'); });
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus();
  });
});

describe('the settings in Italian', () => {
  it('speaks Italian, and asks in Italian', async () => {
    const view = renderFoodcost('/food-cost/settings', {
      source: source(), lang: 'it', session: { language: 'it', location: { country: 'IT' } },
    });
    const input = await screen.findByRole('textbox', { name: 'Costo del lavoro all’ora (€)' }, LOAD);
    expect(screen.getByRole('heading', { level: 2, name: 'Impostazioni del Food cost' })).toBeInTheDocument();
    await view.user.type(input, '1');
    await view.user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(within(await question()).getByText('Vuoi salvare il costo orario del lavoro?')).toBeInTheDocument();
  });
});
