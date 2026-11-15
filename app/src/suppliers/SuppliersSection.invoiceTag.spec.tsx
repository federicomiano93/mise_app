import { beforeAll, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, supplier } from '../testing/renderSuppliers';

// The small «From invoice» tag: on the rows of ingredients and packaging that an invoice import made or linked, and on the
// suppliers that sell at least one of them. Derived from what the lists already hold: no field of its own.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

const SUPPLIERS = [
  supplier('s-inv', { name: 'Alpine Mills' }),
  supplier('s-hand', { name: 'Zed Dairy Ltd' }),
];

const ITEMS = [
  item('i-flour', { name: 'Flour 00', supplierId: 's-inv', supplierCode: 'F00' }),
  item('i-milk', { name: 'Whole milk', supplierId: 's-hand' }),
  item('i-cafe', { name: 'Caffè in grani', supplierId: 's-hand' }),
  item('i-box', { name: 'Cake box', kind: 'packaging', supplierId: 's-inv', invoiceName: 'SCATOLA TORTA' }),
  item('i-bag', { name: 'Paper bag', kind: 'packaging', supplierId: 's-hand' }),
];

async function loaded(path = '/suppliers') {
  renderSuppliers(path, { source: fakeSuppliersSource({ suppliers: SUPPLIERS, ingredients: ITEMS }) });
  await screen.findAllByRole('listitem', undefined, LOAD);
}

const row = (name: string) => screen.getAllByRole('listitem').find(node => node.textContent?.includes(name)) as HTMLElement;

describe('the «From invoice» tag', () => {
  it('is on an ingredient with an article code, and not on a hand-made one', async () => {
    await loaded();
    expect(within(row('Flour 00')).getByText('From invoice')).toBeInTheDocument();
    expect(within(row('Whole milk')).queryByText('From invoice')).not.toBeInTheDocument();
  });

  it('is on a packaging item that holds an invoice description, and not on a plain one', async () => {
    await loaded('/suppliers/packaging');
    expect(within(row('Cake box')).getByText('From invoice')).toBeInTheDocument();
    expect(within(row('Paper bag')).queryByText('From invoice')).not.toBeInTheDocument();
  });

  it('is on the supplier that sells an item from an invoice, and not on one with hand-made items only', async () => {
    await loaded('/suppliers/suppliers');
    expect(within(row('Alpine Mills')).getByText('From invoice')).toBeInTheDocument();
    expect(within(row('Zed Dairy Ltd')).queryByText('From invoice')).not.toBeInTheDocument();
  });
});
