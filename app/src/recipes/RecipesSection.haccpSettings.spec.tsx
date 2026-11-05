import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { HACCP_DEFAULTS, HACCP_FIELDS } from '@mise/shared/haccp-label';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// The HACCP label's card in the label Settings (image labels step 2): the size, the list filter and the eleven fields with
// three states each, saved on the tap.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const GB = { country: 'GB' };

async function openSettings(labelConfig: Record<string, unknown> | null = null, lang: 'en' | 'it' = 'en') {
  const source = fakeRecipesSource({ recipes: [recipe('r1')], labelConfig });
  const view = renderRecipes('/recipes/settings', { source, lang, session: { location: GB, language: lang } });
  await screen.findByRole('region', { name: lang === 'it' ? 'Impostazioni' : 'Settings' }, LOAD);
  return { ...view, source };
}

const card = (name = 'HACCP label') => within(screen.getByRole('region', { name }));
const state = (field: string, text: string) => within(card().getByRole('radiogroup', { name: field })).getByRole('radio', { name: text });

describe('the HACCP label card', () => {
  it.each(['standard', 'logo'])('is there whatever the product label’s model (%s)', async template => {
    await openSettings({ template });
    expect(screen.getByRole('heading', { level: 3, name: 'HACCP label' })).toBeInTheDocument();
  });

  it('shows the venue’s defaults when nothing was saved', async () => {
    await openSettings(null);
    expect(state('Name', 'Printed')).toBeChecked();
    expect(state('Prepared on', 'Printed')).toBeChecked();
    expect(state('Use by', 'Printed')).toBeChecked();
    expect(state('Allergens', 'Printed')).toBeChecked();
    expect(state('Lot', 'Off')).toBeChecked();
    // ⚠️ P13: a person’s name on paper is off until somebody who runs the place switches it on.
    expect(state('Prepared by', 'Off')).toBeChecked();
    expect(card().getByLabelText('Label size')).toHaveValue('60x40');
  });

  it('offers one row per field, in the printed order, with Off / Printed / By hand', async () => {
    await openSettings(null);
    const groups = card().getAllByRole('radiogroup').map(g => g.getAttribute('aria-labelledby')).filter(Boolean);
    const names = card().getAllByRole('radiogroup').map(g => within(g).getAllByRole('radio').map(r => r.textContent).join('/'));
    expect(groups).toHaveLength(HACCP_FIELDS.length);
    expect(names.every(n => n === 'Off/Printed/By hand')).toBe(true);
  });

  it('⚠️ each tap writes the WHOLE map of the eleven fields, with the one change', async () => {
    const { source, user } = await openSettings({ haccpFields: { lot: 'print' } });
    await user.click(state('Lot', 'By hand'));
    await waitFor(() => { expect(source.labelSaves).toHaveLength(1); });
    expect(source.labelSaves[0]).toEqual({ haccpFields: { ...HACCP_DEFAULTS, lot: 'blank' } });
    expect(Object.keys((source.labelSaves[0] as { haccpFields: object }).haccpFields)).toHaveLength(11);
    await user.click(state('Prepared by', 'Printed'));
    await waitFor(() => { expect(source.labelSaves).toHaveLength(2); });
    expect(source.labelSaves[1]).toEqual({ haccpFields: { ...HACCP_DEFAULTS, lot: 'blank', preparedBy: 'print' } });
    expect(state('Prepared by', 'Printed')).toBeChecked();
  });

  it('writes nothing for a tap on the state already chosen', async () => {
    const { source, user } = await openSettings(null);
    await user.click(state('Name', 'Printed'));
    expect(source.labelSaves).toEqual([]);
  });

  it('saves the size on the choice, as one of the five sizes in millimetres', async () => {
    const { source, user } = await openSettings(null);
    const size = card().getByLabelText('Label size') as HTMLSelectElement;
    expect([...size.options].map(o => o.textContent)).toEqual(['40 × 30 mm', '50 × 30 mm', '60 × 40 mm', '62 × 29 mm', '80 × 60 mm']);
    await user.selectOptions(size, '62x29');
    await waitFor(() => { expect(source.labelSaves).toEqual([{ haccpSize: '62x29' }]); });
  });

  it('says there is no list filter to choose until the venue has a recipe category', async () => {
    await openSettings(null);
    expect(card().queryByLabelText('Recipes in the HACCP list')).not.toBeInTheDocument();
    expect(card().getByText(/Add recipe categories/)).toBeInTheDocument();
  });

  it('⚠️ the list filter: a category word is saved, “All recipes” removes it (null), and a word no longer listed reads as All recipes', async () => {
    const { source, user } = await openSettings({ recipeCategories: ['Semilavorati', 'Dolci'], haccpCategory: 'Semilavorati' });
    const list = card().getByLabelText('Recipes in the HACCP list') as HTMLSelectElement;
    expect([...list.options].map(o => o.textContent)).toEqual(['All recipes', 'Dolci', 'Semilavorati']);
    expect(list).toHaveValue('Semilavorati');
    await user.selectOptions(list, 'Dolci');
    await waitFor(() => { expect(source.labelSaves).toEqual([{ haccpCategory: 'Dolci' }]); });
    await user.selectOptions(list, '');
    await waitFor(() => { expect(source.labelSaves).toHaveLength(2); });
    expect(source.labelSaves[1]).toEqual({ haccpCategory: null });
  });

  it('shows a stored word that has left the venue’s list as All recipes', async () => {
    await openSettings({ recipeCategories: ['Dolci'], haccpCategory: 'Gone' });
    expect(card().getByLabelText('Recipes in the HACCP list')).toHaveValue('');
  });

  it('says the three notes under their rows, the person’s name one included', async () => {
    await openSettings(null);
    expect(card().getByText('From the recipe’s shelf life (days).')).toBeInTheDocument();
    expect(card().getByText('Prints the first name of whoever prints the label: personal data on paper stuck to the food.')).toBeInTheDocument();
    expect(card().getByText('From the recipe’s declarations; printed, the recipe must have them all.')).toBeInTheDocument();
  });

  it('⚠️ a refused save is said in the page’s status line, the way the other cards say it, and the change is put back', async () => {
    const { source, user } = await openSettings(null);
    source.refuse.labelSave = true;
    await user.click(state('Lot', 'Printed'));
    await waitFor(() => { expect(screen.getByText('Could not save — the change has been put back')).toBeInTheDocument(); });
    expect(state('Lot', 'Off')).toBeChecked();
  });

  it('says its words in Italian', async () => {
    await openSettings(null, 'it');
    const it = within(screen.getByRole('region', { name: 'Etichetta HACCP' }));
    expect(it.getByLabelText('Formato etichetta')).toBeInTheDocument();
    expect(within(it.getByRole('radiogroup', { name: 'Preparato da' })).getByRole('radio', { name: 'A mano' })).toBeInTheDocument();
    expect(within(it.getByRole('radiogroup', { name: 'Da consumarsi entro' })).getByRole('radio', { name: 'Stampato' })).toBeChecked();
  });
});
