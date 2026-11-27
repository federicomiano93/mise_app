import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { LOAD } from '../testing/renderRecipes';
import type { StoredDoc } from '../recipes/recipesSource';
import { closeBookHost } from './bookPrintHost';
import { RECIPES, TORTA } from './allergenBookFixtures';
import { open, type Who } from './allergenBookRender';

// The allergen book's screen (27 Nov 2026): who sees the pencil and Print, what is on the page, in which order, and the label's own
// refusals. The pencil screen is in AllergenBookSection.choose.spec.tsx, the paper in AllergenBookSection.print.spec.tsx, who is shown
// the section in AllergenBook.visibility.spec.tsx.

beforeAll(async () => {
  await import('./AllergenBookSection');
  await import('../recipes/RecipesSection');
}, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => {
  act(() => { closeBookHost(); });
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const articleNames = () => screen.getAllByRole('article').map(article => article.querySelector('p')?.textContent);

describe('who sees the pencil and Print', () => {
  it.each<[Who]>([['owner'], ['manager'], ['owner-kitchen']])('a %s has both, named in words', async who => {
    open({ who });
    expect(await screen.findByRole('button', { name: 'Scegli i prodotti' }, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stampa' })).toBeInTheDocument();
  });

  it('an employee reads the book and has neither', async () => {
    open({ who: 'staff' });
    await screen.findByText('Pane prova', undefined, LOAD);
    expect(screen.queryByRole('button', { name: 'Scegli i prodotti' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stampa' })).not.toBeInTheDocument();
  });

  it('an employee sent to the pencil address is sent back to the book', async () => {
    const { router } = open({ who: 'staff', path: '/allergen-book/choose' });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/allergen-book'); });
    expect(await screen.findByText('Pane prova', undefined, LOAD)).toBeInTheDocument();
  });

  it('a junk address goes back to the book', async () => {
    const { router } = open({ path: '/allergen-book/nonsense' });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/allergen-book'); });
  });

  it('the buttons keep their words in the DOM as their name (icons alone on a phone, words drawn from 700px by the stylesheet)', async () => {
    open();
    const pencil = await screen.findByRole('button', { name: 'Scegli i prodotti' }, LOAD);
    expect(pencil).not.toHaveAttribute('aria-label');
    expect(pencil.querySelector('.visually-hidden')?.textContent).toBe('Scegli i prodotti');
    expect(screen.getByRole('button', { name: 'Stampa' })).not.toHaveAttribute('aria-label');
  });
});

describe('the book', () => {
  it('shows the products by category as the Recipe book orders them, the incomplete ones apart on top, the archived ones nowhere', async () => {
    open();
    await screen.findByText('Pane prova', undefined, LOAD);
    expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Da completare · 1', 'Biscotti', 'Torte', 'Senza categoria']);
    expect(articleNames()).toEqual(['Biscotto test', 'Torta della nonna di prova', 'Pane prova']);
    expect(screen.queryByText('Torta archiviata di prova')).not.toBeInTheDocument();
    expect(screen.queryByText('Torta fuori dal libro')).not.toBeInTheDocument();
    // Four products count: the archived one does not.
    expect(screen.getByText('4 prodotti nel libro')).toBeInTheDocument();
  });

  it('puts an incomplete product in the red block with the label’s own reason, once, and not among the others', async () => {
    const { router, user } = open();
    const todo = await screen.findByRole('region', { name: 'Da completare · 1' }, LOAD);
    // The label's own sentence for a recipe with a row nobody has declared.
    expect(within(todo).getByRole('button', { name: /Panino incompleto prova/ })).toHaveTextContent('1 ingrediente non è dichiarato.');
    expect(screen.getAllByText('Panino incompleto prova')).toHaveLength(1);
    await user.click(within(todo).getByRole('button', { name: /Panino incompleto prova/ }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes/incompleto'); });
  });

  it('draws the allergens in bold, with the words the label composes, in the venue’s country’s language', async () => {
    open();
    const article = (await screen.findByText('Torta della nonna di prova', undefined, LOAD)).closest('article');
    expect(article).not.toBeNull();
    const card = within(article as HTMLElement);
    expect(card.getByText(/^Ingredienti:/)).toBeInTheDocument();
    const bold = [...(article as HTMLElement).querySelectorAll('strong')].map(node => node.textContent);
    expect(bold.length).toBeGreaterThan(0);
    expect((article as HTMLElement).textContent).toMatch(/Contiene/);
  });

  it('a hand-typed ingredients text is used', async () => {
    const typed = { id: 'torta', name: 'Torta della nonna di prova', category: 'Torte', inBook: true, labelIngredientsText: 'Farina di FRUMENTO, zucchero.', ingredients: [{ label: 'Farina', grams: 300, unit: 'g', refId: 'flour' }] } as StoredDoc;
    open({ recipes: [typed] });
    const article = (await screen.findByText('Torta della nonna di prova', undefined, LOAD)).closest('article') as HTMLElement;
    expect(article.textContent).toContain('Ingredienti: Farina di FRUMENTO, zucchero.');
    expect(article.querySelector('strong')?.textContent).toBe('FRUMENTO');
  });

  it('says so, quietly, under a product whose typed text has mistakes, and shows the composed line', async () => {
    const typed = { id: 'torta', name: 'Torta della nonna di prova', category: 'Torte', inBook: true, labelIngredientsText: 'farina di grano.', ingredients: [{ label: 'Farina', grams: 300, unit: 'g', refId: 'flour' }] } as StoredDoc;
    open({ recipes: [typed] });
    const article = (await screen.findByText('Torta della nonna di prova', undefined, LOAD)).closest('article') as HTMLElement;
    expect(article.textContent).not.toContain('farina di grano');
    expect(screen.getByText(/Il testo dell’etichetta scritto a mano ha degli errori/)).toBeInTheDocument();
  });

  it('uses the hand-typed label name when there is one', async () => {
    const named = { id: 'torta', name: 'Torta della nonna di prova', inBook: true, labelName: 'Torta nonna', ingredients: [{ label: 'Farina', grams: 300, unit: 'g', refId: 'flour' }] } as StoredDoc;
    open({ recipes: [named] });
    expect(await screen.findByText('Torta nonna', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the empty book and the label’s own refusals', () => {
  it('tells whoever runs the place where to tap, and an employee that nothing was chosen', async () => {
    open({ recipes: [RECIPES[4] as StoredDoc] });
    expect(await screen.findByText(/Tocca la matita, «Scegli i prodotti»/, undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stampa' })).toBeDisabled();
  });

  it('an employee’s empty book', async () => {
    open({ who: 'staff', recipes: [RECIPES[4] as StoredDoc] });
    expect(await screen.findByText('Non è ancora stato scelto nessun prodotto per il libro.', undefined, LOAD)).toBeInTheDocument();
  });

  it('allergens switched off: the label’s refusal, Print off', async () => {
    open({ location: { showAllergens: false } });
    expect(await screen.findByText('Non si può fare nessuna etichetta', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(/Questo locale non gestisce gli allergeni/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stampa' })).toBeDisabled();
  });

  it('no country: the label’s refusal, Print off', async () => {
    open({ country: null });
    await screen.findByRole('heading', { level: 1, name: 'Libro allergeni' }, LOAD);
    expect(await screen.findByText(/nessuno ha detto in che paese vende/)).toBeInTheDocument();
    expect(main().queryByText('Pane prova')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stampa' })).toBeDisabled();
  });
});

describe('an ingredient list that cannot be read', () => {
  it('says so with the recipe screens’ sentence instead of listing every product as incomplete, and Print is off', async () => {
    open({ prepare: source => { source.refuse.ingredients = true; } });
    expect(await screen.findByText('Non riesco a leggere l’elenco degli ingredienti, quindi non posso controllare gli allergeni.', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/Da completare/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stampa' })).toBeDisabled();
  });
});

describe('a hand-typed text in a country with no check', () => {
  it('is not used: the composed line is shown, with the quiet line that says why', async () => {
    const typed = { ...TORTA, labelIngredientsText: 'typed by hand, nothing else' } as StoredDoc;
    open({ lang: 'en', country: 'GB', recipes: [typed] });
    const article = (await screen.findByText('Torta della nonna di prova', undefined, LOAD)).closest('article') as HTMLElement;
    expect(article.textContent).not.toContain('typed by hand');
    expect(screen.getByText('The label text written by hand cannot be checked in this country’s language, so the book shows the ingredients worked out from the recipe.')).toBeInTheDocument();
  });
});

describe('English and Italian', () => {
  it('an English interface in a British venue: Contains, Allergen book', async () => {
    open({ lang: 'en', country: 'GB' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Allergen book' }, LOAD)).toBeInTheDocument();
    const article = (await screen.findByText('Torta della nonna di prova')).closest('article') as HTMLElement;
    expect(article.textContent).toMatch(/Ingredients:/);
    expect(article.textContent).toMatch(/Contains/);
    expect(screen.getByRole('button', { name: 'Choose the products' })).toBeInTheDocument();
    expect(screen.getByText('4 products in the book')).toBeInTheDocument();
  });

  it('an Italian interface in a British venue still prints the country’s words', async () => {
    open({ lang: 'it', country: 'GB' });
    const article = (await screen.findByText('Torta della nonna di prova', undefined, LOAD)).closest('article') as HTMLElement;
    expect(article.textContent).toMatch(/Ingredients:/);
    expect(article.textContent).toMatch(/Contains/);
    expect(screen.getByRole('heading', { level: 1, name: 'Libro allergeni' })).toBeInTheDocument();
  });
});
