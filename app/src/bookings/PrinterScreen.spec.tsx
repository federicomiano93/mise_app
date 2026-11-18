import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { isBusy } from '../session/busy';
import { bookingFixture, fakeBookingsSource } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import { PRINTER_HOST_KEY, PRINTER_PLAIN_KEY } from './printerHost';
import { SLIP_HOST_ID, closeSlipHost } from './slipHost';

// Bookings step 3: «Receipt printer» — the address of the Epson on the shop's network, kept on THIS device, a test page (step 0
// of the plan), and the slips sent straight to it from a booking. ⚠️ Fake customers; the printer is a fake fetch.

vi.mock('./reloadPage', () => ({ reloadPage: vi.fn() }));
const { reloadPage } = await import('./reloadPage');

const LOAD = { timeout: 5000 };
const TODAY = todayISO();
const OK = '<response success="true" code="" status="2"></response>';

function show(path: string) {
  const source = fakeBookingsSource([
    bookingFixture({ id: 'A2', date: TODAY, time: '09:00', customerName: 'Anna Finta', mode: 'delivery', address: 'Via Finta 1, Roma', number: 4,
      lines: [{ recipeId: null, productId: 'pF', unitPrice: 12, packSize: null, packUnit: null, name: 'Focaccia', qty: 1.5, unit: 'kg', note: '' }],
      total: 18, deposit: null, notes: '' }),
  ]);
  return renderApp(path, { session: { location: { country: 'IT' }, name: 'Panificio Prova' }, data: { bookings: () => source } });
}

const printer = (body: string | Error = OK) => {
  const fetchSpy = vi.fn(async (_url: string, _init?: RequestInit) => {
    if (body instanceof Error) throw body;
    return new Response(body);
  });
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
};
const sent = (fetchSpy: ReturnType<typeof printer>) => String(fetchSpy.mock.calls[0]?.[1]?.body);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  localStorage.removeItem(PRINTER_HOST_KEY);
  localStorage.removeItem(PRINTER_PLAIN_KEY);
  closeSlipHost();
  vi.mocked(reloadPage).mockClear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the receipt printer screen', () => {
  it('is reached from the foot of the list', async () => {
    const { user } = show('/bookings');
    await user.click(await screen.findByRole('button', { name: 'Receipt printer' }, LOAD));
    expect(await screen.findByRole('region', { name: 'Receipt printer' })).toBeInTheDocument();
  });

  it('⚠️ an address outside the shop\'s network is refused on Save, marked and said; nothing saved, no reload', async () => {
    const { user } = show('/bookings/printer');
    const box = await screen.findByLabelText('Printer address', undefined, LOAD);
    await user.type(box, '8.8.8.8');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(box).toHaveFocus();
    expect(box).toHaveAccessibleDescription(/Not an address of the shop’s network/);
    expect(localStorage.getItem(PRINTER_HOST_KEY)).toBeNull();
    expect(reloadPage).not.toHaveBeenCalled();
  });

  it('saves on this device after a question, then the app loads again (its security policy names the printer)', async () => {
    const { user } = show('/bookings/printer');
    await user.type(await screen.findByLabelText('Printer address', undefined, LOAD), '192.168.1.50');
    await user.click(screen.getByRole('checkbox', { name: /Plain letters only/ }));
    expect(isBusy()).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const question = await screen.findByRole('alertdialog', { name: 'Save the printer?' });
    expect(question).toHaveTextContent('192.168.1.50');
    await user.click(within(question).getByRole('button', { name: 'Save' }));
    expect(localStorage.getItem(PRINTER_HOST_KEY)).toBe('192.168.1.50');
    expect(localStorage.getItem(PRINTER_PLAIN_KEY)).toBe('1');
    expect(reloadPage).toHaveBeenCalledTimes(1);
  });

  it('leaving with an address typed and not saved asks; Cancel stays', async () => {
    const { user } = show('/bookings/printer');
    await user.type(await screen.findByLabelText('Printer address', undefined, LOAD), '192.168.1.50');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    const question = await screen.findByRole('alertdialog');
    expect(question).toHaveTextContent('The printer setting you changed is not saved');
    await user.click(within(question).getByRole('button', { name: 'Cancel' }));
    expect(screen.getByLabelText('Printer address')).toHaveValue('192.168.1.50');
  });

  it('with a printer saved: the link to accept its certificate, and the test page (step 0) sent and answered', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = printer();
    const { user } = show('/bookings/printer');
    const link = await screen.findByRole('link', { name: 'Open the printer (192.168.1.50)' }, LOAD);
    expect(link).toHaveAttribute('href', 'https://192.168.1.50/');
    await user.click(screen.getByRole('button', { name: 'Print a test page' }));
    expect(await screen.findByText(/^Printed ✓ Check on the paper/)).toBeInTheDocument();
    expect(fetchSpy.mock.calls[0]?.[0]).toMatch(/^https:\/\/192\.168\.1\.50\/cgi-bin\/fpmate\.cgi/);
    expect(sent(fetchSpy)).toContain('<printerNonFiscal>');
    expect(sent(fetchSpy)).toContain('MISE — printer test');
  });

  it('a test page that does not reach the printer says why', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    printer(new TypeError('Failed to fetch'));
    const { user } = show('/bookings/printer');
    await user.click(await screen.findByRole('button', { name: 'Print a test page' }, LOAD));
    expect(await screen.findByText(/The printer could not be reached/)).toBeInTheDocument();
  });

  it('in Italian', async () => {
    renderApp('/bookings/printer', { lang: 'it', data: { bookings: () => fakeBookingsSource([]) } });
    expect(await screen.findByRole('region', { name: 'Stampante scontrini' }, LOAD)).toBeInTheDocument();
    expect(screen.getByLabelText('Indirizzo della stampante')).toBeInTheDocument();
  });
});

