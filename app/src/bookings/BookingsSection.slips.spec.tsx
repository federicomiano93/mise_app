import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { bookingFixture, fakeBookingsSource, priceListOf } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import type { Booking, BookingLine } from './bookingModel';
import { DEFAULT_SETTINGS } from './bookingSettings';
import type { BookingSettings } from './bookingSettings';
import { slipDay } from './bookingWords';
import { PRINTER_HOST_KEY } from './printerHost';
import { SLIP_HOST_ID, SLIP_PAGE_ID, SLIP_PIECE_PAGE_ID, closeSlipHost } from './slipHost';

// Bookings rebuild step 4: «Laboratorio» asks one slip per piece or all together (only when it means something), the per-piece
// slips, the [N], the highlighted notes, the customer slip, and the same through the receipt printer. ⚠️ Fake customers only.

const LOAD = { timeout: 5000 };
const TODAY = todayISO();
const OK = '<response success="true" code="" status="2"></response>';

const line = (over: Partial<BookingLine>): BookingLine => ({
  recipeId: null, productId: null, unitPrice: null, packSize: null, packUnit: null, weightKg: null, name: 'X', qty: 1, unit: 'pcs', note: '',
  ...over,
});
const SCACCIATA = line({ productId: 'pS', name: 'Scacciata broccoli', qty: 3, weightKg: 1.5, unitPrice: 24, note: 'senza cipolla, + provola' });
const CANNOLI = line({ productId: 'pC', name: 'Cannoli siciliani', qty: 12, unitPrice: 2 });
const PRICES = priceListOf([
  { productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg', perPiece: true },
  { productId: 'pC', name: 'Cannoli siciliani', price: 2, per: 'piece' },
]);
const seed = () => [
  bookingFixture({ id: 'S1', date: TODAY, time: '09:00', slotEnd: '10:00', customerName: 'Anna Finta', phone: '', number: 12,
    lines: [SCACCIATA, CANNOLI], total: 96, deposit: 20 }),
  bookingFixture({ id: 'C1', date: TODAY, time: '11:30', customerName: 'Luca Prova', phone: '', number: 13, lines: [CANNOLI] }),
];

function show(path: string, settings: Partial<BookingSettings> = {}, lang: 'en' | 'it' = 'en') {
  const source = fakeBookingsSource(seed(), PRICES, { ...DEFAULT_SETTINGS, askPhone: false, ...settings });
  return renderApp(path, { lang, session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } });
}

const host = () => document.getElementById(SLIP_HOST_ID) as HTMLElement;
const slips = () => [...host().querySelectorAll('.bk-slip')];

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => {
  localStorage.removeItem(PRINTER_HOST_KEY);
  closeSlipHost();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pressLab(name = 'Anna Finta', label = 'Print for the lab') {
  const view = show(`/bookings/${name === 'Anna Finta' ? 'S1' : 'C1'}`);
  const card = await screen.findByRole('region', { name }, LOAD);
  await view.user.click(within(card).getByRole('button', { name: label }));
  return view;
}

describe('the question «Slips for the lab»', () => {
  it('is asked for a per-piece product with the switch on: two choices, «One per piece» chosen, and no explanation', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await pressLab();
    const question = await screen.findByRole('alertdialog', { name: 'Slips for the lab' });
    expect(within(question).getByRole('radio', { name: 'One per piece' })).toBeChecked();
    expect(within(question).getByRole('radio', { name: 'All together' })).not.toBeChecked();
    // The owner asked for no explanation text: the title, the two choices and the two buttons, nothing more.
    expect(question).not.toHaveAttribute('aria-describedby');
    expect(question.textContent).toBe('Slips for the lab' + 'One per piece' + 'All together' + 'Cancel' + 'Print');
    expect(print).not.toHaveBeenCalled();
  });

  it('⚠️ «Lab» waits for the price list: pressed before it has answered it does nothing, then asks as usual', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const source = fakeBookingsSource(seed(), PRICES, { ...DEFAULT_SETTINGS, askPhone: false });
    // The list's first answer held back.
    let answer: () => void = () => undefined;
    vi.mocked(source.watchPriceList).mockImplementationOnce((onChange: (list: typeof PRICES) => void) => {
      answer = () => { onChange(PRICES); };
      return () => undefined;
    });
    const { user } = renderApp('/bookings/S1', { session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } });
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    const lab = within(card).getByRole('button', { name: 'Print for the lab' });
    await user.click(lab);
    expect(print).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    act(() => { answer(); });
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    expect(await screen.findByRole('alertdialog', { name: 'Slips for the lab' })).toBeInTheDocument();
  });

  it('Cancel prints nothing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await pressLab();
    const question = await screen.findByRole('alertdialog', { name: 'Slips for the lab' });
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById(SLIP_HOST_ID)).toBeNull();
  });

  it('is not asked with the venue\'s switch off: one slip with everything', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/S1', { perPieceSlips: false });
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(slips()).toHaveLength(1);
    // Every line one: [2].
    expect(host().querySelector('.bk-slip-who')).toHaveTextContent('Anna Finta [2]');
  });

  it('is not asked for a booking with no per-piece product', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await pressLab('Luca Prova');
    await waitFor(() => { expect(print).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(slips()).toHaveLength(1);
    expect(host()).toHaveTextContent('Luca Prova [1]');
    expect(host()).toHaveTextContent('12 × Cannoli siciliani');
  });

  it('in Italian: «Biglietti per il laboratorio», «Uno per pezzo», «Tutto insieme», Annulla / Stampa', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/S1', {}, 'it');
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Stampa per laboratorio' }));
    const question = await screen.findByRole('alertdialog', { name: 'Biglietti per il laboratorio' });
    expect(within(question).getByRole('radio', { name: 'Uno per pezzo' })).toBeChecked();
    expect(within(question).getByRole('radio', { name: 'Tutto insieme' })).toBeInTheDocument();
    expect(within(question).getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    expect(within(question).getByRole('button', { name: 'Stampa' })).toBeInTheDocument();
  });
});

