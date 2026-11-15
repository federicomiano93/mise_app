import { describe, expect, it } from 'vitest';
import { fromInvoice, suppliersFromInvoices } from './invoiceTag';

// The «From invoice» tag, derived from what the items already hold (no origin field, no extra read).

describe('fromInvoice', () => {
  it('an article code, another pack\'s code or the invoice description says the item came from (or was linked by) an import', () => {
    expect(fromInvoice({ supplierCode: 'F00' })).toBe(true);
    expect(fromInvoice({ supplierCode: '', supplierCodes: ['F01'] })).toBe(true);
    expect(fromInvoice({ invoiceName: 'FARINA TIPO 00 SACCO KG 25' })).toBe(true);
  });

  it('a hand-made item carries none of them: no tag', () => {
    expect(fromInvoice({ name: 'Farina', brand: 'Molino', weight: '25 kg' })).toBe(false);
  });

  it('blank, wrong-typed or empty values are no proof', () => {
    expect(fromInvoice({ supplierCode: '  ', supplierCodes: [], invoiceName: '' })).toBe(false);
    expect(fromInvoice({ supplierCode: 7, supplierCodes: [' ', 3], invoiceName: null })).toBe(false);
    expect(fromInvoice({ supplierCodes: 'F00' })).toBe(false);
  });
});

describe('suppliersFromInvoices', () => {
  it('a supplier is tagged when at least one of its items is', () => {
    const ids = suppliersFromInvoices([
      { id: 'i1', supplierId: 's1', supplierCode: 'F00' },
      { id: 'i2', supplierId: 's1' },
      { id: 'i3', supplierId: 's2' },
      { id: 'i4', supplierId: '', invoiceName: 'X' },
      { id: 'i5', invoiceName: 'Y' },
    ]);
    expect([...ids]).toEqual(['s1']);
  });
});
