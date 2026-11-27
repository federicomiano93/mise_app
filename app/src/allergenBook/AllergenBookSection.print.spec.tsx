import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import { LOAD } from '../testing/renderRecipes';
import { BOOK_HOST_ID, BOOK_PAGE_ID, BOOK_PAGE_OFF, BOOK_PAGE_ON, BOOK_PRINTING_CLASS, closeBookHost } from './bookPrintHost';
import { open } from './allergenBookRender';
import { BISCOTTO, INCOMPLETO, PANE, TORTA } from './allergenBookFixtures';
import printCss from './allergen-book-print.css?raw';
import pageCss from './allergen-book-page.css?raw';

// Printing the allergen book (27 Nov 2026): straight away when every product is complete, a question when some are not, the sheet's
// words and its allergens, and the stylesheet that makes the paper. The paper itself was never driven here (no printer in a spec).

beforeAll(async () => {
  await import('./AllergenBookSection');
}, 60_000);

let print: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  window.localStorage.clear();
  print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => { closeBookHost(); });
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const sheet = () => {
  const host = document.getElementById(BOOK_HOST_ID);
  if (host === null) throw new Error('the print host is not in the page');
  return host;
};
const sheetNames = () => [...sheet().querySelectorAll('.book-product-name')].map(node => node.textContent);