describe('the lab slips through the browser', () => {
  it('«One per piece»: 3 scacciate + 12 cannoli give 4 slips, each a page of the short paper, each «Anna Finta [4]»', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await pressLab();
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Slips for the lab' })).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(slips()).toHaveLength(4);
    for (const slip of slips()) expect(slip.querySelector('.bk-slip-who')).toHaveTextContent('Anna Finta [4]');
    // One piece says no quantity, its weight stays; the cannoli are one slip of 12.
    expect(slips()[0]?.querySelector('.bk-slip-product')).toHaveTextContent(/^Scacciata broccoli 1,5 kg$/);
    expect(slips()[3]?.querySelector('.bk-slip-product')).toHaveTextContent(/^12 × Cannoli siciliani$/);
    expect((document.getElementById(SLIP_PIECE_PAGE_ID) as HTMLLinkElement).media).toBe('print');
    expect((document.getElementById(SLIP_PAGE_ID) as HTMLLinkElement).media).toBe('not all');
  });

  it('⚠️ the note is highlighted piece by piece, inline, and the slip has no date, time, number, price, phone or address', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await pressLab();
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Slips for the lab' })).getByRole('button', { name: 'Print' }));
    const first = slips()[0] as HTMLElement;
    const marks = [...first.querySelectorAll('.bk-slip-hl')];
    expect(marks.map(mark => mark.textContent)).toEqual(['senza cipolla', '+ provola']);
    expect(marks.every(mark => mark.tagName === 'SPAN')).toBe(true);
    expect(first.querySelector('strong')).toHaveTextContent('Scacciata broccoli');
    for (const secret of ['09:00', '10:00', 'No. 12', '€', '24,00', 'Pickup']) expect(host(), secret).not.toHaveTextContent(secret);
  });

  it('«All together»: one slip with every line, still [4], on the receipt paper', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await pressLab();
    const question = await screen.findByRole('alertdialog', { name: 'Slips for the lab' });
    await user.click(within(question).getByRole('radio', { name: 'All together' }));
    await user.click(within(question).getByRole('button', { name: 'Print' }));
    expect(slips()).toHaveLength(1);
    expect(host().querySelector('.bk-slip-who')).toHaveTextContent('Anna Finta [4]');
    expect(host()).toHaveTextContent('3 × Scacciata broccoli 1,5 kg');
    expect(host()).toHaveTextContent('12 × Cannoli siciliani');
    expect((document.getElementById(SLIP_PAGE_ID) as HTMLLinkElement).media).toBe('print');
    expect((document.getElementById(SLIP_PIECE_PAGE_ID) as HTMLLinkElement).media).toBe('not all');
  });
});

