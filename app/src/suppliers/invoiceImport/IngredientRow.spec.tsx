import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import { en } from '../../i18n/en';
import { I18nProvider } from '../../i18n/I18nProvider';
import { it as italian } from '../../i18n/it';
import { IngredientRow } from './IngredientRow';

// One ingredient row of step 3 drawn alone: the cases the zip cannot reach (the zip path never writes an «unisci con» name).
//
// PORTS (tests/invoice-import-flow.test.mjs): «a “unisci con” row offers no “Create a new product”» (the original's
// `if (!planned.mergeWith) options.push(…)`), and the rename choice of tests/invoice-import-review.test.mjs.

const planned = (over: Record<string, unknown> = {}) => ({
  key: 'k', name: 'Burro', supplierId: 's', status: 'choose', newPoints: [], updateCurrent: false, mergeWith: '', supplierCode: '',
  patchSupplierCode: null, setSupplierCodes: null, patchInvoiceName: null, priceUnit: 'kg', unitWeightKg: null, vatRate: null,
  allPoints: [], priceCheck: '', candidates: [{ id: 'a', label: 'Burro A' }, { id: 'b', label: 'Burro B' }], ...over,
}) as unknown as PlanEntry['planned'];

function draw(entry: PlanEntry, lang: 'en' | 'it' = 'en', priceConfirmed = false) {
  const onRename = vi.fn();
  render(
    <I18nProvider initialLanguage={lang} initialMessages={lang === 'en' ? en : italian}>
      <ul>
        <IngredientRow entry={entry} supplierName="Fornitore Esempio" priceText="" priceConfirmed={priceConfirmed} decision={undefined} forgotten={false} confirmed={false}
          renameChosen={false} onDecision={() => undefined} onForget={() => undefined} onConfirm={() => undefined} onRename={onRename} />
      </ul>
    </I18nProvider>,
  );
  return { onRename };
}

describe('the pill of a price update', () => {
  const updating = () => planned({ status: 'update-price', ingredientId: 'a', candidates: [] });

  it('says «New price» in the green tone when the price changes', () => {
    const row = updating();
    draw({ planned: row, row, waiting: false });
    expect(screen.getByText('New price')).toHaveAttribute('data-tone', 'ok');
  });

  it('says «Price confirmed» in the quiet tone when a newer invoice repeats the price', () => {
    const row = updating();
    draw({ planned: row, row, waiting: false }, 'en', true);
    expect(screen.getByText('Price confirmed')).toHaveAttribute('data-tone', 'quiet');
    expect(screen.queryByText('New price')).toBeNull();
  });

  it('speaks Italian', () => {
    const row = updating();
    draw({ planned: row, row, waiting: false }, 'it', true);
    expect(screen.getByText('Prezzo confermato')).toHaveAttribute('data-tone', 'quiet');
  });
});

describe('a question row', () => {
  it('offers «Create a new product» unless the row names the ingredient it belongs to («unisci con»)', () => {
    const open = planned();
    draw({ planned: open, row: open, waiting: true });
    expect(within(screen.getByRole('combobox')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Choose…', 'Same as Burro A', 'Same as Burro B', 'Create a new product', 'Skip']);
  });

  it('… and does not offer it on a «unisci con» row', () => {
    const merging = planned({ mergeWith: 'Burro A' });
    draw({ planned: merging, row: merging, waiting: true });
    expect(within(screen.getByRole('combobox')).getAllByRole('option').map(option => option.textContent))
      .toEqual(['Choose…', 'Same as Burro A', 'Same as Burro B', 'Skip']);
  });
});

describe('a row whose invoice name changed', () => {
  const renamed = () => planned({
    status: 'unchanged', ingredientId: 'a', invoiceRename: { stored: 'Burro vecchio', file: 'Burro nuovo' },
  });

  it('says so in its own sentence and offers the rename as its own choice', async () => {
    const row = renamed();
    const { onRename } = draw({ planned: row, row, waiting: false });
    expect(screen.getByText('The name on the invoice has changed: «Burro vecchio» → «Burro nuovo». Same article code, so it is the same product.')).toBeInTheDocument();
    const choice = screen.getByRole('combobox', { name: 'Name on the invoice' });
    expect(choice).toHaveValue('keep');
    await userEvent.setup().selectOptions(choice, 'Save the new name');
    expect(onRename).toHaveBeenCalledWith({ stored: 'Burro vecchio', file: 'Burro nuovo' });
  });

  it('speaks Italian', () => {
    const row = renamed();
    draw({ planned: row, row, waiting: false }, 'it');
    expect(screen.getByText('Il nome in fattura è cambiato: «Burro vecchio» → «Burro nuovo». Stesso codice articolo, quindi è lo stesso prodotto.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Nome in fattura' })).toBeInTheDocument();
    expect(screen.getByText('Da controllare')).toBeInTheDocument();
  });
});
