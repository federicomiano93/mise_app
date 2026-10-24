import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { en } from '../i18n/en';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes, split } from '../testing/renderRecipes';
import { forgetHandover, hasHandover } from './photoCarry';
import { FROM_LIST } from './recipesNav';

// Step 3d-9: reading a recipe from photographs — the button in the new-recipe editor, the photo screen, and the draft that
// opens in the ordinary editor. NOTHING IS SAVED BY A READ. jsdom has no canvas and no createImageBitmap: both are stubbed.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

// Every read a test left in the air: settled at the end of the test, or its busy mark would outlive it and colour the next one.
const inTheAir: Answer[] = [];

beforeEach(() => { window.localStorage.clear(); forgetHandover(); });
afterEach(async () => {
  await act(async () => { inTheAir.splice(0).forEach(call => { call.reject(new Error('the test is over')); }); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const ON = { country: 'GB', recipePhoto: true };
const OFF = { country: 'GB' };
const FOCACCIA = recipe('r1', { name: 'Focaccia' });

const DRAFT = {
  name: 'Pane toscano',
  ingredients: [{ label: 'Flour', grams: 1000, unit: 'g' }, { label: 'Water', grams: 700, unit: 'g' }],
  netWeightG: 500,
};

type Answer = { resolve: (value: unknown) => void; reject: (error: unknown) => void; images: unknown };

function reader() {
  const calls: Answer[] = [];
  const readRecipe = vi.fn((images: unknown) => new Promise<unknown>((resolve, reject) => {
    const call = { resolve, reject, images };
    calls.push(call);
    inTheAir.push(call);
  }));
  const setRecipePhoto = vi.fn(() => Promise.reject(new Error('not in this spec')));
  return { calls, readRecipe, setRecipePhoto };
}

// A device with a camera that can decode: every photograph is 4000 x 3000 and weighs a few bytes.
function stubCamera({ decodes = true, bytes = 1000 } = {}) {
  vi.stubGlobal('createImageBitmap', vi.fn(async () => {
    if (!decodes) throw new Error('cannot decode');
    return { width: 4000, height: 3000, close: () => undefined } as unknown as ImageBitmap;
  }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: () => undefined }) as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(() => `data:image/jpeg;base64,${'A'.repeat(bytes)}`);
}

const file = (name = 'recipe.jpg') => new File(['x'], name, { type: 'image/jpeg' });

type Opened = Awaited<ReturnType<typeof openEditor>>;

// The new-recipe editor, reached from the list (so there is an entry behind it, as when the button was pressed).
async function openEditor(location: Record<string, unknown> = ON, options: { session?: Record<string, unknown> } = {}) {
  const photo = reader();
  const source = fakeRecipesSource({ recipes: [FOCACCIA] });
  const view = renderRecipes('/recipes/new', {
    source,
    entries: [{ pathname: '/recipes' }, { pathname: '/recipes/new', state: FROM_LIST }],
    session: { location, ...options.session },
    data: { photo: () => photo },
  });
  const region = await screen.findByRole('region', { name: 'New recipe' }, LOAD);
  return { ...view, photo, source, region: within(region) };
}

async function openPhotoByAddress(location: Record<string, unknown> = ON) {
  const photo = reader();
  const source = fakeRecipesSource({ recipes: [FOCACCIA] });
  const view = renderRecipes('/recipes/photo', { source, session: { location }, data: { photo: () => photo } });
  const region = await screen.findByRole('region', { name: 'Recipe from a photo' }, LOAD);
  return { ...view, photo, source, region: within(region) };
}

const fillButton = (region: ReturnType<typeof within>) => region.getByRole('button', { name: 'Fill this in from a photo' });

// From the editor to the photo screen, with nothing typed.
async function toPhotoScreen(opened: Opened) {
  await opened.user.click(fillButton(opened.region));
  const region = within(await screen.findByRole('region', { name: 'Recipe from a photo' }));
  return region;
}

const takeInput = (region: ReturnType<typeof within>, name = 'Take a photo') => region.getByLabelText(name) as HTMLInputElement;
const says = (region: ReturnType<typeof within>) => region.getByRole('status');

describe('«Fill this in from a photo» in the editor', () => {
  it('is on a NEW recipe of a venue with the reader on, and LAST on the page', async () => {
    const { region } = await openEditor();
    const button = fillButton(region);
    const all = region.getAllByRole('button');
    expect(all[all.length - 1]).toBe(button);
    // After the form, not between the name and the rows.
    const addIngredient = region.getByRole('button', { name: '+ Add ingredient' });
    expect(addIngredient.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it.each([
    ['is not there when the venue has not switched the reader on', OFF],
    ['⚠️ is not there for a string «true»', { country: 'GB', recipePhoto: 'true' }],
    ['is not there for a 1', { country: 'GB', recipePhoto: 1 }],
  ])('%s', async (_name, location) => {
    const { region } = await openEditor(location);
    expect(region.queryByRole('button', { name: 'Fill this in from a photo' })).not.toBeInTheDocument();
  });

  it('is not there on an EXISTING recipe’s editor', async () => {
    const photo = reader();
    renderRecipes('/recipes/r1/edit', { source: fakeRecipesSource({ recipes: [FOCACCIA] }), session: { location: ON }, data: { photo: () => photo } });
    const region = within(await screen.findByRole('region', { name: 'Edit recipe' }, LOAD));
    await region.findByRole('textbox', { name: 'Recipe name' });
    expect(region.queryByRole('button', { name: 'Fill this in from a photo' })).not.toBeInTheDocument();
  });

  it('goes straight to the photo screen when nothing has been typed, one level down', async () => {
    const opened = await openEditor();
    await toPhotoScreen(opened);
    expect(opened.router.state.location.pathname).toBe('/recipes/photo');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('asks first when something has been typed, and Cancel stays on the form with the typing', async () => {
    const opened = await openEditor();
    await opened.user.type(opened.region.getByRole('textbox', { name: 'Recipe name' }), 'Pane');
    await opened.user.click(fillButton(opened.region));
    const dialog = await screen.findByRole('alertdialog', { name: 'Start from a photo?' });
    expect(within(dialog).getByText('What you have typed here will be replaced by what the photo says.')).toBeInTheDocument();
    await opened.user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(opened.router.state.location.pathname).toBe('/recipes/new');
    expect(opened.region.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane');
  });

  it('⚠️ Back from the photo screen brings the form back WITH what had been typed, once', async () => {
    const opened = await openEditor();
    await opened.user.type(opened.region.getByRole('textbox', { name: 'Recipe name' }), 'Pane');
    await opened.user.click(fillButton(opened.region));
    await opened.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Use a photo' }));
    const photoRegion = await screen.findByRole('region', { name: 'Recipe from a photo' });
    expect(opened.router.state.location.pathname).toBe('/recipes/photo');
    await opened.user.click(within(photoRegion).getByRole('button', { name: 'Back' }));
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane');
    expect(opened.router.state.location.pathname).toBe('/recipes/new');
    // Once: the copy is taken off the history entry as soon as the form has it.
    await waitFor(() => { expect(JSON.stringify(opened.router.state.location.state ?? {})).not.toContain('typedCopy'); });
    // It is unsaved work again: leaving asks.
    await opened.user.click(editor.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });

  it('⚠️ the PHONE’S back gesture (the router’s Back) brings the typed copy back too', async () => {
    const opened = await openEditor();
    await opened.user.type(opened.region.getByRole('textbox', { name: 'Recipe name' }), 'Schiacciata');
    await opened.user.click(fillButton(opened.region));
    await opened.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Use a photo' }));
    await screen.findByRole('region', { name: 'Recipe from a photo' });
    await act(async () => { await opened.router.navigate(-1); });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Schiacciata');
  });

  it('with nothing typed, Back from the photo screen is a plain empty form', async () => {
    const opened = await openEditor();
    const photoRegion = await toPhotoScreen(opened);
    await opened.user.click(photoRegion.getByRole('button', { name: 'Back' }));
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('');
    // Not dirty: leaving asks nothing.
    await opened.user.click(editor.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(opened.router.state.location.pathname).toBe('/recipes'); });
  });
});

describe('the photo screen: the gate', () => {
  it('⚠️ a venue without the reader is sent to the list when the address is typed (and it is a replace)', async () => {
    const photo = reader();
    const { router } = renderRecipes('/recipes/photo', { source: fakeRecipesSource({ recipes: [FOCACCIA] }), session: { location: OFF }, data: { photo: () => photo } });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'Recipe from a photo' })).not.toBeInTheDocument();
  });

  it('is drawn for an employee of a venue with the reader on (only the SWITCH is for whoever runs the place)', async () => {
    const photo = reader();
    renderRecipes('/recipes/photo', {
      source: fakeRecipesSource({ recipes: [FOCACCIA] }), session: { location: ON, role: 'staff', canManage: false, isOwner: false }, data: { photo: () => photo },
    });
    expect(await screen.findByRole('region', { name: 'Recipe from a photo' }, LOAD)).toBeInTheDocument();
  });

  it('is the right-hand pane on the split, beside the list', async () => {
    split();
    await openPhotoByAddress();
    expect(screen.getByRole('button', { name: 'Focaccia' })).toBeInTheDocument();
  });

  it('opened by its address, Back replaces itself with the list', async () => {
    const { router, user, region } = await openPhotoByAddress();
    await user.click(region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
  });
});

describe('the photo screen: taking photographs', () => {
  it('says what it is, takes nothing until a photo is chosen, and cannot read with none', async () => {
    stubCamera();
    const { region } = await openPhotoByAddress();
    expect(region.getByText(/Photograph the recipe and the app will fill it in for you/)).toBeInTheDocument();
    expect(region.getByText(/Check every amount before you save/)).toBeInTheDocument();
    expect(region.getByRole('button', { name: 'Read the recipe' })).toBeDisabled();
    expect(region.queryByRole('img')).not.toBeInTheDocument();
  });

  it('the picker is a real file input for the camera, images only, behind a button-looking label', async () => {
    stubCamera();
    const { region } = await openPhotoByAddress();
    const input = takeInput(region);
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/jpeg,image/png,image/webp');
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input).not.toHaveAttribute('aria-hidden');
    expect(input).not.toHaveAttribute('tabindex', '-1');
  });

  it('a chosen photo becomes a thumbnail from a data URL, and the button now says «Add another photo»', async () => {
    stubCamera();
    const { user, region } = await openPhotoByAddress();
    await user.upload(takeInput(region), file());
    const thumb = await region.findByRole('img', { name: 'The photo you took' });
    expect(thumb.getAttribute('src')).toMatch(/^data:image\/jpeg;base64,/);
    expect(region.getByLabelText('Add another photo')).toBeInTheDocument();
    expect(region.getByRole('button', { name: 'Read the recipe' })).toBeEnabled();
  });

  it('takes up to five and refuses the sixth with its sentence', async () => {
    stubCamera();
    const { user, region } = await openPhotoByAddress();
    await user.upload(takeInput(region), Array.from({ length: 7 }, (_, i) => file(`p${i}.jpg`)));
    await waitFor(() => { expect(region.getAllByRole('img')).toHaveLength(5); });
    expect(says(region)).toHaveTextContent(en['cat.photo.err.tooMany']);
    expect(takeInput(region, 'Add another photo')).toBeDisabled();
  });

  it('removes a photo, which gives the room back', async () => {
    stubCamera();
    const { user, region } = await openPhotoByAddress();
    await user.upload(takeInput(region), [file('a.jpg'), file('b.jpg')]);
    await waitFor(() => { expect(region.getAllByRole('img')).toHaveLength(2); });
    await user.click(region.getAllByRole('button', { name: 'Remove this photo' })[0] as HTMLElement);
    expect(region.getAllByRole('img')).toHaveLength(1);
    await user.click(region.getByRole('button', { name: 'Remove this photo' }));
    expect(region.queryByRole('img')).not.toBeInTheDocument();
    expect(region.getByLabelText('Take a photo')).toBeInTheDocument();
    expect(region.getByRole('button', { name: 'Read the recipe' })).toBeDisabled();
  });

  it('a photo the browser cannot decode (HEIC) says so, and nothing is added', async () => {
    stubCamera({ decodes: false });
    const { user, region } = await openPhotoByAddress();
    await user.upload(takeInput(region), file('IMG.heic'));
    await waitFor(() => { expect(says(region)).toHaveTextContent(en['cat.photo.err.badFormat']); });
    expect(region.queryByRole('img')).not.toBeInTheDocument();
  });

  it('a photo that could not be prepared says that', async () => {
    stubCamera();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const { user, region } = await openPhotoByAddress();
    await user.upload(takeInput(region), file());
    await waitFor(() => { expect(says(region)).toHaveTextContent(en['cat.photo.err.badImage']); });
  });

  it('the live region is on the page BEFORE it speaks', async () => {
    stubCamera({ decodes: false });
    const { user, region } = await openPhotoByAddress();
    const live = says(region);
    expect(live).toHaveTextContent('');
    await user.upload(takeInput(region), file());
    await waitFor(() => { expect(live).toHaveTextContent(en['cat.photo.err.badFormat']); });
    expect(says(region)).toBe(live);
  });
});

describe('the photo screen: reading', () => {
  async function withOnePhoto(options: { bytes?: number } = {}) {
    stubCamera(options);
    const opened = await openPhotoByAddress();
    await opened.user.upload(takeInput(opened.region), file());
    await opened.region.findByRole('img');
    return opened;
  }

  it('⚠️ offline says so and makes NO call', async () => {
    const opened = await withOnePhoto();
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    expect(says(opened.region)).toHaveTextContent(en['cat.photo.err.offline']);
    expect(opened.photo.readRecipe).not.toHaveBeenCalled();
    expect(isBusy()).toBe(false);
  });

  it('a payload the server would refuse is refused here, with no call', async () => {
    const opened = await withOnePhoto({ bytes: 3_000_000 });
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    expect(says(opened.region)).toHaveTextContent(en['cat.photo.err.tooLarge']);
    expect(opened.photo.readRecipe).not.toHaveBeenCalled();
  });

  it('sends the photographs as media type and base64, without the data: prefix', async () => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalledTimes(1); });
    expect(opened.photo.calls[0]?.images).toEqual([{ mediaType: 'image/jpeg', data: 'A'.repeat(1000) }]);
  });

  it('while the call is in the air the screen is busy, the app is marked busy, and the buttons are inert', async () => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    expect(screen.getByRole('region', { name: 'Recipe from a photo' })).toHaveAttribute('aria-busy', 'true');
    expect(isBusy()).toBe(true);
    expect(says(opened.region)).toHaveTextContent(en['cat.photo.working']);
    const reading = opened.region.getByRole('button', { name: 'Reading…' });
    expect(reading).toBeDisabled();
    expect(takeInput(opened.region, 'Add another photo')).toBeDisabled();
    expect(opened.region.getByRole('button', { name: 'Remove this photo' })).toBeDisabled();
    await act(async () => { opened.photo.calls[0]?.reject(new Error('stop')); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(screen.getByRole('region', { name: 'Recipe from a photo' })).not.toHaveAttribute('aria-busy');
  });

  it('a second press while the call is in the air sends nothing more', async () => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    await opened.user.click(opened.region.getByRole('button', { name: 'Reading…' }));
    expect(opened.photo.readRecipe).toHaveBeenCalledTimes(1);
  });

  it('⚠️ leaving the screen mid-call keeps the app busy until the call settles, then opens and sets nothing', async () => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await opened.user.click(opened.region.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(opened.router.state.location.pathname).toBe('/recipes'); });
    expect(isBusy()).toBe(true);
    await act(async () => { opened.photo.calls[0]?.resolve({ ok: true, recipe: DRAFT, notes: {} }); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
    expect(opened.router.state.location.pathname).toBe('/recipes');
    expect(hasHandover()).toBe(false);
    expect(errors).not.toHaveBeenCalled();
  });

  // Every code the server can send, and what the screen says: the table's own sentences.
  it.each([
    ['signed-out', 'cat.photo.err.signedOut'],
    ['no-location', 'cat.photo.err.failed'],
    ['not-allowed', 'cat.photo.err.notAllowed'],
    ['person-limit', 'cat.photo.err.personLimit'],
    ['venue-limit', 'cat.photo.err.venueLimit'],
    ['photo-off', 'cat.photo.err.photoOff'],
    ['read-failed', 'cat.photo.err.failed'],
    ['too-slow', 'cat.photo.err.tooSlow'],
    ['bad-image', 'cat.photo.err.badImage'],
    ['too-many-images', 'cat.photo.err.tooMany'],
    ['image-too-large', 'cat.photo.err.tooLarge'],
    ['images-too-large', 'cat.photo.err.tooLarge'],
    ['no-images', 'cat.photo.err.noImages'],
    ['offline', 'cat.photo.err.offline'],
  ] as const)('a refused call («%s») says its sentence and the photographs are kept', async (code, key) => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    await act(async () => { opened.photo.calls[0]?.reject({ code: 'functions/failed-precondition', message: 'x', details: { key: code } }); });
    await waitFor(() => { expect(says(opened.region)).toHaveTextContent(en[key]); });
    expect(opened.region.getAllByRole('img')).toHaveLength(1);
    expect(opened.region.getByRole('button', { name: 'Read the recipe' })).toBeEnabled();
    expect(opened.source.recipeWrites).toEqual([]);
  });

  it.each([
    ['functions/unauthenticated', 'cat.photo.err.signedOut'],
    ['functions/permission-denied', 'cat.photo.err.notAllowed'],
    ['functions/resource-exhausted', 'cat.photo.err.personLimit'],
    ['functions/unavailable', 'cat.photo.err.offline'],
    ['functions/deadline-exceeded', 'cat.photo.err.tooSlow'],
    ['functions/internal', 'cat.photo.err.failed'],
  ] as const)('a call that failed with «%s» says its sentence', async (code, key) => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    await act(async () => { opened.photo.calls[0]?.reject({ code, message: 'x' }); });
    await waitFor(() => { expect(says(opened.region)).toHaveTextContent(en[key]); });
  });

  // The call WORKED: these are answers, not failures — each has its own sentence.
  it.each([
    ['nothing-readable', 'cat.photo.err.nothingFound'],
    ['no-tool', 'cat.photo.err.nothingFound'],
    ['refused', 'cat.photo.err.refused'],
    ['truncated', 'cat.photo.err.tooLong'],
    ['something-new', 'cat.photo.err.nothingFound'],
  ] as const)('an answer «%s» (nothing to use) says its sentence and opens nothing', async (reason, key) => {
    const opened = await withOnePhoto();
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    await act(async () => { opened.photo.calls[0]?.resolve({ ok: false, reason }); });
    await waitFor(() => { expect(says(opened.region)).toHaveTextContent(en[key]); });
    expect(opened.router.state.location.pathname).toBe('/recipes/photo');
    expect(hasHandover()).toBe(false);
  });
});

describe('the photo screen: a successful read', () => {
  async function readFromEditor(options: { typed?: string; answer?: unknown } = {}) {
    stubCamera();
    const opened = await openEditor();
    if (options.typed !== undefined) {
      await opened.user.type(opened.region.getByRole('textbox', { name: 'Recipe name' }), options.typed);
      await opened.user.click(fillButton(opened.region));
      await opened.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Use a photo' }));
    } else {
      await opened.user.click(fillButton(opened.region));
    }
    const photoRegion = within(await screen.findByRole('region', { name: 'Recipe from a photo' }));
    await opened.user.upload(takeInput(photoRegion), file());
    await photoRegion.findByRole('img');
    await opened.user.click(photoRegion.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    await act(async () => { opened.photo.calls[0]?.resolve(options.answer ?? { ok: true, recipe: DRAFT, notes: {}, remaining: 30 }); });
    return opened;
  }

  it('⚠️ opens the ordinary new-recipe editor with the draft — and SAVES NOTHING', async () => {
    const opened = await readFromEditor();
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane toscano');
    const names = editor.getAllByRole('combobox', { name: 'Ingredient name' }) as HTMLInputElement[];
    expect(names.map(box => box.value)).toEqual(['Flour', 'Water']);
    expect((editor.getAllByRole('spinbutton', { name: 'Amount' }) as HTMLInputElement[]).map(box => box.value)).toEqual(['1000', '700']);
    expect(opened.router.state.location.pathname).toBe('/recipes/new');
    expect(opened.source.recipeWrites).toEqual([]);
    expect(hasHandover()).toBe(false);
  });

  it('⚠️ the editor STARTS DIRTY: the app is busy, and leaving asks', async () => {
    const opened = await readFromEditor();
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await opened.user.click(editor.getByRole('button', { name: 'Back' }));
    expect(await screen.findByRole('alertdialog', { name: 'Discard changes?' })).toBeInTheDocument();
  });

  it('Save asks the same «Save recipe?» as a recipe typed by hand, and only then writes', async () => {
    const opened = await readFromEditor();
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    await opened.user.click(editor.getByRole('button', { name: 'Save' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Save recipe?' });
    expect(opened.source.recipeWrites).toEqual([]);
    await opened.user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(opened.source.recipeWrites).toHaveLength(1); });
    expect(opened.source.recipeWrites[0]?.data).toMatchObject({ name: 'Pane toscano', netWeightG: 500 });
    expect(opened.source.recipeWrites[0]?.data).not.toHaveProperty('lossPct');
  });

  it('⚠️ leaves exactly ONE editor entry in the history: Back from it is the list, not the typed copy or the photo screen', async () => {
    const opened = await readFromEditor({ typed: 'Typed before' });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane toscano');
    await opened.user.click(editor.getByRole('button', { name: 'Back' }));
    await opened.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(opened.router.state.location.pathname).toBe('/recipes'); });
    // And the browser's Back from the list leaves the catalogue: nothing of the photo trip is left behind it.
    expect(JSON.stringify(opened.router.state.location.state ?? {})).not.toContain('typedCopy');
  });

  it('the draft replaces what had been typed (the typed copy is not mixed in)', async () => {
    await readFromEditor({ typed: 'Typed before' });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane toscano');
    expect(editor.queryByDisplayValue('Typed before')).not.toBeInTheDocument();
  });

  it('says that only the first rows were kept when the answer says the list was capped', async () => {
    await readFromEditor({ answer: { ok: true, recipe: DRAFT, notes: { rowsCapped: true } } });
    await screen.findByRole('region', { name: 'New recipe' });
    const node = await screen.findByText(en['cat.photo.capped']);
    expect(node.closest('[role="status"]')).not.toBeNull();
  });

  it('says nothing about a cap when there was none', async () => {
    await readFromEditor();
    await screen.findByRole('region', { name: 'New recipe' });
    expect(screen.queryByText(en['cat.photo.capped'])).not.toBeInTheDocument();
  });

  it('a draft with no rows still has one empty row to type into', async () => {
    await readFromEditor({ answer: { ok: true, recipe: { name: 'Empty', ingredients: [] }, notes: {} } });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getAllByRole('combobox', { name: 'Ingredient name' })).toHaveLength(1);
  });

  it('opened by its address (no editor behind), the read REPLACES the photo screen with the editor holding the draft', async () => {
    stubCamera();
    const opened = await openPhotoByAddress();
    await opened.user.upload(takeInput(opened.region), file());
    await opened.region.findByRole('img');
    await opened.user.click(opened.region.getByRole('button', { name: 'Read the recipe' }));
    await waitFor(() => { expect(opened.photo.readRecipe).toHaveBeenCalled(); });
    await act(async () => { opened.photo.calls[0]?.resolve({ ok: true, recipe: DRAFT, notes: {} }); });
    const editor = within(await screen.findByRole('region', { name: 'New recipe' }));
    expect(editor.getByRole('textbox', { name: 'Recipe name' })).toHaveValue('Pane toscano');
    expect(opened.router.state.historyAction).toBe('REPLACE');
    await opened.user.click(editor.getByRole('button', { name: 'Back' }));
    await opened.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    await waitFor(() => { expect(opened.router.state.location.pathname).toBe('/recipes'); });
  });
});