describe('the customer slip', () => {
  it('the venue, «Booking No. 12», the name, the day and the slot, the numbered lines, the money, the privacy line for the name only', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await pressLab('Anna Finta', 'Print for the customer');
    const slip = host();
    expect(slip.querySelector('.bk-slip-venue')).toHaveTextContent('Panificio Prova');
    expect(slip.querySelector('.bk-slip-number')).toHaveTextContent('Booking No. 12');
    expect(slip.querySelector('.bk-slip-customer')).toHaveTextContent('Anna Finta');
    // The day in the venue's country's way, short.
    expect(slip.querySelector('.bk-slip-when')).toHaveTextContent(`Pickup: ${slipDay(TODAY, 'it-IT')}`);
    expect(slip.querySelector('.bk-slip-time')).toHaveTextContent('from 09:00 to 10:00');
    const lines = [...slip.querySelectorAll('.bk-slip-line')];
    expect(lines[0]).toHaveTextContent(/^1\.3 × Scacciata broccoli 1,5 kg72,00 €senza cipolla, \+ provola$/);
    expect(lines[1]).toHaveTextContent(/^2\.12 × Cannoli siciliani24,00 €$/);
    expect(slip.querySelector('dd.bk-slip-due')).toHaveTextContent('76,00 €');
    expect(slip.querySelector('.bk-slip-privacy')).toHaveTextContent(/^Your name is used only for this order/);
  });

  it('an old booking with no slot shows its exact time; a phone on the booking gets the full privacy line', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const source = fakeBookingsSource([bookingFixture({ id: 'O1', date: TODAY, time: '09:40', customerName: 'Pia Vecchia', phone: '333 000', number: 2,
      lines: [CANNOLI] })], PRICES, DEFAULT_SETTINGS);
    const { user } = renderApp('/bookings/O1', { session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } });
    const card = await screen.findByRole('region', { name: 'Pia Vecchia' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Print for the customer' }));
    expect(host().querySelector('.bk-slip-time')).toHaveTextContent(/^at 09:40$/);
    expect(host().querySelector('.bk-slip-privacy')).toHaveTextContent('name, phone, address');
  });

  it('in Italian: «Prenotazione N. 12», «Ritiro: …», «dalle 09:00 alle 10:00», «Da pagare»', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/S1', {}, 'it');
    const card = await screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Stampa per cliente' }));
    for (const text of ['Prenotazione N. 12', `Ritiro: ${slipDay(TODAY, 'it-IT')}`, 'dalle 09:00 alle 10:00', 'Da pagare', 'Il tuo nome serve solo']) {
      expect(host(), text).toHaveTextContent(text);
    }
  });
});

describe('the lab slips straight to the receipt printer', () => {
  const printer = (answers: readonly string[]) => {
    let call = 0;
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(answers[Math.min(call++, answers.length - 1)]));
    vi.stubGlobal('fetch', fetchSpy);
    return fetchSpy;
  };
  const bodies = (fetchSpy: ReturnType<typeof printer>) => fetchSpy.mock.calls.map(call => String(call[1]?.body));

  it('⚠️ «One per piece»: each slip its own non-fiscal document, so each comes out separately', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = printer([OK]);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await pressLab();
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Slips for the lab' })).getByRole('button', { name: 'Print' }));
    await waitFor(() => { expect(screen.getByText('Printed ✓')).toBeInTheDocument(); });
    expect(print).not.toHaveBeenCalled();
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    for (const body of bodies(fetchSpy)) {
      expect(body.match(/<beginNonFiscal /g)).toHaveLength(1);
      expect(body).toContain('font="4" data="Anna Finta [4]"');
    }
    expect(bodies(fetchSpy)[0]).toContain('font="4" data="senza cipolla"');
    expect(bodies(fetchSpy)[3]).toContain('font="2" data="12 × Cannoli siciliani"');
  });

  it('⚠️ a slip that does not print stops the rest, says how many did, and the browser prints only the ones left', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = printer([OK, '<response success="false" code="EPTR_REC_EMPTY" status="0" />']);
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = await pressLab();
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Slips for the lab' })).getByRole('button', { name: 'Print' }));
    const failed = await screen.findByRole('alertdialog', { name: 'Not printed' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(failed).toHaveTextContent('1 of 4 slips printed.');
    expect(failed).toHaveTextContent('EPTR_REC_EMPTY');
    await user.click(within(failed).getByRole('button', { name: 'Print through the browser' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(slips()).toHaveLength(3);
  });

  it('the customer slip is ONE document with the name double size and «To pay» double size', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = printer([OK]);
    await pressLab('Anna Finta', 'Print for the customer');
    await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(1); });
    const [body] = bodies(fetchSpy);
    expect(body).toContain('font="2" data="Booking No. 12"');
    expect(body).toContain('font="4" data="Anna Finta"');
    expect(body).toMatch(/font="4" data="To pay +76,00 €"/);
    expect(body).toMatch(/data="1\. 3 × Scacciata broccoli 1,5 kg +72,00 €"/);
  });
});

