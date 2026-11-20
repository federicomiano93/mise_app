import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { REFERENCE, renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';

// The reference grams: plain text for whoever may not change them, a form with the settings pattern for whoever runs the place —
// empty boxes to begin with, a Save that blocks on the first empty one, asks, writes local-first, and says when the rules refused.
// The maths of the example is shared/src/cake-model.spec.ts; fake data only.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { canManage: false, isOwner: false, role: 'staff' as const, location: { staffShownCards: { foodcost: true } } };
const withReference = () => fakeCakesSource({ reference: storedReference() });

const box = (name: string) => screen.findByRole('textbox', { name: new RegExp(`^${name}`) }, LOAD);
const saveBar = () => screen.getByRole('button', { name: 'Save' });
const question = () => screen.findByRole('alertdialog', undefined, LOAD);

async function openForm(cakes = withReference(), options = {}) {
  const view = renderCakes('/cakes/reference', { cakes, ...options });
  await box('Diameter');
  return { ...view, cakes };
}

describe('somebody who may not change it', () => {
  it('reads the figures as plain text: no box, no Save, and the note saying who can change them', async () => {
    renderCakes('/cakes/reference', { cakes: withReference(), session: EMPLOYEE });
    expect(await screen.findByRole('heading', { level: 2, name: 'Reference grams' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Only an owner or a manager can change these grams.')).toBeInTheDocument();
    const item = screen.getByText('Diameter').closest('div');
    expect(within(item as HTMLElement).getByText('22 cm')).toBeInTheDocument();
    expect(screen.getAllByText('Soak')[0]?.closest('div')).toHaveTextContent('90 g');
  });

  it('says that nobody has written them yet, with dashes in place of the figures', async () => {
    renderCakes('/cakes/reference', { cakes: fakeCakesSource(), session: EMPLOYEE });
    expect(await screen.findByText(/Nobody has written the reference grams yet\./, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Diameter').closest('div')).toHaveTextContent('—');
    expect(screen.getByText('Fill in the grams above to see the example.')).toBeInTheDocument();
  });
});

describe('the form of whoever runs the place', () => {
  it('shows the stored figures, the two cards, the note about the coating, and the example for a 26 cm cake with 3 discs', async () => {
    await openForm();
    expect(await box('Diameter')).toHaveValue('22');
    expect(await box('Disc height|Height of a disc')).toHaveValue('3');
    expect(await box('Base')).toHaveValue('300');
    expect(screen.getByRole('heading', { level: 3, name: 'The reference cake' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Grams per part' })).toBeInTheDocument();
    expect(screen.getByText(/The coating is approximate/)).toBeInTheDocument();
    const example = screen.getByRole('region', { name: 'Try it: a 26 cm cake with 3 discs' });
    // ruleGrams at 26 cm with 3 discs from the 22 cm / 3 discs reference (the design's own figures).
    expect(within(example).getByText('Base').nextSibling).toHaveTextContent(/^1\D?257 g$/);
    expect(within(example).getByText('Soak').nextSibling).toHaveTextContent('377 g');
    expect(within(example).getByText('Filling').nextSibling).toHaveTextContent('782 g');
    expect(within(example).getByText('Decoration').nextSibling).toHaveTextContent('279 g');
  });

  it('starts with empty boxes, placeholders and no example where nothing is stored', async () => {
    await openForm(fakeCakesSource());
    const diameter = await box('Diameter');
    expect(diameter).toHaveValue('');
    expect(diameter).toHaveAttribute('placeholder');
    expect(screen.getByText('Fill in the grams above to see the example.')).toBeInTheDocument();
  });

  it('every box has its label, and the example follows what is typed', async () => {
    const { user } = await openForm();
    const base = await box('Base');
    await user.clear(base);
    await user.type(base, '350');
    const example = screen.getByRole('region', { name: 'Try it: a 26 cm cake with 3 discs' });
    expect(within(example).getByText('Base').nextSibling).toHaveTextContent(/^1\D?467 g$/);
    await user.clear(base);
    expect(screen.getByText('Fill in the grams above to see the example.')).toBeInTheDocument();
  });
});

describe('saving', () => {
  it('asks «Save the reference grams?», saves local-first, says so and returns to the list', async () => {
    const { user, cakes, router } = await openForm();
    const base = await box('Base');
    await user.clear(base);
    await user.type(base, '320,5');
    await user.click(saveBar());

    const dialog = within(await question());
    expect(dialog.getByText('Save the reference grams?')).toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(cakes.saved).toHaveLength(1); });
    expect(cakes.saved[0]?.grams).toEqual({ ...REFERENCE, baseG: 320.5 });
    expect(await screen.findByText('Reference grams saved.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cakes');
  });

  it('writes nothing when the question is cancelled, and stays on the form', async () => {
    const { user, cakes, router } = await openForm();
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Cancel' }));
    expect(cakes.saved).toEqual([]);
    expect(router.state.location.pathname).toBe('/cakes/reference');
  });

  // P20: an empty field blocks the save, jumps to it and highlights it.
  it('blocks on the first empty box: it takes the focus, is marked invalid, and the message names it — nothing is asked or written', async () => {
    const { user, cakes } = await openForm(fakeCakesSource());
    await user.click(saveBar());
    const diameter = await box('Diameter');
    expect(diameter).toHaveFocus();
    expect(diameter).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText('Write a number in “Diameter”.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
    // Typing clears the mark.
    await user.type(diameter, '2');
    expect(diameter).not.toHaveAttribute('aria-invalid');
  });

  it('refuses a number outside what the rules allow before it asks, naming the box and its bounds', async () => {
    const { user, cakes } = await openForm();
    const diameter = await box('Diameter');
    await user.clear(diameter);
    await user.type(diameter, '80');
    await user.click(saveBar());
    expect(await screen.findByText('“Diameter” must be between 10 and 60.')).toBeInTheDocument();
    expect(diameter).toHaveFocus();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
  });

  it('wants a whole number of discs', async () => {
    const { user } = await openForm();
    const discs = await box('Discs');
    await user.clear(discs);
    await user.type(discs, '2.5');
    await user.click(saveBar());
    expect(await screen.findByText('“Discs” must be a whole number between 1 and 5.')).toBeInTheDocument();
  });

  it('puts the grams back and says so when the rules refuse the write', async () => {
    const cakes = withReference();
    cakes.refuse.reference = true;
    const { user } = await openForm(cakes);
    const base = await box('Base');
    await user.clear(base);
    await user.type(base, '999');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/The reference grams were not saved — only an owner or a manager can change them\. They are back as they were\./)).toBeInTheDocument();
    // Opened again, the figures are the old ones.
    await user.click(await screen.findByRole('button', { name: 'Reference grams' }, LOAD));
    expect(await box('Base')).toHaveValue('300');
  });
});

describe('leaving with changes', () => {
  it('does not ask when nothing was changed', async () => {
    const { user, router } = await openForm();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cakes');
  });

  it('asks before Back throws a typed number away, stays on «Cancel» and leaves on «Discard»', async () => {
    const { user, router, cakes } = await openForm();
    const base = await box('Base');
    await user.clear(base);
    await user.type(base, '1');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    let dialog = within(await question());
    expect(dialog.getByText('Discard changes?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/cakes/reference');
    expect(await box('Base')).toHaveValue('1');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    dialog = within(await question());
    await user.click(dialog.getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes'); });
    expect(cakes.saved).toEqual([]);
  });

  it('asks too when another place of the app is chosen from the rail', async () => {
    const { user, router } = await openForm();
    const base = await box('Base');
    await user.type(base, '9');
    const rail = screen.getAllByRole('navigation').find(nav => within(nav).queryByRole('link', { name: 'Food cost' }));
    await user.click(within(rail as HTMLElement).getAllByRole('link', { name: 'Food cost' })[0] as HTMLElement);
    expect(await question()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cakes/reference');
  });
});

describe('the Italian words', () => {
  it('uses the mockup\'s: «La torta tipo», «Grammi per parte», «Salvare i grammi di riferimento?»', async () => {
    const { user } = await (async () => {
      const view = renderCakes('/cakes/reference', { lang: 'it', cakes: withReference() });
      await screen.findByRole('heading', { level: 3, name: 'La torta tipo' }, LOAD);
      return view;
    })();
    expect(screen.getByRole('heading', { level: 3, name: 'Grammi per parte' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Prova: una torta da 26 cm a 3 dischi' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Copertura/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(within(await question()).getByText('Salvare i grammi di riferimento?')).toBeInTheDocument();
  });
});