describe('a slip straight to the receipt printer', () => {
  it('⚠️ with a printer set, the lab slip goes to it — no browser dialog, and no name, phone or address on it', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = printer();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Booking No. 4' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Lab slip' }));
    await waitFor(() => { expect(screen.getByText('Printed ✓')).toBeInTheDocument(); });
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById(SLIP_HOST_ID)).toBeNull();
    const xml = sent(fetchSpy);
    expect(xml).toContain('1,5 kg Focaccia');
    for (const secret of ['Anna', '333', 'Via Finta']) expect(xml).not.toContain(secret);
  });

  it('the customer slip goes with its prices', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    const fetchSpy = printer();
    const { user } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Booking No. 4' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Customer slip' }));
    await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(1); });
    expect(sent(fetchSpy)).toContain('Anna Finta');
    expect(sent(fetchSpy)).toMatch(/1,5 kg Focaccia +18,00 €/);
  });

  it('⚠️ when it does not print: the reason, and the browser\'s dialog offered instead', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    printer('<response success="false" code="EPTR_REC_EMPTY" status="0" />');
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Booking No. 4' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Lab slip' }));
    const question = await screen.findByRole('alertdialog', { name: 'Not printed' });
    expect(question).toHaveTextContent('EPTR_REC_EMPTY');
    await user.click(within(question).getByRole('button', { name: 'Print through the browser' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.getElementById(SLIP_HOST_ID)).toHaveTextContent('Focaccia');
  });

  it('⚠️ a failure that comes after the person opened another booking is SAID, with the slip and the booking', async () => {
    localStorage.setItem(PRINTER_HOST_KEY, '192.168.1.50');
    let answer: (response: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
    const { user, router } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Booking No. 4' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Lab slip' }));
    expect(within(card).getByRole('button', { name: 'Customer slip' })).toBeDisabled();
    await act(async () => { await router.navigate('/bookings'); });
    await act(async () => { answer(new Response('<response success="false" code="EPTR_REC_EMPTY" status="0" />')); });
    expect(await screen.findByText(/Lab slip, booking No\. 4: not printed\. .*EPTR_REC_EMPTY/)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('no printer set: the browser\'s dialog, as before, and nothing sent on the network', async () => {
    const fetchSpy = printer();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { user } = show('/bookings/A2');
    const card = await screen.findByRole('region', { name: 'Booking No. 4' }, LOAD);
    await user.click(within(card).getByRole('button', { name: 'Lab slip' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
