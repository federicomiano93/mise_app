import { describe, expect, it } from 'vitest';
import { moneyOf } from '@mise/shared/currency';
import { bookingFixture } from '../testing/fakeBookingsSource';
import type { BookingLine } from './bookingModel';
import { slipUnitWords } from './bookingWords';
import { BIG_COLUMNS, COLUMNS } from './receiptPrinter';
import { customerSlipLines, labSlipDocuments, labSlipLines, twoColumns } from './slipText';

// The slips as lines for the receipt printer: the same content as the browser's slips (bookings rebuild step 4). ⚠️ Fake customers.

const money = moneyOf('€', { decimal: ',', group: '.', symbolAfter: true });
const words = {
  title: 'Prenotazione N. 12', when: 'Ritiro: gio 24 dic', time: 'dalle 09:00 alle 10:00',
  total: 'Totale', deposit: 'Acconto', toPay: 'Da pagare',
  privacy: 'Il tuo nome serve solo per questo ordine e viene cancellato 30 giorni dopo il ritiro.',
};
const line = (over: Partial<BookingLine>): BookingLine => ({
  recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'X', qty: 1, unit: 'pcs', note: '',
  ...over,
});
const SCACCIATA = line({ productId: 'pS', name: 'Scacciata broccoli', qty: 2, weightKg: 1.5, unitPrice: 24, note: 'senza cipolla, + provola' });
const CANNOLI = line({ productId: 'pC', name: 'Cannoli siciliani', qty: 12, unitPrice: 2 });
const booking = bookingFixture({
  id: 'A', number: 12, customerName: 'Anna Finta', phone: '+39 333 000 0000', mode: 'pickup', address: '',
  date: '2026-12-24', time: '09:00', slotEnd: '10:00', total: 72, deposit: 20, notes: 'Suonare due volte',
  lines: [SCACCIATA, CANNOLI],
});
const paper = { locale: 'it-IT', units: slipUnitWords({ country: 'IT' }) };
// The money is written with a no-break space («48,00 €»); the printer gets a plain one (receiptPrinter's wrapLines).
const text = (lines: ReadonlyArray<{ text: string }>) => lines.map(l => l.text).join('\n').replace(/ /g, ' ');

describe('the lab slips for the receipt printer', () => {
  it('⚠️ one slip: the name with [N] double size, a dashed line, the product bold, each piece of the note double size — nothing else', () => {
    const lines = labSlipLines({ ...paper, who: 'Anna Finta [14]', lines: [{ ...SCACCIATA, qty: 1 }] });
    expect(lines).toEqual([
      { text: 'Anna Finta [14]', style: 'big' },
      { text: '-'.repeat(COLUMNS), style: 'normal' },
      { text: 'Scacciata broccoli 1,5 kg', style: 'bold' },
      { text: 'senza cipolla', style: 'big' },
      { text: '+ provola', style: 'big' },
    ]);
    const all = text(lines);
    // No date, no time, no number, no price, no phone, no address, no booking notes.
    for (const secret of ['24', '09:00', 'N. 12', '€', '48', '333', 'Suonare']) expect(all).not.toContain(secret);
  });

  it('«Uno per pezzo»: one document per slip, so each is cut on its own; a line of 12 cannoli says «12 ×»', () => {
    const docs = labSlipDocuments({ ...paper, who: 'Anna Finta [3]', slips: [[{ ...SCACCIATA, qty: 1 }], [{ ...SCACCIATA, qty: 1 }], [CANNOLI]] });
    expect(docs).toHaveLength(3);
    expect(docs.every(doc => doc[0]?.text === 'Anna Finta [3]')).toBe(true);
    expect(docs[2]?.[2]).toEqual({ text: '12 × Cannoli siciliani', style: 'bold' });
  });

  it('«Tutto insieme»: one document with every product and its note', () => {
    const [doc] = labSlipDocuments({ ...paper, who: 'Anna Finta [14]', slips: [[SCACCIATA, CANNOLI]] });
    expect(text(doc ?? [])).toBe(['Anna Finta [14]', '-'.repeat(COLUMNS), '2 × Scacciata broccoli 1,5 kg', 'senza cipolla', '+ provola',
      '12 × Cannoli siciliani'].join('\n'));
  });
});

describe('the customer slip for the receipt printer', () => {
  const lines = customerSlipLines({ ...paper, booking, words, venueName: 'Panificio Prova', money });
  const customer = text(lines);

  it('the venue, «Prenotazione N. 12», the name double size, the day and the slot', () => {
    expect(lines.slice(0, 5)).toEqual([
      { text: 'Panificio Prova', style: 'bold' },
      { text: 'Prenotazione N. 12', style: 'bold' },
      { text: 'Anna Finta', style: 'big' },
      { text: 'Ritiro: gio 24 dic', style: 'bold' },
      { text: 'dalle 09:00 alle 10:00', style: 'bold' },
    ]);
  });

  it('the numbered lines with what each comes to, the note under its line', () => {
    expect(customer).toMatch(/^1\. 2 × Scacciata broccoli 1,5 kg +48,00 €$/m);
    expect(customer).toMatch(/^ {3}senza cipolla, \+ provola$/m);
    expect(customer).toMatch(/^2\. 12 × Cannoli siciliani +24,00 €$/m);
  });

  it('Totale and Acconto, then Da pagare double size against the edge of its half-width line', () => {
    expect(customer).toMatch(/^Totale +72,00 €$/m);
    expect(customer).toMatch(/^Acconto +20,00 €$/m);
    const due = lines.find(l => l.text.startsWith('Da pagare'));
    expect(due).toMatchObject({ style: 'big' });
    expect(due?.text).toHaveLength(BIG_COLUMNS);
    expect(customer.endsWith(words.privacy)).toBe(true);
    for (const secret of ['333', 'Suonare']) expect(customer).not.toContain(secret);
    // Padded lines never pass the paper's width.
    expect(lines.filter(l => / {2,}\S/.test(l.text)).every(l => l.text.length <= COLUMNS)).toBe(true);
  });

  it('⚠️ «plain letters only» is applied before the layout: every price still sits on its line, against the right edge', () => {
    const plain = customerSlipLines({ ...paper, booking, words, venueName: 'Panificio Città', money, plain: true });
    const all = plain.map(l => l.text).join('\n');
    expect(all).toMatch(/^1\. 2 x Scacciata broccoli 1,5 kg +48,00 EUR$/m);
    expect(all).toContain("Panificio Citta'");
    expect(all).not.toMatch(/[^\x20-\x7e\n]/);
    expect(plain.filter(l => l.style !== 'big' && /\S {2,}\S/.test(l.text)).every(l => l.text.length === COLUMNS)).toBe(true);
    expect(plain.find(l => l.text.startsWith('Da pagare'))?.text).toMatch(/^Da pagare +52,00 EUR$/);
  });

  it('puts a figure against the right edge, on its own line when the words are too long', () => {
    expect(twoColumns('Totale', '42,50 €')[0]?.text).toHaveLength(COLUMNS);
    const long = twoColumns('x'.repeat(40), '42,50 €');
    expect(long).toHaveLength(2);
    expect(long[1]?.text).toBe(`${' '.repeat(COLUMNS - 7)}42,50 €`);
    expect(twoColumns('Solo', '')).toEqual([{ text: 'Solo', style: 'normal' }]);
  });
});
