import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD } from '../testing/renderRecipes';
import { closeBookHost } from './bookPrintHost';
import { open } from './allergenBookRender';
import { BISCOTTO, RECIPES } from './allergenBookFixtures';
import type { StoredDoc } from '../recipes/recipesSource';

// «Prodotti nel libro», the pencil screen (27 Nov 2026): ticks that start from what is stored, nothing written before Save, Save asks
// and writes only what changed, leaving with unsaved ticks asks, and a refused save keeps the ticks.

beforeAll(async () => {
  await import('./AllergenBookSection');
}, 60_000);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  act(() => { closeBookHost(); });
  window.localStorage.clear();
});

const BOOK_PATH = '/allergen-book';

async function openPencil(options: Parameters<typeof open>[0] = {}) {
  const view = open(options);
  const english = options.lang === 'en';
  await view.user.click(await screen.findByRole('button', { name: english ? 'Choose the products' : 'Scegli i prodotti' }, LOAD));
  await screen.findByRole('region', { name: english ? 'Products in the book' : 'Prodotti nel libro' }, LOAD);
  return view;
}

const box = (name: string) => screen.getByRole('checkbox', { name });
const ticked = () => screen.getAllByRole('checkbox').filter(node => (node as HTMLInputElement).checked).map(node => node.getAttribute('aria-labelledby') && document.getElementById(node.getAttribute('aria-labelledby') ?? '')?.textContent);

