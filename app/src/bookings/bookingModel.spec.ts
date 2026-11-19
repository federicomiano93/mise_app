import { describe, expect, it } from 'vitest';
import {
  LIMITS, blankLine, boxNumber, calendarWeeks, dayAfter, dayCounts, dayRows, dayToShow, draftFrom, emptyDraft, firstProblem, foldForSearch,
  isOpen, monthAfter, monthOf, monthRange, nextNumber, oldestKeptDay,
  effectiveTotal, linePrice, listTotal, parseMoney, parseQty, readBooking, sameDraft, sortForDay, stillToHandOver, toBookingData, toPay,
  NO_FORM_RULES, phoneStorable, bookingTimeLabel, pickedLine, weightPrice, weightStorable,
  monthMayBeCut,
} from './bookingModel';
import type { Booking, Draft, FormRules } from './bookingModel';
import { bookingFixture, priceListOf } from '../testing/fakeBookingsSource';

// ⚠️ Fake customers only (P13).
let key = 0;
const nextKey = () => { key += 1; return key; };

const good: Draft = {
  customerName: ' Mario Prova ', phone: '+39 333 000 0000', mode: 'pickup', address: 'kept only for a delivery',
  date: '2026-12-24', time: '09:30', slotEnd: '',
  lines: [{ key: 1, name: 'Panettone', qty: '2', unit: 'pcs', weightKg: null, note: '' , kept: null }, { key: 2, name: 'focaccia ', qty: '1,5', unit: 'kg', weightKg: null, note: ' sliced ' , kept: null }],
  deposit: '10', total: '42,50', notes: '',
};
const ctx = { today: '2026-11-18', isNew: true };

