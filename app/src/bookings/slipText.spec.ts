import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { bookingFixture } from '../testing/fakeBookingsSource';
import { slipUnitWords } from './bookingWords';
import { COLUMNS } from './receiptPrinter';
import { customerSlipLines, labSlipLines, twoColumns } from './slipText';

// The two slips as lines for the receipt printer (bookings step 3): the same content as the browser's slips. ⚠️ Fake customers.

const money = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });
const words = {
  number: 'N. 4', mode: 'Consegna', labTitle: 'LABORATORIO', notes: 'Note', total: 'Totale', deposit: 'Acconto', toPay: 'Da pagare',
  privacy: 'I tuoi dati (nome, telefono, indirizzo) servono solo per questo ordine e vengono cancellati 30 giorni dopo il ritiro.',
};
const booking = bookingFixture({
  id: 'A', number: 4, customerName: 'Anna Finta', phone: '+39 333 000 0000', mode: 'delivery', address: 'Via Finta 1, Roma',
  date: '2026-12-24', time: '09:30', total: 42.5, deposit: 10, notes: 'Suonare due volte',
  lines: [
    { recipeId: null, productId: 'pF', unitPrice: 12, packSize: null, packUnit: null, name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'affettata' },
    { recipeId: null, productId: 'pG', unitPrice: 3.5, packSize: 250, packUnit: 'g', name: 'Grissini', qty: 3, unit: 'pcs', note: '' },
    { recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, name: 'Torta su misura', qty: 1, unit: 'pcs', note: '' },
  ],
});
const common = { booking, words, locale: 'it-IT', units: slipUnitWords({ country: 'IT' }) };
// The money is written with a no-break space («18,00 €»); the printer gets a plain one (receiptPrinter's wrapLines).
const text = (lines: ReadonlyArray<{ text: string }>) => lines.map(l => l.text).join('\n').replace(/\u00a0/g, ' ');

describe('the slips for the receipt printer', () => {
  it('⚠️ the lab slip: when, how, what — no name, no phone, no address, no price', () => {
    const lab = text(labSlipLines(common));
    expect(lab).toMatch(/^LABORATORIO {2,}N\. 4$/m);
    expect(lab).toContain('mercoledì 24 dicembre · 09:30'.replace('mercoledì', 'giovedì'));
    expect(lab).toContain('CONSEGNA');
    expect(lab).toContain('1,5 kg Focaccia');
    expect(lab).toContain('  affettata');
    expect(lab).toContain('3 confezioni (250 g) Grissini');
    expect(lab).toContain('Note: Suonare due volte');
    for (const secret of ['Anna', '333', 'Via Finta', '€', '18,00']) expect(lab).not.toContain(secret);
  });

  it('the customer slip: the venue, the number, the name, what and when, each priced line, the money and the privacy line', () => {
    const lines = customerSlipLines({ ...common, venueName: 'Panificio Prova', money });
    const customer = text(lines);
    for (const part of ['Panificio Prova', 'N. 4', 'Anna Finta', 'Consegna: 24/12/2026 09:30', 'Torta su misura', 'I tuoi dati']) {
      expect(customer, part).toContain(part);
    }
    expect(customer).toMatch(/^1,5 kg Focaccia +18,00 €$/m);
    expect(customer).toMatch(/^3 confezioni \(250 g\) Grissini +10,50 €$/m);
    expect(customer).toMatch(/^Totale +42,50 €$/m);
    expect(customer).toMatch(/^Acconto +10,00 €$/m);
    expect(lines.find(l => l.text.startsWith('Da pagare'))).toMatchObject({ style: 'bold' });
    for (const secret of ['333', 'Via Finta', 'Suonare']) expect(customer).not.toContain(secret);
    // Padded lines never pass the paper's width.
    expect(lines.filter(l => / {2,}\S/.test(l.text)).every(l => l.text.length <= COLUMNS)).toBe(true);
  });

  it('⚠️ «plain letters only» is applied before the layout: every price still sits on its line, against the right edge', () => {
    const lines = customerSlipLines({ ...common, venueName: 'Panificio Città', money, plain: true });
    const customer = lines.map(l => l.text).join('\n');
    expect(customer).toMatch(/^1,5 kg Focaccia +18,00 EUR$/m);
    expect(customer).toMatch(/^Da pagare +32,50 EUR$/m);
    expect(customer).toContain("Panificio Citta'");
    expect(customer).not.toMatch(/[^\x20-\x7e\n]/);
    expect(lines.filter(l => /\S {2,}\S/.test(l.text)).every(l => l.text.length === COLUMNS)).toBe(true);
    expect(text(labSlipLines({ ...common, plain: true }))).toContain("giovedi' 24 dicembre - 09:30");
  });

  it('puts a figure against the right edge, on its own line when the words are too long', () => {
    expect(twoColumns('Totale', '42,50 €')[0]?.text).toHaveLength(COLUMNS);
    const long = twoColumns('x'.repeat(40), '42,50 €');
    expect(long).toHaveLength(2);
    expect(long[1]?.text).toBe(`${' '.repeat(COLUMNS - 7)}42,50 €`);
    expect(twoColumns('Solo', '')).toEqual([{ text: 'Solo', style: 'normal' }]);
  });
});