describe('printing the book', () => {
  it('with every product complete, prints at once: the venue, the title, the date, the legend, the categories, the products', async () => {
    const { user } = open({ recipes: [TORTA, BISCOTTO, PANE] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    const host = within(sheet());
    expect(host.getByText('Forno di prova')).toBeInTheDocument();
    expect(host.getByRole('heading', { level: 1, name: 'Libro allergeni' })).toBeInTheDocument();
    expect(host.getByText(/^Aggiornato al \d{2}\/\d{2}\/\d{4}$/)).toBeInTheDocument();
    expect(host.getByText('Gli allergeni sono in MAIUSCOLO GRASSETTO.')).toBeInTheDocument();
    expect(host.getAllByRole('heading', { level: 2 }).map(h => h.textContent)).toEqual(['Biscotti', 'Torte', 'Altri prodotti']);
    expect(sheetNames()).toEqual(['Biscotto test', 'Torta della nonna di prova', 'Pane prova']);
    expect(document.documentElement).toHaveClass(BOOK_PRINTING_CLASS);
  });

  it('draws the allergens with the class the print stylesheet makes bold capitals, and the same Contiene line as the screen', async () => {
    const { user } = open({ recipes: [TORTA] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    const article = sheet().querySelector('.book-product') as HTMLElement;
    expect(article.querySelectorAll('.book-allergen').length).toBeGreaterThan(0);
    const onScreen = within(screen.getByRole('main')).getByText(/^Contiene/).textContent;
    expect(article.querySelector('.book-contains')?.textContent).toBe(onScreen);
  });

  it('with an incomplete product asks first, naming it and saying what the paper will show; Cancel prints nothing', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    const question = await screen.findByRole('alertdialog', { name: 'Stampare il libro?' });
    expect(question).toHaveTextContent('1 prodotto ha gli allergeni incompleti: Panino incompleto prova.');
    expect(question).toHaveTextContent('Stampati, al posto di «Contiene» riportano «Allergeni da verificare: chiedere al personale».');
    expect(print).not.toHaveBeenCalled();
    await user.click(within(question).getByRole('button', { name: 'Annulla' }));
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById(BOOK_HOST_ID)).toBeNull();
  });

  it('«Solo i 3 completi» prints the sheet without the incomplete product', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Solo i 3 completi' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(sheetNames()).toEqual(['Biscotto test', 'Torta della nonna di prova', 'Pane prova']);
    expect(sheet().querySelector('.book-verify')).toBeNull();
  });

  it('«Stampa tutti e 4» prints the incomplete one too, in its own category, boxed, with no «Contiene»', async () => {
    const { user } = open();
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    await user.click(await screen.findByRole('button', { name: 'Stampa tutti e 4' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(sheetNames()).toEqual(['Biscotto test', 'Panino incompleto prova', 'Torta della nonna di prova', 'Pane prova']);
    const boxed = sheet().querySelector('.book-verify') as HTMLElement;
    expect(boxed.textContent).toBe('Allergeni da verificare: chiedere al personale');
    const article = boxed.closest('article') as HTMLElement;
    expect(article).toHaveTextContent('Panino incompleto prova');
    expect(article.textContent).not.toMatch(/Contiene/);
    expect(article.querySelector('.book-allergen')).toBeNull();
    expect(article.textContent).toContain('Ingredienti: Farina, Misterioso.');
  });

  it('when only incomplete products are in the book, the question has no «only the complete» choice', async () => {
    const { user } = open({ recipes: [INCOMPLETO] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    const question = await screen.findByRole('alertdialog');
    expect(within(question).queryByRole('button', { name: /Solo/ })).not.toBeInTheDocument();
    expect(within(question).getByRole('button', { name: 'Stampalo comunque' })).toBeInTheDocument();
  });

  it('the host and its class go away on the first tap or key after the print dialog has closed, and not before', async () => {
    const { user } = open({ recipes: [TORTA] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    expect(document.getElementById(BOOK_HOST_ID)).not.toBeNull();
    // Android fires afterprint at once: that alone does not remove it.
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById(BOOK_HOST_ID)).not.toBeNull();
    act(() => { fireEvent.pointerDown(document.body); });
    expect(document.getElementById(BOOK_HOST_ID)).toBeNull();
    expect(document.documentElement).not.toHaveClass(BOOK_PRINTING_CLASS);
  });

  it('the A4 page file is switched on (media print) while the host lives and off (not all) after it is removed', async () => {
    const page = () => document.getElementById(BOOK_PAGE_ID) as HTMLLinkElement;
    const { user } = open({ recipes: [TORTA] });
    await screen.findByRole('button', { name: 'Stampa' }, LOAD);
    expect(page().media).toBe(BOOK_PAGE_OFF);
    await user.click(screen.getByRole('button', { name: 'Stampa' }));
    expect(page().media).toBe(BOOK_PAGE_ON);
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(page().media).toBe(BOOK_PAGE_ON);
    act(() => { fireEvent.pointerDown(document.body); });
    expect(page().media).toBe(BOOK_PAGE_OFF);
  });

  it('a print() that throws leaves nothing behind', async () => {
    print.mockImplementation(() => { throw new Error('no printer'); });
    const { user } = open({ recipes: [TORTA] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    expect(document.getElementById(BOOK_HOST_ID)).toBeNull();
    expect(document.documentElement).not.toHaveClass(BOOK_PRINTING_CLASS);
  });

  it('a British venue’s paper is in English, whatever the interface says', async () => {
    const { user } = open({ lang: 'it', country: 'GB', recipes: [TORTA, PANE] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    const host = within(sheet());
    expect(host.getByRole('heading', { level: 1, name: 'Allergen book' })).toBeInTheDocument();
    expect(host.getByText(/^Updated on \d{2}\/\d{2}\/\d{4}$/)).toBeInTheDocument();
    expect(host.getByText('Allergens are in BOLD CAPITALS.')).toBeInTheDocument();
    expect(host.getByRole('heading', { level: 2, name: 'Other products' })).toBeInTheDocument();
    expect(sheet().textContent).toMatch(/Contains/);
  });

  it('the question names a product as the book shows it (the hand-typed label name), and the sheet has no heading for a single no-category group', async () => {
    const named = { ...INCOMPLETO, category: undefined, labelName: 'Panino | speciale' } as never;
    const { user } = open({ recipes: [named, PANE] });
    await user.click(await screen.findByRole('button', { name: 'Stampa' }, LOAD));
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Panino speciale.');
    await user.click(screen.getByRole('button', { name: 'Solo quello completo' }));
    expect(within(sheet()).queryByRole('heading', { level: 2 })).not.toBeInTheDocument();
  });

  it('nothing prints with no product in the book', async () => {
    const { user } = open({ recipes: [{ ...TORTA, inBook: undefined } as never] });
    await screen.findByText(/Nel libro non c’è ancora nessun prodotto/, undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Stampa' }));
    expect(print).not.toHaveBeenCalled();
  });
});

describe('the print stylesheets', () => {
  it('make the allergen runs bold capitals and never cut a product across two pages', () => {
    expect(printCss).toMatch(/\.book-allergen\s*\{[^}]*text-transform:\s*uppercase/);
    expect(printCss).toMatch(/\.book-allergen\s*\{[^}]*font-weight:\s*700/);
    expect(printCss).toMatch(/\.book-product\s*\{[^}]*break-inside:\s*avoid/);
    expect(printCss).toMatch(/\.book-product\s*\{[^}]*page-break-inside:\s*avoid/);
    expect(printCss).toMatch(/\.book-verify\s*\{[^}]*border:/);
  });

  it('hide the rest of the page while the book prints, scoped by the class on <html>, never by :has', () => {
    expect(printCss).toContain('.book-printing body > *:not(#allergenBookPrint)');
    expect(printCss).not.toContain(':has(');
  });

  it('the page is an A4 with a 12 mm margin', () => {
    expect(pageCss).toMatch(/@page\s*\{\s*size:\s*A4;\s*margin:\s*12mm;\s*\}/);
  });
});