describe('the pencil screen', () => {
  it('opens from the book with the ticks the stored flags say, the archived ones left out, in the book’s category order', async () => {
    const { router } = await openPencil();
    expect(router.state.location.pathname).toBe('/allergen-book/choose');
    await screen.findByRole('checkbox', { name: 'Pane prova' });
    expect(ticked().sort()).toEqual(['Biscotto test', 'Panino incompleto prova', 'Pane prova', 'Torta della nonna di prova'].sort());
    expect(box('Torta fuori dal libro')).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Torta archiviata di prova' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Prodotti nel libro', 'Biscotti', 'Torte', 'Senza categoria']);
    expect(screen.getByText(/ scelt[io]$| chosen$/)).toHaveTextContent('4 scelti');
  });

  it('says «allergeni incompleti» beside a product whose allergens cannot be declared, and only there', async () => {
    await openPencil();
    await screen.findByRole('checkbox', { name: 'Pane prova' });
    expect(box('Panino incompleto prova')).toHaveAccessibleDescription('allergeni incompleti');
    expect(box('Pane prova')).not.toHaveAccessibleDescription();
    expect(screen.getAllByText('allergeni incompleti')).toHaveLength(1);
  });

  it('writes nothing before Save; Save asks, writes only the changed products and goes back to the book', async () => {
    const { user, source, router } = await openPencil();
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    await user.click(box('Pane prova'));
    expect(screen.getByText(/ scelt[io]$| chosen$/)).toHaveTextContent('4 scelti');
    expect(source.recipeWrites).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    const question = await screen.findByRole('alertdialog', { name: 'Salvare i prodotti del libro?' });
    expect(question).toHaveTextContent('Il libro avrà 4 prodotti.');
    await user.click(within(question).getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(2); });
    const writes = Object.fromEntries(source.recipeWrites.map(write => [write.id, write.data]));
    expect(writes).toEqual({ fuori: { inBook: true }, pane: { inBook: null } });
    // The book again (the pencil's own rows are gone): the added product is one of its articles.
    await waitFor(() => { expect(screen.queryAllByRole('article').map(a => a.querySelector('p')?.textContent)).toContain('Torta fuori dal libro'); });
    expect(screen.queryByText('Pane prova')).not.toBeInTheDocument();
  });

  it('Save with nothing changed just leaves, asking and writing nothing', async () => {
    const { user, source, router } = await openPencil();
    await screen.findByRole('checkbox', { name: 'Pane prova' });
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
  });

  it('Back with nothing changed leaves without asking', async () => {
    const { user, router } = await openPencil();
    await screen.findByRole('checkbox', { name: 'Pane prova' });
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
  });

  it('Back with changes asks to discard: Cancel stays with the ticks, Discard leaves and writes nothing', async () => {
    const { user, source, router } = await openPencil();
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    const question = await screen.findByRole('alertdialog', { name: 'Vuoi scartare le modifiche?' });
    expect(question).toHaveTextContent('I prodotti che hai spuntato o tolto non saranno salvati.');
    await user.click(within(question).getByRole('button', { name: 'Annulla' }));
    expect(router.state.location.pathname).toBe('/allergen-book/choose');
    expect(box('Torta fuori dal libro')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Scarta' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    expect(source.recipeWrites).toEqual([]);
  });

  it('leaving by the rail with changes asks too', async () => {
    const { user, router } = await openPencil();
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    await user.click(within(screen.getByRole('navigation', { name: 'Tutte le sezioni' })).getByRole('link', { name: 'Ricette' }));
    expect(await screen.findByRole('alertdialog', { name: 'Vuoi scartare le modifiche?' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/allergen-book/choose');
  });

  it('search narrows the list without losing a tick already made', async () => {
    const { user } = await openPencil();
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    await user.type(screen.getByRole('searchbox', { name: 'Cerca una ricetta per nome' }), 'pane');
    expect(screen.queryByRole('checkbox', { name: 'Torta fuori dal libro' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Pane prova' })).toBeInTheDocument();
    expect(screen.getByText(/ scelt[io]$| chosen$/)).toHaveTextContent('5 scelti');
    await user.clear(screen.getByRole('searchbox', { name: 'Cerca una ricetta per nome' }));
    expect(box('Torta fuori dal libro')).toBeChecked();
    await user.type(screen.getByRole('searchbox', { name: 'Cerca una ricetta per nome' }), 'zzz');
    expect(screen.getByText('Nessuna ricetta corrisponde alla ricerca.')).toBeInTheDocument();
  });

  it('a refused save keeps the ticks: the message is said, and the pencil reopens from them, ready to save again', async () => {
    const { user, source, router } = await openPencil();
    source.refuseRecipeWrites.save = true;
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    expect(await screen.findByText(/Non è stato possibile salvare i prodotti del libro/)).toBeInTheDocument();
    expect(source.recipeWrites).toEqual([]);
    // Put back: the book does not show the refused product.
    await waitFor(() => { expect(screen.queryByText('Torta fuori dal libro')).not.toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: 'Scegli i prodotti' }));
    await screen.findByRole('region', { name: 'Prodotti nel libro' });
    expect(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' })).toBeChecked();
    // Dirty from the start: Back asks.
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    expect(await screen.findByRole('alertdialog', { name: 'Vuoi scartare le modifiche?' })).toBeInTheDocument();
  });

  it('speaks English in an English interface', async () => {
    await openPencil({ lang: 'en', country: 'GB' });
    expect(await screen.findByRole('checkbox', { name: 'Pane prova' })).toBeChecked();
    expect(screen.getByText(/ scelt[io]$| chosen$/)).toHaveTextContent('4 chosen');
    expect(screen.getByText('allergens incomplete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('⚠️ waits for the server before copying, and never removes a product a colleague added meanwhile', async () => {
    // The phone's own copy still says the cake is OUT; the server then says it is IN (a colleague put it there).
    const local = RECIPES.map(recipe => (recipe.id === 'torta' ? { ...recipe, inBook: undefined } : recipe)) as StoredDoc[];
    const { user, source } = open({ prepare: held => { held.hold(); } });
    await user.click(await screen.findByRole('button', { name: 'Scegli i prodotti' }, LOAD));
    await screen.findByRole('region', { name: 'Prodotti nel libro' }, LOAD);
    act(() => { source.pushRecipes(false, local); });
    expect(await screen.findByText('Caricamento…', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    act(() => { source.pushRecipes(true); });
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }, LOAD));
    expect(box('Torta della nonna di prova')).toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites).toEqual([{ id: 'fuori', data: { inBook: true } }]);
  });

  it('a product the person did not touch is never written, even if it changed in the meantime', async () => {
    const { user, source } = await openPencil();
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    // A colleague takes the biscuit out of the book after the copy was made: it is still ticked here, but the person did not touch it.
    act(() => {
      source.recipes.set('biscotto', { ...(BISCOTTO as StoredDoc), inBook: undefined } as StoredDoc);
      source.push();
    });
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(source.recipeWrites).toHaveLength(1); });
    expect(source.recipeWrites.map(write => write.id)).toEqual(['fuori']);
  });

  it('the refused choices come back once: untick the refused one, leave, reopen: it is not ticked and the screen is not dirty', async () => {
    const { user, source, router } = await openPencil();
    source.refuseRecipeWrites.save = true;
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    await waitFor(() => { expect(screen.queryByText('Torta fuori dal libro')).not.toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: 'Scegli i prodotti' }));
    await user.click(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' }));
    expect(box('Torta fuori dal libro')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Salva' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Scegli i prodotti' }));
    expect(await screen.findByRole('checkbox', { name: 'Torta fuori dal libro' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe(BOOK_PATH); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