// ── The review fixes of 19 Nov 2026 ──

const GENERAL = 'Suonare due volte, ben cotta';
function showWith(bookings: ReturnType<typeof bookingFixture>[], settings: Partial<BookingSettings> = {}) {
  const source = fakeBookingsSource(bookings, PRICES, { ...DEFAULT_SETTINGS, askPhone: false, ...settings });
  return { source, ...renderApp(`/bookings/${bookings[0]?.id ?? ''}`, { lang: 'en', session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } }) };
}
const withNote = (over: Partial<Booking> = {}) => bookingFixture({
  id: 'N1', date: TODAY, time: '09:00', slotEnd: '10:00', customerName: 'Anna Finta', phone: '', number: 12,
  lines: [SCACCIATA, CANNOLI], notes: GENERAL, ...over,
});
const cardOf = () => screen.findByRole('region', { name: 'Anna Finta' }, LOAD);
const labQuestion = () => screen.findByRole('alertdialog', { name: 'Slips for the lab' });

describe('the booking\'s general note on the slips', () => {
  const generalOf = (slip: Element) => [...slip.querySelectorAll('.bk-slip-general .bk-slip-hl')].map(mark => mark.textContent);

  it('⚠️ is highlighted at the foot of EVERY lab slip through the browser, «One per piece» and «All together»', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = showWith([withNote()]);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    expect(slips()).toHaveLength(4);
    for (const slip of slips()) {
      expect(generalOf(slip)).toEqual(['Suonare due volte', 'ben cotta']);
      // Under the products: the last thing on the slip.
      expect(slip.lastElementChild).toHaveClass('bk-slip-general');
    }
    closeSlipHost();
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    const question = await labQuestion();
    await user.click(within(question).getByRole('radio', { name: 'All together' }));
    await user.click(within(question).getByRole('button', { name: 'Print' }));
    expect(slips()).toHaveLength(1);
    expect(generalOf(slips()[0] as Element)).toEqual(['Suonare due volte', 'ben cotta']);
  });

  it('a blank note prints nothing', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = showWith([withNote({ notes: '   ' })], { perPieceSlips: false });
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    expect(slips()).toHaveLength(1);
    expect(host().querySelector('.bk-slip-general')).toBeNull();
  });

  it('⚠️ is double size at the foot of EVERY lab slip on the receipt printer, in both modes', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(OK));
    vi.stubGlobal('fetch', fetchSpy);
    const { user } = showWith([withNote()]);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(4); });
    for (const call of fetchSpy.mock.calls) {
      const body = String(call[1]?.body);
      expect(body).toContain('font="4" data="Suonare due volte"');
      expect(body).toContain('font="4" data="ben cotta"');
    }
    await waitFor(() => { expect(screen.getByText('Printed ✓')).toBeInTheDocument(); });
    fetchSpy.mockClear();
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    const question = await labQuestion();
    await user.click(within(question).getByRole('radio', { name: 'All together' }));
    await user.click(within(question).getByRole('button', { name: 'Print' }));
    await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(1); });
    expect(String(fetchSpy.mock.calls[0]?.[1]?.body)).toContain('font="4" data="ben cotta"');
  });

  it('is on the customer slip as plain text after the lines and before the money, through the browser and the printer', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = showWith([withNote({ total: 96, deposit: 20 })]);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the customer' }));
    const note = host().querySelector('.bk-slip-notes') as HTMLElement;
    expect(note).toHaveTextContent('Suonare due volte, ben cotta');
    expect(note.previousElementSibling).toHaveClass('bk-slip-lines');
    expect(note.nextElementSibling).toHaveClass('bk-slip-rule');
    expect(note.querySelector('.bk-slip-hl')).toBeNull();
    closeSlipHost();
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(OK));
    vi.stubGlobal('fetch', fetchSpy);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the customer' }));
    await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(1); });
    const body = String(fetchSpy.mock.calls[0]?.[1]?.body);
    expect(body).toContain('data="Suonare due volte, ben cotta"');
    expect(body.indexOf('Suonare due volte')).toBeLessThan(body.indexOf('Total'));
  });
});

