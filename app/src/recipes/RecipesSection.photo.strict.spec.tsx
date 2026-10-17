import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, configure, screen, waitFor, within } from '@testing-library/react';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';
import { forgetHandover, peekHandover } from './photoCarry';
import { FROM_LIST } from './recipesNav';

// Under StrictMode every effect runs twice. The editor reads what the photo screen carried while it draws and takes it off in
// an effect: the draft and the typed copy must each still arrive ONCE, whole, and not be eaten by the abandoned first run.

beforeAll(async () => {
  configure({ reactStrictMode: true });
  await import('./RecipesSection');
}, 60_000);

afterAll(() => { configure({ reactStrictMode: false }); });

beforeEach(() => { window.localStorage.clear(); forgetHandover(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.localStorage.clear(); });

const ON = { country: 'GB', recipePhoto: true };

function stubCamera() {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 800, height: 600, close: () => undefined }) as unknown as ImageBitmap));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: () => undefined }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/jpeg;base64,${'A'.repeat(500)}`);
}

describe('under StrictMode: the photo trip', () => {
  it('the typed copy comes back once, whole, and is taken off its entry', async () => {
    const readRecipe = vi.fn(() => new Promise<unknown>(() => undefined));
    const { router, user } = renderRecipes('/recipes/new', {
      source: fakeRecipesSource({ recipes: [recipe('r1')] }),
      entries: [{ pathname: '/recipes' }, { pathname: '/recipes/new', state: FROM_LIST }],
      session: { location: ON },
      data: { photo: () => ({ readRecipe, setRecipePhoto: () => Promise.reject(new Error('no')) }) },
    });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }, LOAD));
    await user.type(editor.getByRole('textbox', { name: 'Recipe name' }), 'Pane');
    await user.click(editor.getByRole('button', { name: 'Fill this in from a photo' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Use a photo' }));
    await user.click(within(await screen.findByRole('region', { name: 'Recipe from a photo' })).getByRole('button', { name: 'Back' }));
    const back = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(back.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane');
    await waitFor(() => { expect(JSON.stringify(router.state.location.state ?? {})).not.toContain('typedCopy'); });
    expect(back.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane');
  });

  it('the read draft opens the editor once, whole, and the hand-over is empty afterwards', async () => {
    stubCamera();
    let answer: (value: unknown) => void = () => undefined;
    const readRecipe = vi.fn(() => new Promise<unknown>(resolve => { answer = resolve; }));
    const { user } = renderRecipes('/recipes/new', {
      source: fakeRecipesSource({ recipes: [recipe('r1')] }),
      entries: [{ pathname: '/recipes' }, { pathname: '/recipes/new', state: FROM_LIST }],
      session: { location: ON },
      data: { photo: () => ({ readRecipe, setRecipePhoto: () => Promise.reject(new Error('no')) }) },
    });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }, LOAD));
    await user.click(editor.getByRole('button', { name: 'Fill this in from a photo' }));
    const photo = within(await screen.findByRole('region', { name: 'Recipe from a photo' }));
    await user.upload(photo.getByLabelText('Take a photo'), new File(['x'], 'a.jpg', { type: 'image/jpeg' }));
    await photo.findByRole('img');
    await user.click(photo.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(readRecipe).toHaveBeenCalledTimes(1); });
    await act(async () => { answer({ ok: true, recipe: { name: 'Pane', ingredients: [{ label: 'Flour', grams: 500, unit: 'g' }] }, notes: {} }); });
    const opened = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(opened.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane');
    expect((opened.getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[]).map(box => box.value)).toEqual(['Flour']);
    expect(peekHandover()).toBeNull();
  });
});
