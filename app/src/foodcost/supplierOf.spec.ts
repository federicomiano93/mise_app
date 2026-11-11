import { describe, expect, it } from 'vitest';
import { supplierOf } from './supplierOf';

// Whom an ingredient is bought from, as Food cost shows it (step 4, POST-SWITCH): the ingredient's own supplierId, named through
// supplierLabel(), '' whenever there is nothing to say.
const SUPPLIERS = {
  rossi: { id: 'rossi', name: 'Molino Rossi S.r.l.', shortName: '  Molino Rossi ' },
  bianchi: { id: 'bianchi', name: 'Bianchi' },
  off: { id: 'off', name: 'Old Mill', active: false },
  blank: { id: 'blank', name: '   ', shortName: '' },
};

describe('supplierOf', () => {
  it('the short name when there is one (trimmed), else the name', () => {
    expect(supplierOf({ supplierId: 'rossi' }, SUPPLIERS)).toBe('Molino Rossi');
    expect(supplierOf({ supplierId: 'bianchi' }, SUPPLIERS)).toBe('Bianchi');
  });

  it('a supplier switched off is still the one the ingredient is bought from', () => {
    expect(supplierOf({ supplierId: 'off' }, SUPPLIERS)).toBe('Old Mill');
  });

  it('\'\' for no supplierId, «no supplier», an unknown id, a blank name and junk', () => {
    for (const ingredient of [{}, { supplierId: '' }, { supplierId: 'no-supplier' }, { supplierId: 'gone' }, { supplierId: 'blank' },
      { supplierId: 42 }, { supplierId: null }, null, undefined, 'flour']) {
      expect(supplierOf(ingredient, SUPPLIERS)).toBe('');
    }
  });

  it('\'\' while the suppliers have not arrived', () => {
    expect(supplierOf({ supplierId: 'rossi' }, {})).toBe('');
  });

  it('an id only an object’s own machinery answers to is not a supplier', () => {
    for (const supplierId of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(supplierOf({ supplierId }, SUPPLIERS)).toBe('');
    }
  });
});