describe('runaway per-piece printing', () => {
  const many = (qty: number) => withNote({ notes: '', lines: [{ ...SCACCIATA, qty, unitPrice: null }] });

  it('⚠️ above 30 slips it asks first with the app\'s own dialog; Cancel prints nothing, Print prints all', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = showWith([many(31)]);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Print 31 slips?' });
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(print).not.toHaveBeenCalled();
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Print 31 slips?' })).getByRole('button', { name: 'Print' }));
    expect(slips()).toHaveLength(31);
  });

  it('exactly 30 slips ask nothing', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = showWith([many(30)]);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(slips()).toHaveLength(30);
  });

  it('in Italian the question is «Stampare 31 biglietti?» with Annulla / Stampa', async () => {
    vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const source = fakeBookingsSource([many(31)], PRICES, { ...DEFAULT_SETTINGS, askPhone: false });
    const { user } = renderApp('/bookings/N1', { lang: 'it', session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } });
    await user.click(within(await cardOf()).getByRole('button', { name: 'Stampa per laboratorio' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Biglietti per il laboratorio' })).getByRole('button', { name: 'Stampa' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Stampare 31 biglietti?' });
    expect(within(ask).getByRole('button', { name: 'Annulla' })).toBeInTheDocument();
    expect(within(ask).getByRole('button', { name: 'Stampa' })).toBeInTheDocument();
  });

  it('⚠️ above 300 nothing prints, on either path: a message on the status line says how many', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => new Response(OK));
    vi.stubGlobal('fetch', fetchSpy);
    const { user } = showWith([many(301)]);
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    expect(await screen.findByText('Too many slips (301): check the booking’s quantities.')).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    await user.click(within(await cardOf()).getByRole('button', { name: 'Print for the lab' }));
    await user.click(within(await labQuestion()).getByRole('button', { name: 'Print' }));
    expect(await screen.findByText('Too many slips (301): check the booking’s quantities.')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(document.getElementById(SLIP_HOST_ID)).toBeNull();
  });
});

describe('the print buttons\' visibility and waiting', () => {
  it('a cancelled booking shows no print buttons at all', async () => {
    const { user } = showWith([withNote({ status: 'cancelled' })]);
    const card = await cardOf();
    expect(within(card).queryByRole('button', { name: 'Print for the lab' })).toBeNull();
    expect(within(card).queryByRole('button', { name: 'Print for the customer' })).toBeNull();
    // Putting it back to open brings them back.
    await user.click(within(card).getByRole('button', { name: 'Reopen booking' }));
    expect(await within(card).findByRole('button', { name: 'Print for the lab' })).toBeInTheDocument();
  });

  it('⚠️ «Lab» waits for the venue settings too: the default «one per piece» never asks a venue that has it off', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const off = { ...DEFAULT_SETTINGS, askPhone: false, perPieceSlips: false };
    const source = fakeBookingsSource([withNote()], PRICES, off);
    let answer: () => void = () => undefined;
    vi.mocked(source.watchSettings).mockImplementationOnce((onChange: Parameters<typeof source.watchSettings>[0]) => {
      answer = () => { onChange(off, { fromServer: true }); };
      return () => undefined;
    });
    const { user } = renderApp('/bookings/N1', { session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } });
    const card = await cardOf();
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(print).not.toHaveBeenCalled();
    act(() => { answer(); });
    await user.click(within(card).getByRole('button', { name: 'Print for the lab' }));
    // The switch is off: no question, one slip.
    await waitFor(() => { expect(print).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(slips()).toHaveLength(1);
  });
});