describe('readBooking', () => {
  it('reads a stored booking', () => {
    const b = readBooking('A', {
      customerName: 'Mario Prova', phone: '+39 1', mode: 'delivery', address: 'Via Finta 1', date: '2026-12-24', time: '09:30',
      lines: [{ recipeId: 'R1', name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' }, { name: 'Pane', qty: 2, unit: 'pcs', productId: 'p9', unitPrice: 2.5 }],
      deposit: 10, total: 42.5, notes: 'x', status: 'ready', number: 7,
    });
    expect(b).toEqual({
      id: 'A', customerName: 'Mario Prova', phone: '+39 1', mode: 'delivery', address: 'Via Finta 1', date: '2026-12-24', time: '09:30', slotEnd: null,
      lines: [
        { recipeId: 'R1', productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' },
        { recipeId: null, productId: 'p9', unitPrice: 2.5, packSize: null, packUnit: null, weightKg: null, name: 'Pane', qty: 2, unit: 'pcs', note: '' },
      ],
      deposit: 10, total: 42.5, notes: 'x', status: 'ready', number: 7,
    });
  });

  it('draws nothing from a malformed document, and never a NaN', () => {
    expect(readBooking('A', {})).toBeNull();
    expect(readBooking('A', { customerName: 'x', date: '24/12', time: '09:30' })).toBeNull();
    expect(readBooking('A', { customerName: 'x', date: '2026-12-24', time: '9' })).toBeNull();
    const odd = readBooking('A', { customerName: 'x', date: '2026-12-24', time: '09:30', deposit: Number.NaN, total: -3, status: 'lost', lines: [{ name: 'a', qty: Number.NaN }] });
    expect(odd?.deposit).toBeNull();
    expect(odd?.total).toBeNull();
    expect(odd?.status).toBe('todo');
    expect(odd?.lines).toEqual([]);
  });
});

describe('numbers typed in a box', () => {
  it('reads money with either decimal mark, rounded to cents, and refuses the rest', () => {
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(' 12,5 ')).toBe(12.5);
    expect(parseMoney('12.345')).toBe(12.35);
    expect(parseMoney('0')).toBe(0);
    for (const bad of ['-1', 'abc', '1.234,50', '12,5,0', String(LIMITS.money + 1), 'NaN', 'Infinity']) expect(parseMoney(bad), bad).toBe('invalid');
  });

  it('reads a quantity above zero: whole for pieces, grams for kilos', () => {
    expect(parseQty('', 'pcs')).toBeNull();
    expect(parseQty('3', 'pcs')).toBe(3);
    expect(parseQty('1,5', 'pcs')).toBe('invalid');
    expect(parseQty('1,2345', 'kg')).toBe(1.235);
    for (const bad of ['0', '-2', 'x', '0,0001', String(LIMITS.qty + 1)]) expect(parseQty(bad, 'kg'), bad).toBe('invalid');
  });

  it('works out what is left to pay only when both are known, never below zero', () => {
    expect(toPay(42.5, 10)).toBe(32.5);
    expect(toPay(10, 20)).toBe(0);
    expect(toPay(null, 10)).toBeNull();
    expect(toPay(10, null)).toBeNull();
  });

  it('shows a stored number in a box with the money\'s decimal mark', () => {
    expect(boxNumber(1.5, ',')).toBe('1,5');
    expect(boxNumber(1.5, '.')).toBe('1.5');
    expect(boxNumber(null, ',')).toBe('');
  });
});

describe('firstProblem: the first field to put right, in the order of the form', () => {
  it('accepts a complete booking', () => {
    expect(firstProblem(good, ctx)).toBeNull();
  });

  it('a new booking starts empty, and the name is the first thing asked', () => {
    const empty = emptyDraft(nextKey);
    expect(empty.mode).toBeNull();
    // No card yet: the product window adds them one by one (bookings rebuild step 2).
    expect(empty.lines).toHaveLength(0);
    expect(firstProblem(empty, ctx)).toEqual({ field: 'customerName', reason: 'required' });
  });

  it('walks the fields in order', () => {
    expect(firstProblem({ ...good, phone: '' }, ctx)).toEqual({ field: 'phone', reason: 'required' });
    expect(firstProblem({ ...good, phone: '333-CALL' }, ctx)).toEqual({ field: 'phone', reason: 'phone' });
    expect(firstProblem({ ...good, phone: '1'.repeat(31) }, ctx)).toEqual({ field: 'phone', reason: 'phone' });
    expect(firstProblem({ ...good, mode: null }, ctx)).toEqual({ field: 'mode', reason: 'required' });
    expect(firstProblem({ ...good, mode: 'delivery', address: ' ' }, ctx)).toEqual({ field: 'address', reason: 'required' });
    expect(firstProblem({ ...good, date: '' }, ctx)).toEqual({ field: 'date', reason: 'required' });
    expect(firstProblem({ ...good, date: '2026-11-17' }, ctx)).toEqual({ field: 'date', reason: 'pastDate' });
    expect(firstProblem({ ...good, time: '' }, ctx)).toEqual({ field: 'time', reason: 'required' });
    expect(firstProblem({ ...good, deposit: 'x' }, ctx)).toEqual({ field: 'deposit', reason: 'money' });
    expect(firstProblem({ ...good, total: '-1' }, ctx)).toEqual({ field: 'total', reason: 'money' });
  });

  it('an existing booking keeps a day already gone (it is being corrected, not made)', () => {
    expect(firstProblem({ ...good, date: '2026-11-01' }, { today: '2026-11-18', isNew: false })).toBeNull();
  });

  it('needs at least one product, ignores blank rows and checks each used row', () => {
    expect(firstProblem({ ...good, lines: [blankLine(9)] }, ctx)).toEqual({ field: { line: 0, part: 'name' }, reason: 'noLines' });
    expect(firstProblem({ ...good, lines: [...good.lines, blankLine(9)] }, ctx)).toBeNull();
    expect(firstProblem({ ...good, lines: [good.lines[0]!, { key: 3, name: '', qty: '2', unit: 'pcs', weightKg: null, note: '' , kept: null }] }, ctx))
      .toEqual({ field: { line: 1, part: 'name' }, reason: 'required' });
    expect(firstProblem({ ...good, lines: [{ key: 3, name: 'Pane', qty: '', unit: 'pcs', weightKg: null, note: '' , kept: null }] }, ctx))
      .toEqual({ field: { line: 0, part: 'qty' }, reason: 'required' });
    expect(firstProblem({ ...good, lines: [{ key: 3, name: 'Pane', qty: '0', unit: 'pcs', weightKg: null, note: '' , kept: null }] }, ctx))
      .toEqual({ field: { line: 0, part: 'qty' }, reason: 'qty' });
  });
});

describe('toBookingData: what is written', () => {
  // The published price list (bookings step 2): Focaccia by the kilo, Panettone by the piece.
  const items = priceListOf([
    { productId: 'pF', name: 'Focaccia', price: 12, per: 'kg' },
    { productId: 'pP', name: 'Panettone', price: 25, per: 'piece' },
  ]).items;

  it('trims, prices a product on the list by its exact name, drops blank rows and a pickup\'s address; a typed total wins', () => {
    const data = toBookingData({ ...good, lines: [...good.lines, blankLine(9)] }, { status: 'todo', number: 7, items });
    expect(data).toEqual({
      customerName: 'Mario Prova', phone: '+39 333 000 0000', mode: 'pickup', address: '', date: '2026-12-24', time: '09:30', slotEnd: null,
      lines: [
        { recipeId: null, productId: 'pP', unitPrice: 25, name: 'Panettone', qty: 2, unit: 'pcs' },
        { recipeId: null, productId: 'pF', unitPrice: 12, name: 'focaccia', qty: 1.5, unit: 'kg', note: 'sliced' },
      ],
      deposit: 10, total: 42.5, notes: '', status: 'todo', number: 7,
    });
  });

  it('an empty total box takes the price list\'s sum; free text adds nothing and is counted', () => {
    const draft = { ...good, total: '', lines: [...good.lines, { key: 5, name: 'Torta su misura', qty: '1', unit: 'pcs' as const, weightKg: null, note: '', kept: null }] };
    expect(listTotal(draft, items)).toEqual({ total: 68, unpriced: 1 });
    expect(effectiveTotal(draft, items)).toBe(68);
    expect(toBookingData(draft, { status: 'todo', number: 1, items }).total).toBe(68);
    expect(toBookingData(draft, { status: 'todo', number: 1, items }).lines[2]).toMatchObject({ productId: null, unitPrice: null });
    expect(toBookingData({ ...draft, lines: [draft.lines[2]!] }, { status: 'todo', number: 1, items: [] }).total).toBeNull();
  });

  it('a listed product is counted in the list\'s unit, whatever the row said', () => {
    const line = { key: 1, name: 'Focaccia', qty: '2', unit: 'pcs' as const, weightKg: null, note: '', kept: null };
    expect(linePrice(line, items)).toMatchObject({ kind: 'listed', unit: 'kg' });
    expect(toBookingData({ ...good, lines: [line] }, { status: 'todo', number: 1, items }).lines[0]).toMatchObject({ unit: 'kg', unitPrice: 12 });
  });

  it('keeps a delivery\'s address and clamps everything to the rules\' bounds', () => {
    const data = toBookingData({
      ...good, mode: 'delivery', address: 'a'.repeat(300), customerName: 'n'.repeat(100), notes: 'x'.repeat(900),
      lines: Array.from({ length: 60 }, (_, i) => ({ key: i, name: 'p'.repeat(200), qty: '1', unit: 'pcs' as const, weightKg: null, note: '', kept: null })),
    }, { status: 'ready', number: 99999, items: [] });
    expect(data.address).toHaveLength(LIMITS.address);
    expect(data.customerName).toHaveLength(LIMITS.customerName);
    expect(data.notes).toHaveLength(LIMITS.notes);
    expect(data.lines).toHaveLength(LIMITS.lines);
    expect(data.lines[0]?.name).toHaveLength(LIMITS.lineName);
    expect(data.number).toBe(LIMITS.number);
  });

  it('round-trips: a stored booking opened and saved unchanged writes the same, a step-1 recipe link kept', () => {
    const stored: Booking = bookingFixture({ id: 'A', lines: [{ recipeId: 'R1', productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'Focaccia alta', qty: 1.5, unit: 'kg', note: 'sliced' }], deposit: 5, total: 20 });
    const draft = draftFrom(stored, nextKey, ',');
    expect(sameDraft(draft, draftFrom(stored, nextKey, ','))).toBe(true);
    // A name differing only by spaces at its ends is no change (a name picked from the suggestions ends in one).
    expect(sameDraft(draft, { ...draft, customerName: ` ${draft.customerName} ` })).toBe(true);
    expect(sameDraft(draft, { ...draft, customerName: `${draft.customerName}x` })).toBe(false);
    const data = toBookingData(draft, { status: stored.status, number: stored.number, items });
    expect(data.lines).toEqual([{ recipeId: 'R1', productId: null, unitPrice: null, name: 'Focaccia alta', qty: 1.5, unit: 'kg', note: 'sliced' }]);
    expect(data.deposit).toBe(5);
    expect(data.total).toBe(20);
  });

  it('⚠️ a saved line keeps its price while its name and unit stay — a new price list does not change it', () => {
    const stored = bookingFixture({ id: 'A', total: 20, lines: [{ recipeId: null, productId: 'pF', unitPrice: 10, packSize: null, packUnit: null, weightKg: null, name: 'Focaccia', qty: 2, unit: 'kg', note: '' }] });
    const draft = draftFrom(stored, nextKey, ',');
    // The total is the lines' own sum: the box starts empty, so it keeps following the lines.
    expect(draft.total).toBe('');
    expect(linePrice(draft.lines[0]!, items)).toEqual({ kind: 'frozen', productId: 'pF', unitPrice: 10, packSize: null, packUnit: null });
    const more = { ...draft, lines: [{ ...draft.lines[0]!, qty: '3' }] };
    expect(toBookingData(more, { status: 'todo', number: 1, items })).toMatchObject({ total: 30, lines: [{ unitPrice: 10, qty: 3 }] });
    // Another product typed in its place takes today's list price.
    const other = { ...draft, lines: [{ ...draft.lines[0]!, name: 'Panettone', unit: 'pcs' as const, qty: '1' }] };
    expect(toBookingData(other, { status: 'todo', number: 1, items })).toMatchObject({ total: 25, lines: [{ productId: 'pP', unitPrice: 25 }] });
  });

  it('⚠️ a saved line with no price stays without one, even once its name is on the list, while it is left as it was', () => {
    const stored = bookingFixture({ id: 'A', lines: [{ recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'Panettone', qty: 1, unit: 'kg', note: '' }] });
    const draft = draftFrom(stored, nextKey, ',');
    expect(linePrice(draft.lines[0]!, items)).toEqual({ kind: 'none' });
    expect(toBookingData(draft, { status: 'todo', number: 1, items }).lines[0]).toMatchObject({ unitPrice: null, unit: 'kg' });
  });

  it('checks a listed product\'s quantity in the list\'s unit', () => {
    const line = { key: 1, name: 'Panettone', qty: '1,5', unit: 'kg' as const, weightKg: null, note: '', kept: null };
    expect(firstProblem({ ...good, lines: [line] }, { ...ctx, items })).toEqual({ field: { line: 0, part: 'qty' }, reason: 'qty' });
    expect(firstProblem({ ...good, lines: [line] }, ctx)).toBeNull();
  });

  it('stops a total over the bound, typed or from the list', () => {
    const line = { key: 1, name: 'Panettone', qty: '5000', unit: 'pcs' as const, weightKg: null, note: '', kept: null };
    expect(firstProblem({ ...good, total: '', lines: [line] }, { ...ctx, items })).toEqual({ field: 'total', reason: 'tooHigh' });
  });

  it('a product sold by the pack keeps what one pack holds, from the list and once saved', () => {
    const packs = priceListOf([{ productId: 'pG', name: 'Grissini', price: 3.5, per: 'pack', packSize: 250, packUnit: 'g' }]).items;
    const line = { key: 1, name: 'Grissini', qty: '3', unit: 'pcs' as const, weightKg: null, note: '', kept: null };
    const data = toBookingData({ ...good, lines: [line] }, { status: 'todo', number: 1, items: packs });
    expect(data.lines[0]).toEqual({ recipeId: null, productId: 'pG', unitPrice: 3.5, name: 'Grissini', qty: 3, unit: 'pcs', packSize: 250, packUnit: 'g' });
    // Saved and opened again with a price list that no longer has it: the pack's size stays with the frozen price.
    const stored = bookingFixture({ id: 'A', lines: [{ ...data.lines[0]!, note: '', recipeId: null, packSize: 250, packUnit: 'g', weightKg: null }] });
    const again = toBookingData(draftFrom(stored, nextKey, ','), { status: 'todo', number: 1, items: [] });
    expect(again.lines[0]).toMatchObject({ unitPrice: 3.5, packSize: 250, packUnit: 'g' });
    expect(readBooking('A', { customerName: 'x', date: '2026-12-24', time: '09:30', lines: [{ name: 'G', qty: 2, unit: 'pcs', packSize: -1, packUnit: 'g' }] })?.lines[0])
      .toMatchObject({ packSize: null, packUnit: null });
  });

  it('a total typed at the counter (a discount) is shown in the box when the booking is opened again', () => {
    const stored = bookingFixture({ id: 'A', total: 18, lines: [{ recipeId: null, productId: 'pF', unitPrice: 10, packSize: null, packUnit: null, weightKg: null, name: 'Focaccia', qty: 2, unit: 'kg', note: '' }] });
    expect(draftFrom(stored, nextKey, ',').total).toBe('18');
  });
});

describe('the short number', () => {
  it('is one more than the highest, starting at 1 and coming round after 9999', () => {
    expect(nextNumber([])).toBe(1);
    expect(nextNumber([bookingFixture({ id: 'a', number: 4 }), bookingFixture({ id: 'b', number: 9 })])).toBe(10);
    expect(nextNumber([bookingFixture({ id: 'a', number: 9999 })])).toBe(1);
  });
});

describe('days', () => {
  const today = '2026-11-18';
  const list = [
    bookingFixture({ id: 't2', date: today, time: '11:00', number: 2 }),
    bookingFixture({ id: 't1', date: today, time: '09:00', number: 3 }),
    bookingFixture({ id: 'tx', date: today, time: '08:00', status: 'cancelled' }),
    bookingFixture({ id: 'tm', date: '2026-11-19' }),
    bookingFixture({ id: 'l2', date: '2026-12-24' }),
    bookingFixture({ id: 'l1', date: '2026-11-25' }),
    bookingFixture({ id: 'p', date: '2026-11-10' }),
  ];

  it('keeps 30 days back', () => {
    expect(oldestKeptDay(today)).toBe('2026-10-19');
    expect(dayAfter('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('sorts a day by time, cancelled last', () => {
    expect(sortForDay(list.filter(b => b.date === today)).map(b => b.id)).toEqual(['t1', 't2', 'tx']);
  });

  it('the calendar\'s months: the next, the one before, across the year, and the days a month query reads', () => {
    expect(monthOf('2026-12-24')).toBe('2026-12');
    expect(monthAfter('2026-12', 1)).toBe('2027-01');
    expect(monthAfter('2026-01', -1)).toBe('2025-12');
    expect(monthAfter('2026-11', 14)).toBe('2028-01');
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', until: '2027-01-01' });
    expect(monthRange('2027-02')).toEqual({ from: '2027-02-01', until: '2027-03-01' });
  });

  it('⚠️ the calendar starts on MONDAY: blanks before the 1st, every day once, whole weeks', () => {
    // 1 December 2026 is a Tuesday: one blank (Monday) before it.
    const december = calendarWeeks('2026-12');
    expect(december[0]).toEqual([null, '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06']);
    expect(december.every(week => week.length === 7)).toBe(true);
    expect(december.flat().filter(Boolean)).toHaveLength(31);
    expect(december.at(-1)).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', null, null, null]);
    // 1 February 2027 is a Monday: no blank at all, four whole weeks.
    expect(calendarWeeks('2027-02')[0]?.[0]).toBe('2027-02-01');
    expect(calendarWeeks('2027-02')).toHaveLength(4);
    // 1 November 2026 is a Sunday: six blanks.
    expect(calendarWeeks('2026-11')[0]?.filter(cell => cell === null)).toHaveLength(6);
  });

  it('⚠️ counts a day\'s bookings for the badge WITHOUT the cancelled ones', () => {
    const counts = dayCounts(list);
    expect(counts.get(today)).toBe(2);
    expect(counts.get('2026-12-24')).toBe(1);
    expect(counts.get('2026-11-30')).toBeUndefined();
    expect(dayCounts([bookingFixture({ id: 'c', date: today, status: 'cancelled' })]).get(today)).toBeUndefined();
  });

  it('a month opens on today when it holds it, else on its 1st', () => {
    expect(dayToShow('2026-11', today)).toBe(today);
    expect(dayToShow('2026-12', today)).toBe('2026-12-01');
  });

  it('«Cerca per nome» keeps the day\'s rows whose name holds the words, case and accents folded', () => {
    const day = [
      bookingFixture({ id: 'n1', date: today, time: '09:00', customerName: 'Niccolò Rossi' }),
      bookingFixture({ id: 'n2', date: today, time: '10:00', customerName: 'ANNA ROSSINI' }),
      bookingFixture({ id: 'n3', date: today, time: '08:00', customerName: 'Luca Verdi' }),
      bookingFixture({ id: 'n4', date: '2026-11-20', customerName: 'Rossi Altro Giorno' }),
    ];
    expect(foldForSearch('  Niccolò   ROSSI ')).toBe('niccolo rossi');
    expect(dayRows(day, today).map(b => b.id)).toEqual(['n3', 'n1', 'n2']);
    expect(dayRows(day, today, 'rossi').map(b => b.id)).toEqual(['n1', 'n2']);
    expect(dayRows(day, today, 'NICCOLO').map(b => b.id)).toEqual(['n1']);
    expect(dayRows(day, today, 'àNNa').map(b => b.id)).toEqual(['n2']);
    expect(dayRows(day, today, 'bianchi')).toEqual([]);
  });

  it('⚠️ a stored `todo` and a stored `ready` both read as open; collected and cancelled do not', () => {
    expect(isOpen('todo')).toBe(true);
    expect(isOpen('ready')).toBe(true);
    expect(isOpen('collected')).toBe(false);
    expect(isOpen('cancelled')).toBe(false);
  });

  it('lists today\'s bookings still to hand over for the Home', () => {
    const shown = stillToHandOver([...list, bookingFixture({ id: 'done', date: today, status: 'collected' }), bookingFixture({ id: 'rd', date: today, time: '23:00', status: 'ready' })], today);
    expect(shown.map(b => b.id)).toEqual(['t1', 't2', 'rd']);
  });
});

// ── Bookings settings (18 Nov 2026): the form obeys the venue ─────────────────
describe('firstProblem with the venue\'s settings', () => {
  const slots = [{ start: '09:00', end: '10:00' }, { start: '10:00', end: '11:00' }];
  const rules = (over: Partial<FormRules> = {}): FormRules => ({ ...NO_FORM_RULES, ...over });

  it('the phone is required only where the venue asks for it', () => {
    expect(firstProblem({ ...good, phone: '' }, ctx)).toEqual({ field: 'phone', reason: 'required' });
    expect(firstProblem({ ...good, phone: '' }, { ...ctx, rules: rules({ askPhone: false }) })).toBeNull();
    // Not asked: whatever the box held is not judged (it is not on the form).
    expect(firstProblem({ ...good, phone: 'abc' }, { ...ctx, rules: rules({ askPhone: false }) })).toBeNull();
  });

  it('⚠️ phone optional: no phone is written as \'\', and a phone the rules would refuse is never written', () => {
    expect(toBookingData({ ...good, phone: '' }, { status: 'todo', number: 1, items: [] }).phone).toBe('');
    expect(toBookingData({ ...good, phone: 'abc' }, { status: 'todo', number: 1, items: [] }).phone).toBe('');
    expect(phoneStorable('')).toBe(true);
    expect(phoneStorable('+39 333')).toBe(true);
    expect(phoneStorable('  ')).toBe(false);
    expect(phoneStorable('1'.repeat(31))).toBe(false);
  });

  it('with slots: a slot must be chosen, and saving writes its start and end', () => {
    const r = rules({ slots });
    expect(firstProblem({ ...good, time: '' }, { ...ctx, rules: r })).toEqual({ field: 'time', reason: 'required' });
    expect(firstProblem({ ...good, time: '09:30', slotEnd: '' }, { ...ctx, rules: r })).toEqual({ field: 'time', reason: 'required' });
    const chosen = { ...good, time: '09:00', slotEnd: '10:00' };
    expect(firstProblem(chosen, { ...ctx, rules: r })).toBeNull();
    expect(toBookingData(chosen, { status: 'todo', number: 1, items: [] })).toMatchObject({ time: '09:00', slotEnd: '10:00' });
  });

  it('without slots the exact time, and no slotEnd written', () => {
    expect(toBookingData({ ...good, slotEnd: '' }, { status: 'todo', number: 1, items: [] }).slotEnd).toBeNull();
    // A slot end that is not after the time is never written.
    expect(toBookingData({ ...good, time: '10:00', slotEnd: '09:00' }, { status: 'todo', number: 1, items: [] }).slotEnd).toBeNull();
  });

  it('a full slot is refused on Save; another booking\'s cancellation frees it', () => {
    const DAY = good.date;
    const taken = [bookingFixture({ id: 'x', date: DAY, time: '09:00', slotEnd: '10:00' })];
    const chosen = { ...good, time: '09:00', slotEnd: '10:00' };
    expect(firstProblem(chosen, { ...ctx, rules: rules({ slots, slotLimit: 1, bookings: taken }) })).toEqual({ field: 'time', reason: 'slotFull' });
    expect(firstProblem(chosen, { ...ctx, rules: rules({ slots, slotLimit: 2, bookings: taken }) })).toBeNull();
    const cancelled = [{ ...taken[0]!, status: 'cancelled' as const }];
    expect(firstProblem(chosen, { ...ctx, rules: rules({ slots, slotLimit: 1, bookings: cancelled }) })).toBeNull();
    // No limit: never full.
    expect(firstProblem(chosen, { ...ctx, rules: rules({ slots, bookings: taken }) })).toBeNull();
  });

  it('⚠️ the booking being edited keeps its place in a slot that is full now, and is not counted twice', () => {
    const DAY = good.date;
    const self = bookingFixture({ id: 'me', date: DAY, time: '09:00', slotEnd: '10:00' });
    const other = bookingFixture({ id: 'x', date: DAY, time: '09:00', slotEnd: '10:00' });
    const editing = { id: 'me', date: DAY, time: '09:00', slotEnd: '10:00' };
    const chosen = { ...good, time: '09:00', slotEnd: '10:00' };
    // The slot holds two with a limit of 1 (two tablets in the same second): an edit of either still saves.
    expect(firstProblem(chosen, { ...ctx, isNew: false, rules: rules({ slots, slotLimit: 1, bookings: [self, other], editing }) })).toBeNull();
    // Limit 2, only itself and one other: room — it is not counted as well as stored.
    expect(firstProblem(chosen, { ...ctx, isNew: false, rules: rules({ slots, slotLimit: 2, bookings: [self, other], editing }) })).toBeNull();
    // Moving it to a slot that is full is refused.
    const full = [self, bookingFixture({ id: 'y', date: DAY, time: '10:00', slotEnd: '11:00' })];
    expect(firstProblem({ ...good, time: '10:00', slotEnd: '11:00' }, { ...ctx, isNew: false, rules: rules({ slots, slotLimit: 1, bookings: full, editing }) }))
      .toEqual({ field: 'time', reason: 'slotFull' });
  });

  it('an old booking with an exact time not on a slot keeps that time: nothing is lost', () => {
    const editing = { id: 'me', date: good.date, time: '09:30', slotEnd: '' };
    expect(firstProblem({ ...good, time: '09:30', slotEnd: '' }, { ...ctx, isNew: false, rules: rules({ slots, editing }) })).toBeNull();
    // …but a new exact time is not offered once the venue has slots.
    expect(firstProblem({ ...good, time: '09:40', slotEnd: '' }, { ...ctx, isNew: false, rules: rules({ slots, editing }) }))
      .toEqual({ field: 'time', reason: 'required' });
  });

  it('a new booking starts on the day the list shows, and in the venue\'s only mode', () => {
    expect(emptyDraft(nextKey, { date: '2026-12-24', mode: 'pickup' })).toMatchObject({ date: '2026-12-24', mode: 'pickup', slotEnd: '' });
    expect(emptyDraft(nextKey)).toMatchObject({ date: '', mode: null });
  });

  it('readBooking reads slotEnd only when it is after the time', () => {
    const base = { customerName: 'Mario Prova', phone: '', mode: 'pickup', date: '2026-12-24', time: '09:00', lines: [] };
    expect(readBooking('A', { ...base, slotEnd: '10:00' })?.slotEnd).toBe('10:00');
    expect(readBooking('A', { ...base, slotEnd: '08:00' })?.slotEnd).toBeNull();
    expect(readBooking('A', base)?.slotEnd).toBeNull();
    expect(readBooking('A', base)?.phone).toBe('');
  });
});

describe('the kept exact time belongs to its own day', () => {
  it('moved to another day, an old exact time must become a slot', () => {
    const slots = [{ start: '09:00', end: '10:00' }];
    const editing = { id: 'me', date: '2026-12-24', time: '09:40', slotEnd: '' };
    const rules = { ...NO_FORM_RULES, slots, editing };
    expect(firstProblem({ ...good, date: '2026-12-24', time: '09:40', slotEnd: '' }, { ...ctx, isNew: false, rules })).toBeNull();
    expect(firstProblem({ ...good, date: '2026-12-23', time: '09:40', slotEnd: '' }, { ...ctx, isNew: false, rules }))
      .toEqual({ field: 'time', reason: 'required' });
  });
});

describe('bookingTimeLabel', () => {
  it('a slot reads start–end, a booking with only a time reads the time', () => {
    expect(bookingTimeLabel({ time: '10:00', slotEnd: '12:00' })).toBe('10:00–12:00');
    expect(bookingTimeLabel({ time: '10:00', slotEnd: null })).toBe('10:00');
  });
});

describe('a piece of a chosen weight (bookings rebuild step 2)', () => {
  const items = priceListOf([
    { productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg', weights: [1, 1.5] },
    { productId: 'pP', name: 'Panettone', price: 25, per: 'piece' },
  ]).items;
  const scacciata = items[1]!;

  it('a picked line is one piece of that weight, counted in pieces, its note the window\'s', () => {
    const line = pickedLine(7, { name: 'Scacciata broccoli', item: scacciata, weightKg: 1.5, note: 'senza cipolla, + provola' });
    expect(line).toEqual({ key: 7, name: 'Scacciata broccoli', qty: '1', unit: 'pcs', weightKg: 1.5, note: 'senza cipolla, + provola', kept: null });
    // A piece without a weight; a name typed freely; a note cut to the line's bound.
    expect(pickedLine(8, { name: 'Panettone', item: items[0]!, weightKg: null, note: '' })).toMatchObject({ unit: 'pcs', weightKg: null });
    expect(pickedLine(9, { name: ' Torta ', item: null, weightKg: 2, note: 'x'.repeat(200) })).toMatchObject({ name: 'Torta', weightKg: 2 });
    // The window refuses a longer note itself; this cut is only the last guard.
    expect(pickedLine(9, { name: 'Torta', item: null, weightKg: null, note: 'x'.repeat(400) }).note).toHaveLength(LIMITS.lineNote);
    expect(LIMITS.lineNote).toBe(300);
  });

  it('its price is the price per kilo × the weight, to the cent, and the line is that × the pieces', () => {
    expect(weightPrice(16, 1.5)).toBe(24);
    expect(weightPrice(12.99, 0.333)).toBe(4.33);
    const line = { ...pickedLine(1, { name: 'Scacciata broccoli', item: scacciata, weightKg: 1.5, note: '' }), qty: '3' };
    expect(linePrice(line, items)).toMatchObject({ kind: 'listed', unit: 'pcs', unitPrice: 24 });
    expect(listTotal({ ...good, lines: [line] }, items)).toEqual({ total: 72, unpriced: 0 });
  });

  it('is written with weightKg, unit pcs, the pieces as qty and the price of one piece', () => {
    const line = { ...pickedLine(1, { name: 'Scacciata broccoli', item: scacciata, weightKg: 1.5, note: 'senza cipolla' }), qty: '3' };
    const data = toBookingData({ ...good, total: '', lines: [line] }, { status: 'todo', number: 1, items });
    expect(data.lines).toEqual([
      { recipeId: null, productId: 'pS', unitPrice: 24, name: 'Scacciata broccoli', qty: 3, unit: 'pcs', weightKg: 1.5, note: 'senza cipolla' },
    ]);
    expect(data.total).toBe(72);
  });

  it('read back, it keeps its weight and its frozen price, and saves unchanged even after the list changed', () => {
    const stored = readBooking('A', {
      customerName: 'Mario Prova', date: '2026-12-24', time: '09:30',
      lines: [{ recipeId: null, productId: 'pS', unitPrice: 24, name: 'Scacciata broccoli', qty: 3, unit: 'pcs', weightKg: 1.5 }],
    })!;
    expect(stored.lines[0]).toMatchObject({ weightKg: 1.5, unitPrice: 24, qty: 3, unit: 'pcs' });
    const dearer = priceListOf([{ productId: 'pS', name: 'Scacciata broccoli', price: 20, per: 'kg' }]).items;
    const draft = draftFrom(stored, nextKey, ',');
    expect(linePrice(draft.lines[0]!, dearer)).toMatchObject({ kind: 'frozen', unitPrice: 24 });
    const again = toBookingData(draft, { status: 'todo', number: 1, items: dearer });
    expect(again.lines[0]).toEqual({ recipeId: null, productId: 'pS', unitPrice: 24, name: 'Scacciata broccoli', qty: 3, unit: 'pcs', weightKg: 1.5 });
  });

  it('a line from before the weights has none and is written without the key', () => {
    const stored = bookingFixture({ id: 'B' });
    expect(stored.lines[0]?.weightKg).toBeNull();
    const data = toBookingData(draftFrom(stored, nextKey, ','), { status: 'todo', number: 1, items: [] });
    expect(data.lines[0]).not.toHaveProperty('weightKg');
  });

  it('a weight the rules\' bound refuses is read as none, refused by the check, and never written', () => {
    for (const bad of [0, -1, 50.001, '1.5', Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(weightStorable(bad)).toBe(false);
      const read = readBooking('A', { customerName: 'x', date: '2026-12-24', time: '09:30', lines: [{ name: 'S', qty: 1, unit: 'pcs', weightKg: bad }] });
      expect(read?.lines[0]?.weightKg).toBeNull();
    }
    expect(weightStorable(50)).toBe(true);
    expect(weightStorable(0.001)).toBe(true);
    const wrong = { key: 1, name: 'Torta', qty: '1', unit: 'pcs' as const, weightKg: 60, note: '', kept: null };
    expect(firstProblem({ ...good, lines: [wrong] }, ctx)).toEqual({ field: { line: 0, part: 'qty' }, reason: 'qty' });
    expect(toBookingData({ ...good, lines: [wrong] }, { status: 'todo', number: 1, items: [] }).lines[0]).not.toHaveProperty('weightKg');
  });

  it('a change of weight is an unsaved change', () => {
    const line = pickedLine(1, { name: 'Torta', item: null, weightKg: 1, note: '' });
    expect(sameDraft({ ...good, lines: [line] }, { ...good, lines: [{ ...line, weightKg: 1.5 }] })).toBe(false);
  });
});

describe('monthMayBeCut', () => {
  it('is true from the limit up and false below it', () => {
    expect(monthMayBeCut(1499, 1500)).toBe(false);
    expect(monthMayBeCut(1500, 1500)).toBe(true);
    expect(monthMayBeCut(2000, 1500)).toBe(true);
  });
});
