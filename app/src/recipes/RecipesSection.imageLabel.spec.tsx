import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { MAX_JOB_CHARS } from '@mise/shared/zpl-z64';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';
import { closePrintHost } from './printHost';

// The «with logo» label screen (step 3e): the product label as an image, 80 × 60 mm. jsdom has no 2D canvas and no layout,
// so the drawing (labelCanvas) and the typeface (labelFonts) are replaced by stand-ins that answer what the browser
// would; everything else is real — the layout with the real width table, the text check, the ZPL writer and its
// compression, the print host.

const canvas = vi.hoisted(() => ({
  bitmap: null as unknown,
  render: vi.fn(),
  paint: vi.fn(),
  png: vi.fn(),
  load: vi.fn(),
}));
vi.mock('./labelCanvas', () => ({
  renderLogoLabelBitmap: (...args: unknown[]) => canvas.render(...args) as unknown,
  paintBitmap: (...args: unknown[]) => canvas.paint(...args) as unknown,
  bitmapPng: (...args: unknown[]) => canvas.png(...args) as unknown,
  loadLogoImage: (...args: unknown[]) => canvas.load(...args) as unknown,
}));

const fonts = vi.hoisted(() => ({ state: 'ready' as 'loading' | 'ready' | 'failed' }));
vi.mock('./labelFonts', async importOriginal => {
  const original = await importOriginal<typeof import('./labelFonts')>();
  return { ...original, useLabelFonts: () => fonts.state };
});

const PNG = 'data:image/png;base64,PNGPNG';
const emptyBitmap = () => ({ width: 640, height: 480, bytesPerRow: 80, bits: new Uint8Array(80 * 480) });
// Dots that do not compress: a job far over the queue's limit.
const noisyBitmap = () => {
  const bits = new Uint8Array(80 * 480);
  let x = 12345;
  for (let i = 0; i < bits.length; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    bits[i] = x >>> 24;
  }
  return { width: 640, height: 480, bytesPerRow: 80, bits };
};

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  fonts.state = 'ready';
  canvas.bitmap = emptyBitmap();
  canvas.render.mockImplementation(() => canvas.bitmap);
  canvas.paint.mockImplementation(() => undefined);
  canvas.png.mockImplementation(() => PNG);
  canvas.load.mockImplementation(() => Promise.resolve({}));
});

