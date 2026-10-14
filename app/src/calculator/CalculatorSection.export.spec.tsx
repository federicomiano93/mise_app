import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, SOURDOUGH, configOf, onlyFocaccia, renderCalculator } from '../testing/renderCalculator';

// The Calculator's «Export» (PDF / Excel): its own full-width line under Copy and Send, made from the SAME rows the
// card draws. The builders are replaced (the files themselves: ui/recipeExport.spec.ts).

const builders = vi.hoisted(() => ({ buildPdfBlob: vi.fn(), buildXlsxBlob: vi.fn() }));
vi.mock('../ui/recipeExport', () => builders);

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  builders.buildPdfBlob.mockReset().mockImplementation(() => Promise.resolve(new Blob(['%PDF'])));
  builders.buildXlsxBlob.mockReset().mockImplementation(() => Promise.resolve(new Blob(['PK'])));
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:test/1', revokeObjectURL: () => undefined }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));

// 4 trays of 500 g: a 2,000 g dough, confirmed (the current app's own keys), so the recipe is on screen.
async function open(path = '/calculator/focaccia', config: Record<string, unknown> = onlyFocaccia(), lang: 'en' | 'it' = 'en') {
  const rendered = renderCalculator(path, { source: fakeCalculatorSource({ config }), lang });
  await main().findByRole('button', { name: lang === 'it' ? 'Azzera tutti i campi' : 'Reset all fields' }, LOAD);
  return rendered;
}

function focaccia() {
  window.localStorage.setItem('qty-roma::tray', '4');
  window.localStorage.setItem('revealed-focaccia', '1');
}

describe('the Export button', () => {
  it('is a line of its own UNDER the Copy / Send row, not a third button in it', async () => {
    focaccia();
    await open();
    const copy = main().getByRole('button', { name: 'Copy recipe' });
    const send = main().getByRole('button', { name: 'Send' });
    const exportButton = main().getByRole('button', { name: 'Export' });
    expect(copy.parentElement).toBe(send.parentElement);
    expect(copy.parentElement?.contains(exportButton)).toBe(false);
    expect(copy.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(send.compareDocumentPosition(exportButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is absent while the recipe is not on screen (nothing confirmed yet)', async () => {
    window.localStorage.setItem('qty-roma::tray', '4');
    await open();
    expect(main().queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('is absent when there is nothing to make', async () => {
    window.localStorage.setItem('revealed-focaccia', '1');
    await open();
    expect(main().queryByRole('button', { name: 'Export' })).not.toBeInTheDocument();
  });

  it('opens the sheet, and the PDF is made from the very rows the card draws (unrounded), the recipe’s name and the total', async () => {
    focaccia();
    const { user } = await open();
    const list = main().getAllByRole('listitem').slice(0, 4);
    expect(list.map(row => row.textContent)).toEqual(['Flour1,159 g', 'Water812 g', 'Salt23 g', 'Yeast6 g']);
    await user.click(main().getByRole('button', { name: 'Export' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Export as' })).getByRole('button', { name: /^PDF/ }));
    await screen.findByRole('dialog', { name: 'File ready' });
    expect(builders.buildPdfBlob).toHaveBeenCalledTimes(1);
    const model = builders.buildPdfBlob.mock.calls[0]?.[0] as { name: string; trays: number; totalG: number; rows: { name: string; grams: number }[] };
    expect(model.name).toBe('Focaccia');
    expect(model.trays).toBe(0);
    expect(model.totalG).toBe(2000);
    expect(model.rows.map(row => row.name)).toEqual(['Flour', 'Water', 'Salt', 'Yeast']);
    // The grams the card shows, as the card holds them (the file never rounds them itself).
    expect(model.rows.map(row => Math.round(row.grams))).toEqual([1159, 812, 23, 6]);
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'Focaccia_2000g.pdf');
  });

  it('builds the Excel with the «Total dough» word and the sheet’s fallback word', async () => {
    focaccia();
    const { user } = await open();
    await user.click(main().getByRole('button', { name: 'Export' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Export as' })).getByRole('button', { name: /^Excel/ }));
    await screen.findByRole('dialog', { name: 'File ready' });
    expect(builders.buildXlsxBlob.mock.calls[0]?.slice(1)).toEqual(['Total dough', 'Recipe']);
  });

  it('names the trays in the title only when the dough IS the trays', async () => {
    window.localStorage.setItem('trays-sourdough', '3');
    window.localStorage.setItem('revealed-sourdough', '1');
    const { user } = await open('/calculator/sourdough', configOf({ recipes: [SOURDOUGH] }));
    await user.click(main().getByRole('button', { name: 'Export' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Export as' })).getByRole('button', { name: /^PDF/ }));
    await screen.findByRole('dialog', { name: 'File ready' });
    const model = builders.buildPdfBlob.mock.calls[0]?.[0] as { trays: number; totalG: number };
    expect([model.trays, model.totalG]).toEqual([3, 3600]);
    expect(within(screen.getByRole('dialog')).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'Sourdough_x3.pdf');
  });

  it('says the grams, not the trays, when a typed total is added to them (trays + total)', async () => {
    window.localStorage.setItem('trays-sourdough', '3');
    window.localStorage.setItem('total-sourdough', '500');
    window.localStorage.setItem('revealed-sourdough', '1');
    const { user } = await open('/calculator/sourdough', configOf({ recipes: [{ ...SOURDOUGH, logic: 'traysTotal' }] }));
    await user.click(main().getByRole('button', { name: 'Export' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Export as' })).getByRole('button', { name: /^PDF/ }));
    await screen.findByRole('dialog', { name: 'File ready' });
    const model = builders.buildPdfBlob.mock.calls[0]?.[0] as { trays: number; totalG: number };
    expect([model.trays, model.totalG]).toEqual([0, 4100]);
  });

  it('speaks Italian: «Esporta», and the Italian total word in the sheet', async () => {
    focaccia();
    const { user } = await open('/calculator/focaccia', onlyFocaccia(), 'it');
    await user.click(main().getByRole('button', { name: 'Esporta' }));
    await user.click(within(await screen.findByRole('dialog', { name: 'Esporta come' })).getByRole('button', { name: /^Excel/ }));
    await screen.findByRole('dialog', { name: 'File pronto' });
    expect(builders.buildXlsxBlob.mock.calls[0]?.slice(1)).toEqual(['Impasto totale', 'Ricetta']);
  });
});
