import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes } from '../testing/renderRecipes';

// Step 3d-9: the owner's switch for reading a recipe from a photograph — the first card of the label Settings. It asks first
// (and says what the reader costs), the Cloud Function writes, the venue is read again, and a refusal leaves it as it was.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { vi.unstubAllGlobals(); window.localStorage.clear(); });

const GB = { country: 'GB' };

type Call = { resolve: () => void; reject: (error: unknown) => void };

function photoSource() {
  const calls: Call[] = [];
  const setRecipePhoto = vi.fn((_enabled: boolean) => new Promise<unknown>((resolve, reject) => {
    calls.push({ resolve: () => { resolve({ ok: true }); }, reject });
  }));
  const readRecipe = vi.fn(() => Promise.reject(new Error('not in this spec')));
  return { calls, setRecipePhoto, readRecipe };
}

async function openSettings(location: Record<string, unknown> = GB, options: { session?: Record<string, unknown> } = {}) {
  const photo = photoSource();
  const view = renderRecipes('/recipes/settings', {
    source: fakeRecipesSource({ recipes: [recipe('r1')] }),
    session: { location, ...options.session },
    data: { photo: () => photo },
  });
  await screen.findByRole('region', { name: 'Settings' }, LOAD);
  const region = within(screen.getByRole('region', { name: 'Settings' }));
  const photoSwitch = () => region.getByRole('switch', { name: 'Read recipes from a photo' });
  return { ...view, photo, region, photoSwitch };
}

const says = async (text: string) => {
  const node = await screen.findByText(text);
  expect(node.closest('[role="status"]')).not.toBeNull();
};

describe('the switch as the venue shows it', () => {
  it('is the FIRST card, with its name and the note about the cost', async () => {
    const { region } = await openSettings();
    const cards = region.getAllByRole('region');
    expect(cards[0]).toBe(region.getByRole('region', { name: 'Photos' }));
    expect(region.getByText(/Each photo costs a few pence/)).toBeInTheDocument();
  });

  it.each([[undefined], [false], ['true'], [1], [null], [{}]])('⚠️ is OFF unless the venue says a literal true (%s is not)', async recipePhoto => {
    const { photoSwitch } = await openSettings({ ...GB, recipePhoto });
    expect(photoSwitch()).not.toBeChecked();
  });

  it('is ON when the venue says true', async () => {
    const { photoSwitch } = await openSettings({ ...GB, recipePhoto: true });
    expect(photoSwitch()).toBeChecked();
  });

  it('is in Italian with the venue’s language', async () => {
    const photo = photoSource();
    renderRecipes('/recipes/settings', {
      source: fakeRecipesSource({ recipes: [recipe('r1')] }), lang: 'it', session: { location: { ...GB, recipePhoto: true }, language: 'it' },
      data: { photo: () => photo },
    });
    const region = within(await screen.findByRole('region', { name: 'Impostazioni' }, LOAD));
    expect(region.getByRole('switch', { name: 'Leggi le ricette da una foto' })).toBeChecked();
  });

  it('⚠️ is never seen by an employee, who is sent to the list', async () => {
    const photo = photoSource();
    const { router } = renderRecipes('/recipes/settings', {
      source: fakeRecipesSource({ recipes: [recipe('r1')] }),
      session: { location: GB, role: 'staff', canManage: false, isOwner: false },
      data: { photo: () => photo },
    });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(screen.queryByRole('switch', { name: 'Read recipes from a photo' })).not.toBeInTheDocument();
  });
});

