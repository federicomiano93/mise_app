import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { REFERENCE, renderCakes, storedReference } from '../testing/renderCakes';
import { LOAD } from '../testing/renderFoodcost';

// The standard cake: a table of grams per diameter. Plain text for whoever may not change it, a form with the settings pattern for
// whoever runs the place — empty to begin with, grey figures worked out live from the nearest diameter typed, a Save that blocks on the
// first box that cannot be saved, asks, writes local-first, and says when the rules refused. The maths of the figures is
// shared/src/cake-standard.spec.ts; fake data only.

beforeAll(async () => { await import('./CakesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const EMPLOYEE = { canManage: false, isOwner: false, role: 'staff' as const, location: { staffShownCards: { foodcost: true } } };
// A document written before the table existed: its one cake (22 cm, 3 discs of 3 cm), read as a table with that row typed.
const withReference = () => fakeCakesSource({ reference: storedReference() });

const BIG = storedReference({ ...REFERENCE, baseG: 1050 });
const box = (name: string) => screen.findByRole('textbox', { name: new RegExp(`^${name}`) }, LOAD);
const saveBar = () => screen.getByRole('button', { name: 'Save' });
// What a screen reader reads after a box's name: the text of every element its aria-describedby points at.
const described = (node: HTMLElement) => (node.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean)
  .map(id => document.getElementById(id)?.textContent ?? '').join(' | ');
const question = () => screen.findByRole('alertdialog', undefined, LOAD);

async function openForm(cakes = withReference(), options = {}) {
  const view = renderCakes('/cakes/reference', { cakes, ...options });
  await box('Discs');
  return { ...view, cakes };
}

describe('somebody who may not change it', () => {
  it('reads the table as plain text: no box, no Save, the note, typed figures plain and worked-out ones marked', async () => {
    renderCakes('/cakes/reference', { cakes: withReference(), session: EMPLOYEE });
    expect(await screen.findByRole('heading', { level: 2, name: 'Settings' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.getByText('Only an owner or a manager can change these grams.')).toBeInTheDocument();
    const typed = screen.getByRole('group', { name: '22 cm' });
    expect(within(typed).getByText(/^300 g$/)).toBeInTheDocument();
    expect(within(typed).queryByText('worked out')).not.toBeInTheDocument();
    // 20 cm: 300 g × (20/22)² = 248 g, rounded to 250 g.
    const scaled = screen.getByRole('group', { name: '20 cm' });
    expect(scaled).toHaveTextContent('250 g worked out');
  });

  it('says that nobody has written it yet, and shows no table', async () => {
    renderCakes('/cakes/reference', { cakes: fakeCakesSource(), session: EMPLOYEE });
    expect(await screen.findByText(/Nobody has written the standard cake yet\./, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: '22 cm' })).not.toBeInTheDocument();
  });
});

describe('the form of whoever runs the place', () => {
  it('shows a legacy document as a table: its one cake typed at 22 cm among 16 to 28, the others grey and described', async () => {
    await openForm();
    expect(screen.getByRole('heading', { level: 3, name: 'The standard cake' })).toBeInTheDocument();
    expect(await box('Discs')).toHaveValue('3');
    expect(await box('Height of a disc')).toHaveValue('3');
    for (const d of [16, 18, 20, 22, 24, 26, 28]) {
      expect(await box(`Base at ${d} cm`)).toBeInTheDocument();
    }
    const typed = await box('Base at 22 cm');
    expect(typed).toHaveValue('300');
    const grey = await box('Base at 20 cm');
    expect(grey).toHaveValue('');
    expect(grey).toHaveAttribute('placeholder', '250');
    // The column's note first, then where the grey figure comes from; the name stays «Base at 20 cm».
    expect(described(grey)).toBe('g per disc | worked out from 22 cm: 250 g');
    expect(described(typed)).toBe('g per disc');
    expect(screen.getByText(/The coating is approximate/)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: /Try it/ })).not.toBeInTheDocument();
  });

  it('starts empty where nothing is stored: no discs, no height, every box empty with a dash', async () => {
    await openForm(fakeCakesSource());
    expect(await box('Discs')).toHaveValue('');
    expect(await box('Height of a disc')).toHaveValue('');
    const base = await box('Base at 22 cm');
    expect(base).toHaveValue('');
    expect(base).toHaveAttribute('placeholder', '—');
  });

  it('the grey figures follow what is typed, live: a typed box turns black and its neighbours scale from it', async () => {
    const { user } = await openForm();
    const near = await box('Base at 18 cm');
    expect(near).toHaveAttribute('placeholder', '200');
    const twenty = await box('Base at 20 cm');
    await user.type(twenty, '260');
    expect(twenty).toHaveValue('260');
    expect(described(twenty)).toBe('g per disc');
    // 18 cm is now nearest to 20 cm: 260 g × (18/20)² = 210.6 g, rounded to 210 g.
    expect(near).toHaveAttribute('placeholder', '210');
    expect(described(near)).toBe('g per disc | worked out from 20 cm: 210 g');
    await user.clear(twenty);
    expect(near).toHaveAttribute('placeholder', '200');
  });
});

describe('the diameters', () => {
  it('adds a diameter in its place (Enter in the box too), and puts the cursor in its first box', async () => {
    const { user } = await openForm();
    const add = await box('New diameter');
    expect(add).toHaveAttribute('placeholder', 'e.g. 30');
    await user.type(add, '23');
    await user.click(screen.getByRole('button', { name: /Add diameter/ }));
    expect(await box('Base at 23 cm')).toHaveFocus();
    expect(add).toHaveValue('');
    await user.type(add, '30{Enter}');
    expect(await box('Base at 30 cm')).toHaveFocus();
    // Ascending: 23 sits between 22 and 24.
    const bases = screen.getAllByRole('textbox', { name: /^Base at/ }).map(node => node.getAttribute('aria-label'));
    expect(bases).toEqual(['Base at 16 cm', 'Base at 18 cm', 'Base at 20 cm', 'Base at 22 cm', 'Base at 23 cm', 'Base at 24 cm', 'Base at 26 cm', 'Base at 28 cm', 'Base at 30 cm']);
  });

  it('refuses a diameter outside 10 to 60 and one already there: a message under the box, the box marked and focused', async () => {
    const { user } = await openForm();
    const add = await box('New diameter');
    await user.type(add, '9');
    await user.click(screen.getByRole('button', { name: /Add diameter/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A whole diameter between 10 and 60 cm.');
    expect(add).toHaveAttribute('aria-invalid', 'true');
    // The error is announced: the box points at it.
    expect(described(add)).toBe('A whole diameter between 10 and 60 cm.');
    expect(add).toHaveFocus();
    await user.clear(add);
    expect(add).not.toHaveAttribute('aria-invalid');
    await user.type(add, '22');
    await user.click(screen.getByRole('button', { name: /Add diameter/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('22 cm is already there.');
    expect(add).toHaveFocus();
    expect(screen.getAllByRole('textbox', { name: /^Base at 22 cm/ })).toHaveLength(1);
  });

  it('takes a diameter off with no question; the cursor goes to the next row’s ×, and the last row cannot be removed', async () => {
    const { user } = await openForm();
    await user.click(await screen.findByRole('button', { name: 'Remove 20 cm' }, LOAD));
    expect(screen.queryByRole('textbox', { name: /^Base at 20 cm/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Remove 22 cm' })).toHaveFocus(); });
    // The last of the list: the cursor goes to the previous row's ×.
    await user.click(screen.getByRole('button', { name: 'Remove 28 cm' }));
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Remove 26 cm' })).toHaveFocus(); });
    for (const d of [16, 18, 22, 24]) await user.click(screen.getByRole('button', { name: `Remove ${d} cm` }));
    expect(screen.getByRole('button', { name: 'Remove 26 cm' })).toBeDisabled();
  });

  it('a diameter that is not whole is refused, never rounded', async () => {
    const { user } = await openForm();
    const add = await box('New diameter');
    await user.type(add, '22.5{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('A whole diameter between 10 and 60 cm.');
    expect(screen.queryByRole('textbox', { name: /^Base at 23 cm/ })).not.toBeInTheDocument();
  });

  it('when the removal leaves ONE row (its × disabled), the focus goes to that row’s first box, never to the page', async () => {
    const { user } = await openForm();
    for (const d of [16, 18, 20, 24, 26]) await user.click(screen.getByRole('button', { name: `Remove ${d} cm` }));
    await user.click(screen.getByRole('button', { name: 'Remove 28 cm' }));
    await waitFor(() => { expect(screen.getByRole('textbox', { name: /^Base at 22 cm/ })).toHaveFocus(); });
    expect(document.body).not.toHaveFocus();
  });

  it('has a Plus icon beside «Add diameter», not a typed «+»', async () => {
    await openForm();
    const button = await screen.findByRole('button', { name: 'Add diameter' }, LOAD);
    expect(button.textContent).toBe('Add diameter');
    expect(button.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('the grey figures are plain digits: 1050, never 1.050 or 1,050', async () => {
    await openForm(fakeCakesSource({ reference: BIG }));
    expect(await box('Base at 22 cm')).toHaveValue('1050');
    // 1050 g × (24/22)² = 1249.6 g, shown to 10 g.
    const grey = await box('Base at 24 cm');
    expect(grey).toHaveAttribute('placeholder', '1250');
    expect(described(grey)).toBe('g per disc | worked out from 22 cm: 1250 g');
  });

  it('the read-only figures are plain digits too', async () => {
    renderCakes('/cakes/reference', { cakes: fakeCakesSource({ reference: BIG }), session: EMPLOYEE });
    expect(within(await screen.findByRole('group', { name: '22 cm' }, LOAD)).getByText(/^1050 g$/)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: '24 cm' })).getByText(/^1250 g/)).toBeInTheDocument();
  });
});

describe('saving', () => {
  it('asks «Save the standard cake?», writes the rows and the figures at 22 cm for the old phones, says so and returns to the list', async () => {
    const { user, cakes, router } = await openForm();
    const base = await box('Base at 22 cm');
    await user.clear(base);
    await user.type(base, '320,5');
    await user.type(await box('Base at 26 cm'), '600');
    await user.click(saveBar());

    const dialog = within(await question());
    expect(dialog.getByText('Save the standard cake?')).toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
    await user.click(dialog.getByRole('button', { name: 'Save' }));

    await waitFor(() => { expect(cakes.saved).toHaveLength(1); });
    const written = cakes.saved[0];
    expect(written?.rows).toHaveLength(7);
    expect(written?.rows.find(row => row.diameterCm === 22)).toEqual({
      diameterCm: 22, baseG: 320.5, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200,
    });
    expect(written?.rows.find(row => row.diameterCm === 26)).toMatchObject({ baseG: 600, soakG: null });
    expect(written?.grams).toMatchObject({ diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 320.5, soakG: 90 });
    expect(written?.bakery).toBe('bakery');
    expect(await screen.findByText('Standard cake saved.')).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cakes');
  });

  it('writes nothing when the question is cancelled, and stays on the form', async () => {
    const { user, cakes, router } = await openForm();
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Cancel' }));
    expect(cakes.saved).toEqual([]);
    expect(router.state.location.pathname).toBe('/cakes/reference');
  });

  // P20: a box that cannot be saved blocks the save, jumps to it and highlights it.
  it('blocks on empty discs: it takes the focus, is marked invalid, and the message names it — nothing is asked or written', async () => {
    const { user, cakes } = await openForm(fakeCakesSource());
    await user.click(saveBar());
    const discs = await box('Discs');
    expect(discs).toHaveFocus();
    expect(discs).toHaveAttribute('aria-invalid', 'true');
    expect(await screen.findByText('Write a number in “Discs”.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
    await user.type(discs, '2');
    expect(discs).not.toHaveAttribute('aria-invalid');
  });

  it('wants a whole number of discs, between 1 and 5, and a height', async () => {
    const { user } = await openForm();
    const discs = await box('Discs');
    await user.clear(discs);
    await user.type(discs, '2.5');
    await user.click(saveBar());
    expect(await screen.findByText('“Discs” must be a whole number between 1 and 5.')).toBeInTheDocument();
    await user.clear(discs);
    await user.type(discs, '3');
    const height = await box('Height of a disc');
    await user.clear(height);
    await user.click(saveBar());
    expect(await screen.findByText('Write a number in “Height of a disc”.')).toBeInTheDocument();
    expect(height).toHaveFocus();
  });

  it('refuses a typed figure that is not a number, naming its box and bounds, before it asks', async () => {
    const { user, cakes } = await openForm();
    const soak = await box('Soak at 18 cm');
    await user.type(soak, 'abc');
    await user.click(saveBar());
    expect(await screen.findByText(/“Soak at 18 cm” must be between 0 and 100\D?000\./)).toBeInTheDocument();
    expect(soak).toHaveFocus();
    expect(soak).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
  });

  it('wants one typed figure in every column: it focuses that column’s box in the FIRST row and says where the numbers come from', async () => {
    const { user, cakes } = await openForm();
    const coating = await box('Coating at 22 cm');
    await user.clear(coating);
    await user.click(saveBar());
    expect(await screen.findByText('Write at least one number in “Coating”: the others are worked out from it.')).toBeInTheDocument();
    const first = await box('Coating at 16 cm');
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(cakes.saved).toEqual([]);
    // A figure typed in any row is enough.
    await user.type(await box('Coating at 28 cm'), '700');
    await user.click(saveBar());
    expect(await question()).toBeInTheDocument();
  });

  it('puts the table back and says so when the rules refuse the write', async () => {
    const cakes = withReference();
    cakes.refuse.reference = true;
    const { user } = await openForm(cakes);
    const base = await box('Base at 22 cm');
    await user.clear(base);
    await user.type(base, '999');
    await user.click(saveBar());
    await user.click(within(await question()).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/The standard cake was not saved — only an owner or a manager can change it\. It is back as it was\./)).toBeInTheDocument();
    // Opened again, the figures are the old ones.
    await user.click(await screen.findByRole('button', { name: 'Settings' }, LOAD));
    expect(await box('Base at 22 cm')).toHaveValue('300');
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
    const base = await box('Base at 22 cm');
    await user.clear(base);
    await user.type(base, '1');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    let dialog = within(await question());
    expect(dialog.getByText('Discard changes?')).toBeInTheDocument();
    await user.click(dialog.getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/cakes/reference');
    expect(await box('Base at 22 cm')).toHaveValue('1');

    await user.click(screen.getByRole('button', { name: 'Back' }));
    dialog = within(await question());
    await user.click(dialog.getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/cakes'); });
    expect(cakes.saved).toEqual([]);
  });

  it('asks too after a diameter was taken off, or another place of the app is chosen from the rail', async () => {
    const { user, router } = await openForm();
    await user.click(await screen.findByRole('button', { name: 'Remove 16 cm' }, LOAD));
    const rail = screen.getAllByRole('navigation').find(nav => within(nav).queryByRole('link', { name: 'Food cost' }));
    await user.click(within(rail as HTMLElement).getAllByRole('link', { name: 'Food cost' })[0] as HTMLElement);
    expect(await question()).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/cakes/reference');
  });
});

describe('the Italian words', () => {
  it('uses the mockup’s: «La torta standard», «Base a 22 cm», «Togli 22 cm», «Salvare la torta standard?»', async () => {
    const { user } = await (async () => {
      const view = renderCakes('/cakes/reference', { lang: 'it', cakes: withReference() });
      await screen.findByRole('heading', { level: 3, name: 'La torta standard' }, LOAD);
      return view;
    })();
    expect(screen.getByRole('textbox', { name: 'Base a 22 cm' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /^Copertura a 22 cm/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Togli 22 cm' })).toBeInTheDocument();
    expect(screen.getByText(/^I numeri in grigio sono calcolati dal diametro più vicino/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    expect(within(await question()).getByText('Salvare la torta standard?')).toBeInTheDocument();
  });
});
