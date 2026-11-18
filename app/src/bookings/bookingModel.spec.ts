import { describe, expect, it } from 'vitest';
import {
  LIMITS, blankLine, boxNumber, choiceForDate, dayAfter, draftFrom, emptyDraft, firstProblem, groupsFor, nextNumber, oldestKeptDay,
  parseMoney, parseQty, readBooking, recipeIdFor, sameDraft, sortForDay, stillToHandOver, toBookingData, toPay,
} from './bookingModel';
import type { Booking, Draft } from './bookingModel';
import { bookingFixture } from '../testing/fakeBookingsSource';

// ⚠️ Fake customers only (P13).
let key = 0;
const nextKey = () => { key += 1; return key; };

const good: Draft = {
  customerName: ' Mario Prova ', phone: '+39 333 000 0000', mode: 'pickup', address: 'kept only for a delivery',
  date: '2026-12-24', time: '09:30',
  lines: [{ key: 1, name: 'Panettone', qty: '2', unit: 'pcs', note: '' }, { key: 2, name: 'focaccia ', qty: '1,5', unit: 'kg', note: ' sliced ' }],
  deposit: '10', total: '42,50', notes: '',
};
const ctx = { today: '2026-11-18', isNew: true };

describe('readBooking', () => {
  it('reads a stored booking', () => {
    const b = readBooking('A', {
      customerName: 'Mario Prova', phone: '+39 1', mode: 'delivery', address: 'Via Finta 1', date: '2026-12-24', time: '09:30',
      lines: [{ recipeId: 'R1', name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' }, { name: 'Pane', qty: 2, unit: 'pcs' }],
      deposit: 10, total: 42.5, notes: 'x', status: 'ready', number: 7,
    });
    expect(b).toEqual({
      id: 'A', customerName: 'Mario Prova', phone: '+39 1', mode: 'delivery', address: 'Via Finta 1', date: '2026-12-24', time: '09:30',
      lines: [{ recipeId: 'R1', name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' }, { recipeId: null, name: 'Pane', qty: 2, unit: 'pcs', note: '' }],
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
    expect(empty.lines).toHaveLength(1);
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
    expect(firstProblem({ ...good, lines: [good.lines[0]!, { key: 3, name: '', qty: '2', unit: 'pcs', note: '' }] }, ctx))
      .toEqual({ field: { line: 1, part: 'name' }, reason: 'required' });
    expect(firstProblem({ ...good, lines: [{ key: 3, name: 'Pane', qty: '', unit: 'pcs', note: '' }] }, ctx))
      .toEqual({ field: { line: 0, part: 'qty' }, reason: 'required' });
    expect(firstProblem({ ...good, lines: [{ key: 3, name: 'Pane', qty: '0', unit: 'pcs', note: '' }] }, ctx))
      .toEqual({ field: { line: 0, part: 'qty' }, reason: 'qty' });
  });
});

describe('toBookingData: what is written', () => {
  const recipes = [{ id: 'R1', name: 'Focaccia' }, { id: 'R2', name: 'Panettone classico' }];

  it('trims, links a product to the recipe book by its exact name, and drops blank rows and a pickup\'s address', () => {
    const data = toBookingData({ ...good, lines: [...good.lines, blankLine(9)] }, { status: 'todo', number: 7, recipes });
    expect(data).toEqual({
      customerName: 'Mario Prova', phone: '+39 333 000 0000', mode: 'pickup', address: '', date: '2026-12-24', time: '09:30',
      lines: [
        { recipeId: null, name: 'Panettone', qty: 2, unit: 'pcs' },
        { recipeId: 'R1', name: 'focaccia', qty: 1.5, unit: 'kg', note: 'sliced' },
      ],
      deposit: 10, total: 42.5, notes: '', status: 'todo', number: 7,
    });
  });

  it('keeps a delivery\'s address and clamps everything to the rules\' bounds', () => {
    const data = toBookingData({
      ...good, mode: 'delivery', address: 'a'.repeat(300), customerName: 'n'.repeat(100), notes: 'x'.repeat(900),
      lines: Array.from({ length: 60 }, (_, i) => ({ key: i, name: 'p'.repeat(200), qty: '1', unit: 'pcs' as const, note: '' })),
    }, { status: 'ready', number: 99999, recipes: [] });
    expect(data.address).toHaveLength(LIMITS.address);
    expect(data.customerName).toHaveLength(LIMITS.customerName);
    expect(data.notes).toHaveLength(LIMITS.notes);
    expect(data.lines).toHaveLength(LIMITS.lines);
    expect(data.lines[0]?.name).toHaveLength(LIMITS.lineName);
    expect(data.number).toBe(LIMITS.number);
  });

  it('round-trips: a stored booking opened and saved unchanged writes the same', () => {
    const stored: Booking = bookingFixture({ id: 'A', lines: [{ recipeId: 'R1', name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' }], deposit: 5, total: 20 });
    const draft = draftFrom(stored, nextKey, ',');
    expect(sameDraft(draft, draftFrom(stored, nextKey, ','))).toBe(true);
    const data = toBookingData(draft, { status: stored.status, number: stored.number, recipes });
    expect(data.lines).toEqual([{ recipeId: 'R1', name: 'Focaccia', qty: 1.5, unit: 'kg', note: 'sliced' }]);
    expect(data.deposit).toBe(5);
    expect(data.total).toBe(20);
  });

  it('finds a recipe whatever the case and the spaces', () => {
    expect(recipeIdFor('  panettone   CLASSICO ', recipes)).toBe('R2');
    expect(recipeIdFor('Panettone', recipes)).toBeNull();
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

  it('groups the four choices', () => {
    expect(groupsFor(list, { kind: 'today' }, today).map(g => [g.date, g.bookings.map(b => b.id)])).toEqual([[today, ['t1', 't2', 'tx']]]);
    expect(groupsFor(list, { kind: 'tomorrow' }, today)[0]?.bookings.map(b => b.id)).toEqual(['tm']);
    expect(groupsFor(list, { kind: 'later' }, today).map(g => g.date)).toEqual(['2026-11-25', '2026-12-24']);
    expect(groupsFor(list, { kind: 'past', date: '2026-11-10' }, today)[0]?.bookings.map(b => b.id)).toEqual(['p']);
    expect(groupsFor([], { kind: 'today' }, today)).toEqual([{ date: today, bookings: [] }]);
  });

  it('opens the list on a booking\'s day after a save', () => {
    expect(choiceForDate(today, today)).toEqual({ kind: 'today' });
    expect(choiceForDate('2026-11-19', today)).toEqual({ kind: 'tomorrow' });
    expect(choiceForDate('2026-11-30', today)).toEqual({ kind: 'later' });
    expect(choiceForDate('2026-11-01', today)).toEqual({ kind: 'past', date: '2026-11-01' });
  });

  it('lists today\'s bookings still to hand over for the Home', () => {
    const shown = stillToHandOver([...list, bookingFixture({ id: 'done', date: today, status: 'collected' })], today);
    expect(shown.map(b => b.id)).toEqual(['t1', 't2']);
  });
});