describe('turning it on', () => {
  it('asks first, with the cost; Cancel does nothing at all', async () => {
    const { user, photo, photoSwitch, store } = await openSettings();
    await user.click(photoSwitch());
    const dialog = await screen.findByRole('alertdialog', { name: 'Switch this on?' });
    expect(within(dialog).getByText(/Each photo costs a few pence of the reading service — about 200 recipes for a couple of pounds/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(photo.setRecipePhoto).not.toHaveBeenCalled();
    expect(store.refreshLocation).not.toHaveBeenCalled();
    expect(photoSwitch()).not.toBeChecked();
  });

  it('on yes: the function is called, the venue is read again, the switch shows it and the section says so', async () => {
    const { user, photo, photoSwitch, store } = await openSettings();
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Switch this on?' })).getByRole('button', { name: 'Switch on' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalledWith(true); });
    await act(async () => { photo.calls[0]?.resolve(); });
    await waitFor(() => { expect(store.refreshLocation).toHaveBeenCalledTimes(1); });
    // The fake store's refresh changes nothing, as when the server could not be reached: the answer is held here.
    await waitFor(() => { expect(photoSwitch()).toBeChecked(); });
    await says('Reading from a photo is on.');
  });

  it('the call is made BEFORE the venue is read again', async () => {
    const { user, photo, photoSwitch, store } = await openSettings();
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Switch this on?' })).getByRole('button', { name: 'Switch on' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalled(); });
    expect(store.refreshLocation).not.toHaveBeenCalled();
    await act(async () => { photo.calls[0]?.resolve(); });
    await waitFor(() => { expect(store.refreshLocation).toHaveBeenCalled(); });
  });

  it('follows the venue once the session shows the new value', async () => {
    const { user, photo, photoSwitch, store } = await openSettings();
    store.refreshLocation.mockImplementation(() => { store.set({ location: { ...GB, recipePhoto: true } }); return Promise.resolve(); });
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch on' }));
    await act(async () => { photo.calls[0]?.resolve(); });
    await waitFor(() => { expect(photoSwitch()).toBeChecked(); });
    // And then the session leads again: a venue switched off elsewhere shows as off.
    act(() => { store.set({ location: { ...GB, recipePhoto: false } }); });
    await waitFor(() => { expect(photoSwitch()).not.toBeChecked(); });
  });
});

describe('turning it off', () => {
  it('asks its own question and says it is off', async () => {
    const { user, photo, photoSwitch } = await openSettings({ ...GB, recipePhoto: true });
    await user.click(photoSwitch());
    const dialog = await screen.findByRole('alertdialog', { name: 'Switch this off?' });
    expect(within(dialog).getByText(/Nobody in this venue will be able to read a recipe from a photo/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Switch off' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalledWith(false); });
    await act(async () => { photo.calls[0]?.resolve(); });
    await says('Reading from a photo is off.');
    await waitFor(() => { expect(photoSwitch()).not.toBeChecked(); });
  });
});

describe('when the server says no', () => {
  it('says the server’s own words and the switch stays as it was', async () => {
    const { user, photo, photoSwitch, store } = await openSettings();
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch on' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalled(); });
    await act(async () => { photo.calls[0]?.reject(Object.assign(new Error('Only an owner or a manager can change this.'), { code: 'functions/permission-denied' })); });
    await says('Only an owner or a manager can change this.');
    expect(photoSwitch()).not.toBeChecked();
    expect(store.refreshLocation).not.toHaveBeenCalled();
  });

  it.each([['internal'], ['INTERNAL'], ['']])('«%s» is not a reason: the general sentence is said instead', async message => {
    const { user, photo, photoSwitch } = await openSettings({ ...GB, recipePhoto: true });
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch off' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalled(); });
    await act(async () => { photo.calls[0]?.reject(Object.assign(new Error(message), { code: 'functions/internal' })); });
    await says('The photo could not be read. Try again.');
    expect(photoSwitch()).toBeChecked();
  });
});

describe('while the call is in the air', () => {
  it('the switch is busy and ignores taps, and the app is marked busy until the call settles', async () => {
    const { user, photo, photoSwitch, region } = await openSettings();
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch on' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalledTimes(1); });
    expect(isBusy()).toBe(true);
    expect(region.getByRole('region', { name: 'Photos' })).toHaveAttribute('aria-busy', 'true');
    await user.click(photoSwitch());
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(photo.setRecipePhoto).toHaveBeenCalledTimes(1);
    await act(async () => { photo.calls[0]?.resolve(); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('leaving the screen mid-call breaks nothing, and the busy mark is still released', async () => {
    const { user, photo, photoSwitch, region, router } = await openSettings();
    await user.click(photoSwitch());
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Switch on' }));
    await waitFor(() => { expect(photo.setRecipePhoto).toHaveBeenCalled(); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(isBusy()).toBe(true);
    await act(async () => { photo.calls[0]?.resolve(); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