afterEach(() => {
  act(() => { closePrintHost(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  canvas.render.mockReset();
  canvas.paint.mockReset();
  canvas.png.mockReset();
  canvas.load.mockReset();
  Reflect.deleteProperty(navigator, 'clipboard');
  window.localStorage.clear();
});

const STAMP = '2026-01-01';
const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const declared = (id: string, allergens: string[]): StoredDoc =>
  ({ id, name: id, allergens, allergensCheckedAt: STAMP, nutrition: NUTRITION });
const INGREDIENTS = [declared('flour', ['gluten-wheat']), declared('milk', ['milk'])];
const row = (label: string, refId?: string) => ({ label, grams: 100, unit: 'g', ...(refId === undefined ? {} : { refId }) });

// Wheat and milk, fully declared; a text that names both in capitals is a clean one.
const CLEAN_TEXT = 'farina di GRANO, LATTE, zucchero';
const cake = (extra: Record<string, unknown> = {}): StoredDoc =>
  ({ id: 'cake', name: 'Cake', ingredients: [row('Flour', 'flour'), row('Milk', 'milk')], ...extra });

const LOGO = { png: 'data:image/png;base64,AAAA', width: 1320, height: 300 };
const IT = { country: 'IT' };
const GB = { country: 'GB' };
const LOGO_CONFIG = { template: 'logo' };

type Options = {
  recipe?: StoredDoc;
  location?: Record<string, unknown>;
  lang?: 'en' | 'it';
  labelConfig?: Record<string, unknown> | null;
  logo?: Record<string, unknown> | null;
  source?: ReturnType<typeof fakeRecipesSource>;
};

function open({ recipe = cake({ labelIngredientsText: CLEAN_TEXT }), location = IT, lang = 'en', labelConfig = LOGO_CONFIG, logo = LOGO, source }: Options = {}) {
  const src = source ?? fakeRecipesSource({ recipes: [recipe], ingredients: INGREDIENTS, labelConfig, logo });
  const view = renderRecipes('/recipes/cake/label', { source: src, lang, session: { location, language: lang } });
  return { ...view, source: src };
}

const main = () => within(screen.getByRole('main'));
const preview = () => main().findByRole('img', { name: 'Label preview, 80 × 60 mm' }, LOAD);
const printButton = () => main().getByRole('button', { name: 'Print' });
const zplButton = () => main().getByRole('button', { name: 'Copy the printer code (ZPL)' });
const noButtons = () => {
  expect(main().queryByRole('button', { name: 'Print' })).not.toBeInTheDocument();
  expect(main().queryByRole('button', { name: 'Copy the printer code (ZPL)' })).not.toBeInTheDocument();
};
const stubClipboard = () => {
  const writeText = vi.fn((_text: string) => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return writeText;
};

describe('which screen a label opens', () => {
  it.each([
    ['no template at all', null],
    ['the standard template', { template: 'standard' }],
    ['a template the app does not know', { template: 'hologram' }],
  ])('draws the allergens and nutrition screen for %s', async (_name, labelConfig) => {
    open({ labelConfig, recipe: cake({ labelIngredientsText: CLEAN_TEXT }) });
    expect(await main().findByRole('group', { name: 'What the label shows' }, LOAD)).toBeInTheDocument();
    expect(document.querySelector('[data-image-label]')).toBeNull();
  });

  it('draws the image label for the logo template, without the allergens / nutrition switch', async () => {
    open();
    expect(await preview()).toBeInTheDocument();
    expect(main().queryByRole('group', { name: 'What the label shows' })).not.toBeInTheDocument();
    expect(document.querySelector('canvas[data-image-label]')).not.toBeNull();
    // The preview is painted from the very dots that go to the printer.
    expect(canvas.paint).toHaveBeenCalledWith(expect.anything(), canvas.bitmap);
    expect(main().getByText('Check this before it goes on food')).toBeInTheDocument();
  });

  it('keeps the standard screen until the label settings have arrived', async () => {
    const source = fakeRecipesSource({ recipes: [cake({ labelIngredientsText: CLEAN_TEXT })], ingredients: INGREDIENTS, labelConfig: LOGO_CONFIG, logo: LOGO });
    source.holdLabelConfig();
    open({ source });
    expect(await main().findByRole('group', { name: 'What the label shows' }, LOAD)).toBeInTheDocument();
    act(() => { source.releaseLabelConfig(); });
    expect(await preview()).toBeInTheDocument();
    expect(main().queryByRole('group', { name: 'What the label shows' })).not.toBeInTheDocument();
  });
});

describe('what is missing, in one sentence', () => {
  it('refuses a venue that has switched allergens off', async () => {
    open({ location: { country: 'IT', showAllergens: false } });
    expect(await main().findByText(/does not track allergens/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('refuses a venue with no country', async () => {
    open({ location: {} });
    expect(await main().findByText(/nobody has said which country/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('says a recipe has no label text yet', async () => {
    open({ recipe: cake() });
    expect(await main().findByText('This recipe has no label ingredients text yet. Type it in the recipe’s editor, under Label with logo.', undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it.each([
    ['no logo', null],
    ['a logo that is not one', { png: 'not a picture', width: 1320, height: 300 }],
  ])('says there is no logo for %s', async (_name, logo) => {
    open({ logo });
    expect(await main().findByText('There is no logo for this venue’s labels. Add it in Label settings.', undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('says so when the logo could not be read', async () => {
    const source = fakeRecipesSource({ recipes: [cake({ labelIngredientsText: CLEAN_TEXT })], ingredients: INGREDIENTS, labelConfig: LOGO_CONFIG, logo: LOGO });
    source.refuseLogo = true;
    open({ source });
    expect(await main().findByText(/The logo could not be loaded/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('waits for the typeface', async () => {
    fonts.state = 'loading';
    open();
    expect(await main().findByText('Preparing the label…', undefined, LOAD)).toBeInTheDocument();
    noButtons();
    expect(canvas.render).not.toHaveBeenCalled();
  });

  it('says so when the typeface cannot be loaded', async () => {
    fonts.state = 'failed';
    open();
    expect(await main().findByText(/The label typeface could not be loaded/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
    expect(canvas.render).not.toHaveBeenCalled();
  });

  it('says so when the label cannot be drawn on this device', async () => {
    canvas.render.mockImplementation(() => { throw new Error('no-canvas'); });
    open();
    expect(await main().findByText('The label could not be drawn on this device. Try Chrome or Edge.', undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('says so when the logo picture cannot be decoded', async () => {
    canvas.load.mockImplementation(() => Promise.reject(new Error('decode')));
    open();
    expect(await main().findByText(/could not be drawn on this device/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });
});

describe('a label that would print cut, or unmeasured, is refused', () => {
  it('refuses ingredients that do not fit, draws nothing and offers no button', async () => {
    open({ recipe: cake({ labelIngredientsText: `${CLEAN_TEXT} ${'zucchero '.repeat(400)}` }) });
    expect(await main().findByText('This label cannot be printed as it is', undefined, LOAD)).toBeInTheDocument();
    expect(main().getByText('The ingredients do not fit: shorten the text.')).toBeInTheDocument();
    noButtons();
    expect(canvas.render).not.toHaveBeenCalled();
    expect(document.querySelector('[data-image-label]')).toBeNull();
  });

  it('names a header that is too wide', async () => {
    open({ labelConfig: { template: 'logo', businessName: 'W'.repeat(80) } });
    expect(await main().findByText(/business name or the address under the logo is too wide/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('names a title that is too wide, and how to split it', async () => {
    open({ recipe: cake({ labelIngredientsText: CLEAN_TEXT, labelName: 'W'.repeat(80) }) });
    expect(await main().findByText('The title is too wide even at the smallest size: split it with | or shorten it.', undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('names a word wider than the label', async () => {
    open({ recipe: cake({ labelIngredientsText: `${CLEAN_TEXT}, ${'W'.repeat(120)}` }) });
    expect(await main().findByText(/One word of the ingredients is wider than the label/, undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('lists every character the fonts do not hold, each once', async () => {
    open({ recipe: cake({ labelIngredientsText: `${CLEAN_TEXT} ✓ 漢 ✓` }) });
    expect(await main().findByText('The label typeface has no letter for: ✓ 漢. Replace it in the text.', undefined, LOAD)).toBeInTheDocument();
    noButtons();
  });

  it('finds a missing character in the title as well', async () => {
    open({ recipe: cake({ labelIngredientsText: CLEAN_TEXT, labelName: 'TORTA ✓' }) });
    expect(await main().findByText('The label typeface has no letter for: ✓. Replace it in the text.', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('the check of the text', () => {
  it('has nothing to say about a clean text, and leaves the buttons on', async () => {
    open();
    await preview();
    expect(main().getByRole('heading', { level: 3, name: 'Check of the text' })).toBeInTheDocument();
    expect(main().getByText('Nothing found in the text.')).toBeInTheDocument();
    expect(printButton()).toBeEnabled();
    expect(zplButton()).toBeEnabled();
  });

  it('⚠️ an allergen in small letters is an ERROR: the sentence names it and Print and Copy are off', async () => {
    open({ recipe: cake({ labelIngredientsText: 'farina di grano, LATTE' }) });
    await preview();
    expect(main().getByText('ERROR')).toBeInTheDocument();
    expect(main().getByText('“grano” is an allergen written in small letters: write it in CAPITALS.')).toBeInTheDocument();
    expect(main().getByText(/Fix the errors above first/)).toBeInTheDocument();
    const card = main().getByRole('region', { name: 'Check of the text' });
    for (const button of [printButton(), zplButton()]) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('aria-describedby', card.id);
    }
  });

  it('the Italian interface says ERRORE', async () => {
    open({ recipe: cake({ labelIngredientsText: 'farina di grano, LATTE' }), lang: 'it' });
    expect(await main().findByRole('img', { name: 'Anteprima dell’etichetta, 80 × 60 mm' }, LOAD)).toBeInTheDocument();
    expect(main().getByText('ERRORE')).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 3, name: 'Controllo del testo' })).toBeInTheDocument();
  });

  it('⚠️ an allergen the recipe holds but the text never names is an ERROR, in the label\'s language', async () => {
    // The interface is English, the venue Italian: the allergen is the country's word.
    open({ recipe: cake({ labelIngredientsText: 'farina di GRANO, zucchero' }) });
    await preview();
    expect(main().getByText(/Mise holds this recipe as containing Latte, but the text never says it in CAPITALS/)).toBeInTheDocument();
    expect(printButton()).toBeDisabled();
  });

  it('a beer without ORZO and a bare lecithin are ERRORS', async () => {
    open({ recipe: cake({ labelIngredientsText: 'GRANO, LATTE, birra, lecitina' }) });
    await preview();
    expect(main().getByText(/“birra” without ORZO in the same ingredient/)).toBeInTheDocument();
    expect(main().getByText(/A lecithin whose origin is not said/)).toBeInTheDocument();
    expect(zplButton()).toBeDisabled();
  });

  it('wine only asks to be verified: TO VERIFY, and the buttons stay on', async () => {
    open({ recipe: cake({ labelIngredientsText: 'GRANO, LATTE, vino bianco' }) });
    await preview();
    expect(main().getByText('TO VERIFY')).toBeInTheDocument();
    expect(main().getByText(/may contain sulphites/)).toBeInTheDocument();
    expect(main().queryByText('ERROR')).not.toBeInTheDocument();
    expect(printButton()).toBeEnabled();
    expect(zplButton()).toBeEnabled();
  });

  it('chocolate and margarine are verified too', async () => {
    open({ recipe: cake({ labelIngredientsText: 'GRANO, LATTE, cioccolato, margarina' }) });
    await preview();
    expect(main().getByText(/Chocolate may contain milk, soy or nuts/)).toBeInTheDocument();
    expect(main().getByText(/Margarine may contain milk or soy/)).toBeInTheDocument();
    expect(printButton()).toBeEnabled();
  });

  it('⚠️ a recipe whose allergens are not fully declared is a warning, not a block', async () => {
    const notDeclared = cake({ labelIngredientsText: CLEAN_TEXT, ingredients: [row('Flour', 'flour'), row('Mystery')] });
    open({ recipe: notDeclared });
    await preview();
    expect(main().getByText('TO VERIFY')).toBeInTheDocument();
    expect(main().getByText('Mise does not hold this recipe’s allergens fully declared, so the text was not compared with them.')).toBeInTheDocument();
    expect(main().queryByText('Nothing found in the text.')).not.toBeInTheDocument();
    expect(printButton()).toBeEnabled();
  });

  it('does not read a label that is not in Italian: a plain note, whatever the text says', async () => {
    open({ location: GB, recipe: cake({ labelIngredientsText: 'wheat flour, grano, birra' }) });
    await preview();
    expect(main().getByText('The text check only reads Italian labels, so this text was not checked.')).toBeInTheDocument();
    expect(main().queryByText('ERROR')).not.toBeInTheDocument();
    expect(printButton()).toBeEnabled();
  });

  it('the preview says «PRODUCED ON:» for a label in English and «PRODOTTO IL:» for one in Italian', async () => {
    open({ location: GB });
    await preview();
    const asked = (canvas.render.mock.calls[0] as unknown[])[0] as { elements: Array<{ kind: string; text?: string }> };
    expect(asked.elements.some(el => el.text === 'PRODUCED ON:')).toBe(true);
  });

  it('draws «PRODOTTO IL:» for an Italian venue, whatever language the screen is in', async () => {
    open({ lang: 'en' });
    await preview();
    const asked = (canvas.render.mock.calls[0] as unknown[])[0] as { elements: Array<{ kind: string; text?: string }> };
    expect(asked.elements.some(el => el.text === 'PRODOTTO IL:')).toBe(true);
  });
});

describe('the preview', () => {
  it('says it is the actual size when it is shown at 80 mm', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: (80 * 96) / 25.4 } as DOMRect);
    open();
    await preview();
    expect(await main().findByText('Actual size — 80 × 60 mm')).toBeInTheDocument();
  });

  it('says it is shown smaller when the screen is narrower', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 200 } as DOMRect);
    open();
    await preview();
    expect(await main().findByText('80 × 60 mm — shown smaller to fit this screen')).toBeInTheDocument();
  });

  it('says nothing about the size until it has been measured', async () => {
    open();
    await preview();
    expect(main().queryByText(/Actual size/)).not.toBeInTheDocument();
    expect(main().queryByText(/shown smaller/)).not.toBeInTheDocument();
  });
});

describe('Copy the printer code', () => {
  it('copies one label turned round (^POI) by default', async () => {
    const { user } = open();
    await preview();
    const writeText = stubClipboard();
    await user.click(zplButton());
    await waitFor(() => { expect(writeText).toHaveBeenCalledTimes(1); });
    const zpl = writeText.mock.calls[0]?.[0] as string;
    expect(zpl.startsWith('^XA')).toBe(true);
    expect(zpl).toContain('^POI');
    expect(zpl).toContain('^PQ1');
    expect(zpl).toContain('^GFA,38400,38400,80,:Z64:');
    expect(await main().findByText(/^Printer code copied\. On the shop computer, paste it into Zebra Setup Utilities/)).toBeInTheDocument();
  });

  it('copies the number of copies asked for, and ^PON when the venue said the printer is not turned round', async () => {
    const { user } = open({ labelConfig: { template: 'logo', rotate180: false } });
    await preview();
    const writeText = stubClipboard();
    const copies = main().getByRole('spinbutton', { name: 'Copies' });
    await user.clear(copies);
    await user.type(copies, '2');
    await user.click(zplButton());
    await waitFor(() => { expect(writeText).toHaveBeenCalledTimes(1); });
    const zpl = writeText.mock.calls[0]?.[0] as string;
    expect(zpl).toContain('^PQ2');
    expect(zpl).toContain('^PON');
    expect(zpl).not.toContain('^POI');
  });

  it('brings copies into 1 to 99 when the box is left, never NaN', async () => {
    const { user } = open();
    await preview();
    const copies = main().getByRole('spinbutton', { name: 'Copies' });
    expect(copies).toHaveValue(1);
    await user.clear(copies);
    await user.type(copies, '500');
    await user.tab();
    expect(copies).toHaveValue(99);
    await user.clear(copies);
    await user.tab();
    expect(copies).toHaveValue(1);
    await user.clear(copies);
    await user.type(copies, '0');
    await user.tab();
    expect(copies).toHaveValue(1);
  });

  it('says the copies are for the printer code, and links the note to the box', async () => {
    open();
    await preview();
    const copies = main().getByRole('spinbutton', { name: 'Copies' });
    const note = main().getByText('For the printer code. When printing from this screen, choose the copies in the print window.');
    expect(copies).toHaveAccessibleDescription(note.textContent ?? '');
    expect(copies.closest('div')?.parentElement).toContainElement(zplButton());
    expect(copies.closest('div')?.parentElement).not.toContainElement(printButton());
  });

  it('⚠️ an identical snapshot does not draw the label again, nor take the Copies box from under the finger', async () => {
    const { user, source } = open();
    const canvasNode = await preview();
    const copies = main().getByRole('spinbutton', { name: 'Copies' });
    await user.clear(copies);
    await user.type(copies, '12');
    expect(copies).toHaveFocus();
    const drawnBefore = canvas.render.mock.calls.length;
    act(() => { source.push(); });
    act(() => { source.push(); });
    await new Promise(resolve => { setTimeout(resolve, 20); });
    expect(canvas.render).toHaveBeenCalledTimes(drawnBefore);
    expect(await preview()).toBe(canvasNode);
    expect(main().getByRole('spinbutton', { name: 'Copies' })).toBe(copies);
    expect(copies).toHaveValue(12);
    expect(copies).toHaveFocus();
    expect(printButton()).toBeEnabled();
    expect(zplButton()).toBeEnabled();
  });

  it('keeps the old drawing, with Print and Copy off, while a changed label is drawn, then replaces it', async () => {
    let finish: () => void = () => undefined;
    const { source } = open();
    const canvasNode = await preview();
    canvas.load.mockImplementation(() => new Promise(resolve => { finish = () => { resolve({}); }; }));
    source.labelConfig = { template: 'logo', businessName: 'Bakery' };
    act(() => { source.push(); });
    await waitFor(() => { expect(printButton()).toBeDisabled(); });
    expect(zplButton()).toBeDisabled();
    expect(await preview()).toBe(canvasNode);
    canvas.load.mockImplementation(() => Promise.resolve({}));
    finish();
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(zplButton()).toBeEnabled();
  });

  it('has its status region before it speaks, and fills it', async () => {
    fonts.state = 'loading';
    open();
    await main().findByText('Preparing the label…', undefined, LOAD);
    expect(main().getByText('Preparing the label…').closest('[role="status"]')).not.toBeNull();
  });

  it('⚠️ copies nothing when the job is longer than the queue takes, and says how long it is', async () => {
    canvas.bitmap = noisyBitmap();
    const { user } = open();
    await preview();
    const writeText = stubClipboard();
    await user.click(zplButton());
    const note = await main().findByText(/The printer code is too long to be sent/);
    expect(note.textContent).toMatch(new RegExp(`the limit is ${MAX_JOB_CHARS.toLocaleString('en')}|the limit is ${MAX_JOB_CHARS}`));
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says so when this browser cannot compress, and copies nothing', async () => {
    const { user } = open();
    await preview();
    const writeText = stubClipboard();
    vi.stubGlobal('CompressionStream', undefined);
    await user.click(zplButton());
    expect(await main().findByText('This browser cannot compress the label: use Chrome or Edge, version 80 or later.')).toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();
  });

  it('says so when the clipboard refuses', async () => {
    const { user } = open();
    await preview();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('no')) }, configurable: true });
    await user.click(zplButton());
    expect(await main().findByText('Could not copy — select the text above instead')).toBeInTheDocument();
  });

  it('announces a label printed when the code was copied', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const { user } = open();
      await preview();
      stubClipboard();
      await user.click(zplButton());
      await waitFor(() => { expect(actions).toContain('label-printed'); });
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });
});

describe('Print', () => {
  it('puts the picture of the dots in a host on the 80 × 60 page, then opens the print dialog', async () => {
    const seen: string[] = [];
    const print = vi.spyOn(window, 'print').mockImplementation(() => {
      const host = document.getElementById('labelPrint');
      seen.push(`${host?.parentElement === document.body}|${host?.className}|${host?.querySelector('img')?.getAttribute('src')}`);
    });
    const { user } = open();
    await preview();
    expect(document.getElementById('labelPrint')).toBeNull();
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([`true|lab-print lab-print--p80x60|${PNG}`]);
    // It outlives the screen, and goes once the person is back in the page.
    act(() => { window.dispatchEvent(new Event('afterprint')); });
    expect(document.getElementById('labelPrint')).not.toBeNull();
    act(() => { window.dispatchEvent(new Event('pointerdown')); });
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  it('takes the host away again when the print dialog throws', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => { throw new Error('no printer'); });
    const { user } = open();
    await preview();
    await user.click(printButton());
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  it('does nothing while the text has an error', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = open({ recipe: cake({ labelIngredientsText: 'farina di grano, LATTE' }) });
    await preview();
    await user.click(printButton());
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById('labelPrint')).toBeNull();
  });
});
