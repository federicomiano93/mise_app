import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { addDays, parseISODate, spellLongDate, spellShortDate, todayISO, toISODate, weekdayOf } from '@mise/shared/day';
import { nextOrderOffer } from '@mise/shared/order-day';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, split, supplier } from '../testing/renderOrders';

// «Orders», step 3f-6: today's orders over the list, the bell and its panel — the orders typed on an earlier day and never placed,
// what was added that nobody was told about, the calendar notices — and the notifications in the Orders settings.

// The two browser halves are replaced: what is asked of the browser's notifications is what these specs read and drive.
const browser = vi.hoisted(() => ({
  notifyOnce: vi.fn(),
  permission: vi.fn((): string => 'default'),
  ask: vi.fn(async (): Promise<string> => 'granted'),
}));
vi.mock('./calendarNotices', async importOriginal => {
  const real = await importOriginal<typeof import('./calendarNotices')>();
  return { ...real, notifyOnce: browser.notifyOnce, noticePermission: () => browser.permission(), askNoticePermission: () => browser.ask() };
});

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  browser.notifyOnce.mockReset();
  browser.permission.mockReset().mockReturnValue('default');
  browser.ask.mockReset().mockResolvedValue('granted');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); });

const TODAY = todayISO();
const inDays = (n: number): string => toISODate(addDays(parseISODate(TODAY), n));
const WEEKDAY = (n: number): string => weekdayOf(inDays(n)) as string;
const YESTERDAY = inDays(-1);
const sayEn = (key: string, params?: Record<string, string | number>) => format('en', en[key as keyof typeof en], params);
const sayIt = (key: string, params?: Record<string, string | number>) => format('it', italian[key as keyof typeof italian], params);
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  // Ordered on a weekday that is not today: «For the next order» is offered, and a holiday tomorrow clashes when it delivers then.
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', orderDays: [WEEKDAY(1)], deliveryDays: [WEEKDAY(1)] }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Milk', supplierId: 's-zed', unit: 'l' }),
];

function record(date: string, supplierId: string, quantities: Record<string, number>) {
  return { date, supplierId, supplierName: supplierId, quantities, stock: {}, names: {}, createdAt: `${date}T09:12:00.000Z`, updatedAt: `${date}T09:12:00.000Z` };
}

function seeded(extra: { draft?: Record<string, unknown> | null; records?: Record<string, Record<string, unknown>>; suppliers?: typeof SUPPLIERS } = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ...extra });
}

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;

async function atList(source: FakeOrdersSource, options: Options = {}) {
  const view = renderOrders('/orders', { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

const bell = () => screen.getByRole('button', { name: /^(Notices|Avvisi)/ });
const panel = (name = 'Notices') => within(screen.getByRole('region', { name }));
async function openPanel(view: Awaited<ReturnType<typeof atList>>, name = 'Notices') {
  await view.user.click(bell());
  return panel(name);
}

// An order typed yesterday and never placed, for Alpine; Zed's was typed today.
const PENDING_DRAFT = {
  entries: { 'i-flour': { qty: 2 }, 'i-milk': { qty: 4 } },
  days: { 's-alp': YESTERDAY, 's-zed': TODAY },
};

describe('«Order today» over the list', () => {
  it('draws nothing while no supplier is ordered today', async () => {
    await atList(seeded());
    expect(screen.queryByText('Order today')).not.toBeInTheDocument();
    expect(screen.queryByText('Today’s orders are all placed')).not.toBeInTheDocument();
  });

  it('shows a button for each order still to place and a quiet check for each one placed', async () => {
    const suppliers = [
      supplier('s-alp', { name: 'Alpine Mills', orderDays: [WEEKDAY(0)] }),
      supplier('s-bee', { name: 'Bee Farm', orderDays: [WEEKDAY(0)] }),
      supplier('s-cat', { name: 'Not today', orderDays: [WEEKDAY(2)] }),
    ];
    await atList(seeded({ suppliers, records: { [`${TODAY}_s-bee`]: record(TODAY, 's-bee', { 'i-flour': 1 }) } }));
    expect(await screen.findByText('Order today', undefined, LOAD)).toBeInTheDocument();
    // Two buttons carry the name: the chip (first, over the list) and the supplier's row.
    expect(screen.getAllByRole('button', { name: 'Alpine Mills' })).toHaveLength(2);
    // Placed: its name and a word for a screen reader, but nothing to press.
    expect(screen.getAllByText('Bee Farm')).toHaveLength(2);
    // Its row is the only button with its name.
    expect(screen.getAllByRole('button', { name: 'Bee Farm' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Not today' })).toHaveLength(1);
  });

  it('says so in one line when every order of the day is placed', async () => {
    const suppliers = [supplier('s-alp', { name: 'Alpine Mills', orderDays: [WEEKDAY(0)] })];
    await atList(seeded({ suppliers, records: { [`${TODAY}_s-alp`]: record(TODAY, 's-alp', { 'i-flour': 1 }) } }));
    expect(await screen.findByText('Today’s orders are all placed', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Order today')).not.toBeInTheDocument();
  });

  it('opens the supplier when a chip is pressed, like its row', async () => {
    const suppliers = [supplier('s-alp', { name: 'Alpine Mills', orderDays: [WEEKDAY(0)] })];
    const view = await atList(seeded({ suppliers }));
    await screen.findByText('Order today', undefined, LOAD);
    await view.user.click(screen.getAllByRole('button', { name: 'Alpine Mills' })[0] as HTMLElement);
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp'); });
  });

  it('⚠️ draws nothing before the records have arrived: a supplier placed this morning must not flash as not placed', async () => {
    const suppliers = [supplier('s-alp', { name: 'Alpine Mills', orderDays: [WEEKDAY(0)] })];
    const source = seeded({ suppliers });
    source.watchRecentHistory = () => () => undefined;
    await atList(source);
    expect(screen.queryByText('Order today')).not.toBeInTheDocument();
    // Only the supplier's own row.
    expect(screen.getAllByRole('button', { name: 'Alpine Mills' })).toHaveLength(1);
  });
});

describe('the bell and its panel', () => {
  it('is always there, closed on every opening, with no number and an empty line when there is nothing', async () => {
    const view = await atList(seeded());
    expect(bell()).toHaveAccessibleName('Notices');
    expect(bell()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
    const inside = await openPanel(view);
    expect(bell()).toHaveAttribute('aria-expanded', 'true');
    expect(bell()).toHaveAttribute('aria-controls', screen.getByRole('region', { name: 'Notices' }).id);
    expect(inside.getByText('No notices right now.')).toBeInTheDocument();
    await view.user.click(bell());
    expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
    // ⚠️ It names the panel only while there is one.
    expect(bell()).not.toHaveAttribute('aria-controls');
  });

  it('counts what it holds in its name and on a badge, and the pill and the empty line are not counted', async () => {
    await atList(seeded({ draft: PENDING_DRAFT }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    expect(bell()).toHaveTextContent('1');
  });

  it('Escape inside the panel closes it and gives the focus back to the bell', async () => {
    const view = await atList(seeded({ draft: PENDING_DRAFT }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    act(() => { inside.getByRole('button', { name: 'It’s today’s' }).focus(); });
    await view.user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Notices' })).not.toBeInTheDocument();
    expect(bell()).toHaveFocus();
  });
});

describe('orders typed on an earlier day and never placed', () => {
  it('shows a banner for yesterday’s order and none for today’s, with the day it is for', async () => {
    const view = await atList(seeded({ draft: PENDING_DRAFT }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    expect(inside.getByText('Alpine Mills — order not placed')).toBeInTheDocument();
    expect(inside.getByText('1 item for yesterday')).toBeInTheDocument();
    expect(inside.queryByText(/Zed.*order not placed/)).not.toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Placed yesterday' })).toBeInTheDocument();
    expect(inside.getByRole('button', { name: 'Discard' })).toBeInTheDocument();
    // Alpine has no order day: there is no «next order» to offer.
    expect(inside.queryByRole('button', { name: /^For the next order/ })).not.toBeInTheDocument();
  });

  it('⚠️ is latched once: a supplier that becomes pending later is not added under somebody’s finger', async () => {
    const source = seeded({ draft: { entries: { 'i-flour': { qty: 2 } }, days: { 's-alp': TODAY } } });
    const view = await atList(source);
    await waitFor(() => { expect(source.draft).not.toBeNull(); });
    act(() => { source.remoteMerge({ days: { 's-alp': YESTERDAY } }); });
    // Let the new snapshot land; the bell stays as it was.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
    expect(bell()).toHaveAccessibleName('Notices');
    const inside = await openPanel(view);
    expect(inside.queryByText('Alpine Mills — order not placed')).not.toBeInTheDocument();
  });

  it('«It’s today’s» restamps the order to today and the banner goes', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    await view.user.click(inside.getByRole('button', { name: 'It’s today’s' }));
    await waitFor(() => { expect(source.writes.at(-1)?.days?.['s-alp']).toBe(TODAY); });
    await waitFor(() => { expect(screen.queryByText('Alpine Mills — order not placed')).not.toBeInTheDocument(); });
    expect(bell()).toHaveAccessibleName('Notices');
    // ⚠️ The button pressed is gone: the focus stays in the panel, never on the page.
    expect(screen.getByRole('region', { name: 'Notices' })).toHaveFocus();
  });

  it('«For the next order» restamps it to the next order day when the supplier has one', async () => {
    const source = seeded({ draft: { entries: { 'i-milk': { qty: 4 } }, days: { 's-zed': YESTERDAY } } });
    const view = await atList(source);
    const next = nextOrderOffer(SUPPLIERS[1], TODAY) as string;
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    await view.user.click(inside.getByRole('button', { name: `For the next order (${spellShortDate(next, sayEn)})` }));
    await waitFor(() => { expect(source.writes.at(-1)?.days?.['s-zed']).toBe(next); });
    await waitFor(() => { expect(screen.queryByText('Zed — order not placed')).not.toBeInTheDocument(); });
  });

  it('⚠️ brings the banner back by itself when the restamp is refused, and says why', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    source.refuseWrites = true;
    await view.user.click(inside.getByRole('button', { name: 'It’s today’s' }));
    expect(await screen.findByText('Could not update the order’s day — check your network and try again.', undefined, LOAD)).toBeInTheDocument();
    expect(await screen.findByText('Alpine Mills — order not placed')).toBeInTheDocument();
  });

  it('«Placed yesterday» opens the confirm screen and records under yesterday without asking whether it was sent', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    await view.user.click(inside.getByRole('button', { name: 'Placed yesterday' }));
    await screen.findByRole('region', { name: 'Order placed' }, LOAD);
    expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp/confirm');
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    expect(await screen.findByText('Alpine Mills — order saved to history ✓', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(source.records.get(`${YESTERDAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2 });
    expect(source.records.has(`${TODAY}_s-alp`)).toBe(false);
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    // Placed: the order is gone from the draft and so is its banner.
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices'); });
    // The banner's button went with it: the supplier's row takes the focus.
    await waitFor(() => { expect(screen.getByRole('button', { name: /^Alpine Mills/ })).toHaveFocus(); });
  });

  it('⚠️ «Placed yesterday» records nothing when the order changed while the screen was open (another phone restamped it)', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click((await openPanel(view)).getByRole('button', { name: 'Placed yesterday' }));
    await screen.findByRole('region', { name: 'Order placed' }, LOAD);
    act(() => { source.remoteMerge({ days: { 's-alp': TODAY } }); });
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    expect(await screen.findByText('This order changed meanwhile, so nothing was recorded. Check it on the list.', undefined, LOAD)).toBeInTheDocument();
    expect(source.records.size).toBe(0);
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
  });

  it('⚠️ on the split, «Placed yesterday» beside an open supplier walks back to the list after recording, never pushing a second one', async () => {
    split();
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click(screen.getByRole('button', { name: /^Alpine Mills/ }));
    await screen.findByRole('heading', { level: 2, name: 'Alpine Mills' }, LOAD);
    await view.user.click((await openPanel(view)).getByRole('button', { name: 'Placed yesterday' }));
    await screen.findByRole('region', { name: 'Order placed' }, LOAD);
    expect(view.router.state.historyAction).toBe('REPLACE');
    await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); }, LOAD);
    expect(view.router.state.historyAction).toBe('POP');
  });

  it('⚠️ the banner survives a visit to the confirm screen and back (the latch sits above the routes)', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await view.user.click(await (async () => (await openPanel(view)).getByRole('button', { name: 'Placed yesterday' }))());
    await screen.findByRole('region', { name: 'Order placed' }, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders'); });
    expect(bell()).toHaveAccessibleName('Notices: 1');
    // Back hands the focus to the button that opened the screen.
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Placed yesterday' })).toHaveFocus(); });
  });

  it.each([['a day that has not come', inDays(2)], ['something that is not a day', 'yesterday'], ['a day the order no longer carries', YESTERDAY]])(
    'ignores %s in the navigation state: the usual question is asked',
    async (_what, pendingDay) => {
      const source = seeded({ draft: { entries: { 'i-flour': { qty: 2 } }, days: { 's-alp': TODAY } } });
      const path = '/orders/supplier/s-alp/confirm';
      const view = renderOrders(path, { source, entries: [{ pathname: path, state: { pendingDay } }] });
      await screen.findByRole('region', { name: 'Order placed' }, LOAD);
      await view.user.click(screen.getByRole('button', { name: 'Order placed' }));
      expect(await screen.findByText('Did you send the order to Alpine Mills?', undefined, LOAD)).toBeInTheDocument();
    },
  );

  it('«Discard» asks first, and only a yes clears the quantities and says so', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    await view.user.click(inside.getByRole('button', { name: 'Discard' }));
    const asked = within(await screen.findByRole('alertdialog'));
    expect(asked.getByText('Discard Alpine Mills’s order')).toBeInTheDocument();
    expect(asked.getByText('Delete the quantities typed for Alpine Mills? They are not saved anywhere and cannot be recovered.')).toBeInTheDocument();
    await view.user.click(asked.getByRole('button', { name: 'Cancel' }));
    expect(source.clears).toHaveLength(0);
    expect(screen.getByText('Alpine Mills — order not placed')).toBeInTheDocument();

    await view.user.click(panel().getByRole('button', { name: 'Discard' }));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Alpine Mills — order discarded', undefined, LOAD)).toBeInTheDocument();
    expect(source.clears).toHaveLength(1);
    await waitFor(() => { expect(screen.queryByText('Alpine Mills — order not placed')).not.toBeInTheDocument(); });
  });

  it('«Discard» says so when the clear fails', async () => {
    const source = seeded({ draft: PENDING_DRAFT });
    const view = await atList(source);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    source.fail.clear = true;
    await view.user.click(inside.getByRole('button', { name: 'Discard' }));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Discard' }));
    expect(await screen.findByText('Could not discard the order — check your network and try again.', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('what was added that nobody was told about', () => {
  // Flour was recorded today; rye was not, and 3 are typed: an addition. Flour went from 2 to 5 after it was recorded: already ordered.
  const history = { [`${TODAY}_s-alp`]: record(TODAY, 's-alp', { 'i-flour': 2 }) };
  const added = { entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 3 } }, days: { 's-alp': TODAY } };
  const after = { entries: { 'i-flour': { qty: 5 } }, days: { 's-alp': TODAY } };

  it('is a button that opens the supplier for a manager', async () => {
    const view = await atList(seeded({ draft: added, records: history }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    await view.user.click(inside.getByRole('button', { name: 'Alpine Mills: the order changed since it was last sent — 1 addition' }));
    await waitFor(() => { expect(view.router.state.location.pathname).toBe('/orders/supplier/s-alp'); });
  });

  it('is plain text for anyone else', async () => {
    const view = await atList(seeded({ draft: added, records: history }), STAFF);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    expect(inside.getByText('Alpine Mills: the order changed since it was last sent — 1 addition')).toBeInTheDocument();
    expect(inside.queryByRole('button', { name: /order changed/ })).not.toBeInTheDocument();
  });

  it('puts what was already ordered in a block of its own, with no button to undo it', async () => {
    const view = await atList(seeded({ draft: after, records: history }));
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    expect(inside.getByText('This was already ordered')).toBeInTheDocument();
    expect(inside.getByText('Flour — 2 ordered, 5 now in the order')).toBeInTheDocument();
    expect(inside.getByText('If more is really needed, ring the supplier — the app cannot undo a phone call.')).toBeInTheDocument();
    expect(inside.queryByRole('button')).not.toBeInTheDocument();
    expect(inside.queryByText(/order changed/)).not.toBeInTheDocument();
  });
});

describe('the calendar notices', () => {
  // The venue is British: its holidays are the list kept on this phone, so the days are the ones planted here. The download is marked
  // as done today, so nothing is asked of gov.uk.
  function holidays(...days: string[]) {
    window.localStorage.setItem('uk-bank-holidays', JSON.stringify(days));
    window.localStorage.setItem('uk-bank-holidays-fetched', TODAY);
  }
  const GB = { session: { location: { country: 'GB' } } } as Options;
  const GB_IT = { ...GB, lang: 'it' } as Options;
  const tomorrow = inDays(1);
  const holidayText = (date: string) => sayEn('ord.notice.holidayTomorrow', { date: spellLongDate(date, sayEn) });

  it('says it all in the reader’s language: no English weekday and no raw date', async () => {
    holidays(tomorrow);
    const view = await atList(seeded(), GB_IT);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Avvisi: 2'); }, LOAD);
    const inside = await openPanel(view, 'Avvisi');
    const holiday = sayIt('ord.notice.holidayTomorrow', { date: spellLongDate(tomorrow, sayIt) });
    expect(inside.getByText(holiday)).toBeInTheDocument();
    const weekday = sayIt(`day.weekdayLong.${parseISODate(tomorrow).getDay()}`);
    const clash = sayIt('ord.notice.deliveryClash', { supplier: 'Zed', day: weekday, date: spellLongDate(tomorrow, sayIt) });
    expect(inside.getByText(clash)).toBeInTheDocument();
    expect(clash).toMatch(/^Attenzione: Zed consegna /);
    for (const text of [holiday, clash]) expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}|tomorrow|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday/i);
  });

  it('says «in N days» with the count when the holiday is not tomorrow', async () => {
    const later = inDays(3);
    holidays(later);
    const view = await atList(seeded({ suppliers: [SUPPLIERS[0] as (typeof SUPPLIERS)[number]] }), GB);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    const inside = await openPanel(view);
    expect(inside.getByText(sayEn('ord.notice.holidayInDays', { n: 3, date: spellLongDate(later, sayEn) }))).toBeInTheDocument();
    expect(sayEn('ord.notice.holidayInDays', { n: 3, date: 'x' })).toMatch(/^Public holiday in 3 days/);
  });

  it('closes one with its own button, leaves a pill when none is open, and brings them all back', async () => {
    holidays(tomorrow);
    const view = await atList(seeded(), GB);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 2'); }, LOAD);
    const inside = await openPanel(view);
    // The close button is a sibling of the words, never inside them.
    const text = inside.getByText(holidayText(tomorrow));
    expect(text.querySelector('button')).toBeNull();
    const closers = inside.getAllByRole('button', { name: 'I have read this' });
    expect(closers).toHaveLength(2);
    await view.user.click(closers[0] as HTMLElement);
    expect(bell()).toHaveAccessibleName('Notices: 1');
    expect(inside.queryByRole('button', { name: 'Show the notices again' })).not.toBeInTheDocument();
    await view.user.click(inside.getByRole('button', { name: 'I have read this' }));
    // Nothing open, two put away: the pill alone, with their number, and no «no notices» line.
    expect(bell()).toHaveAccessibleName('Notices');
    const pill = inside.getByRole('button', { name: 'Show the notices again' });
    expect(pill).toHaveTextContent('2');
    expect(inside.queryByText('No notices right now.')).not.toBeInTheDocument();
    await view.user.click(pill);
    expect(bell()).toHaveAccessibleName('Notices: 2');
    expect(inside.queryByRole('button', { name: 'Show the notices again' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notices' })).toHaveFocus();
  });

  it('⚠️ raises a browser notification only for the notices still open, even with the panel closed', async () => {
    holidays(tomorrow);
    window.localStorage.setItem('orders-alerts-dismissed', JSON.stringify([`bh-${tomorrow}`]));
    const view = await atList(seeded(), GB);
    await waitFor(() => { expect(bell()).toHaveAccessibleName('Notices: 1'); }, LOAD);
    await waitFor(() => { expect(browser.notifyOnce).toHaveBeenCalled(); });
    const keys = (call: unknown[]) => (call[0] as Array<{ key: string }>).map(notice => notice.key);
    // The panel was never opened, and the one put away on this phone is not raised.
    expect(browser.notifyOnce.mock.calls.flatMap(keys)).toEqual([`conf-s-zed-${tomorrow}`]);
    const body = (browser.notifyOnce.mock.calls[0]?.[0] as Array<{ title: string; body: string }>)[0];
    expect(body?.title).toBe('Mise');
    expect(body?.body).toMatch(/^Heads up: Zed delivers on /);

    // Bringing the held one back raises it too; putting one away afterwards raises nothing for it.
    const inside = await openPanel(view);
    await view.user.click(await (async () => inside.getByRole('button', { name: 'I have read this' }))());
    await view.user.click(inside.getByRole('button', { name: 'Show the notices again' }));
    await waitFor(() => { expect(browser.notifyOnce.mock.calls.flatMap(keys)).toContain(`bh-${tomorrow}`); });
  });

  it('draws nothing for a venue with no calendar of its own', async () => {
    holidays(tomorrow);
    await atList(seeded(), { session: { location: {} } } as Options);
    expect(bell()).toHaveAccessibleName('Notices');
    expect(browser.notifyOnce).not.toHaveBeenCalled();
  });
});

describe('the notifications in the Orders settings', () => {
  async function atSettings(permission: string) {
    browser.permission.mockReturnValue(permission);
    const view = renderOrders('/orders/settings', { source: seeded() });
    await screen.findByRole('heading', { name: 'Notices (this phone)' }, LOAD);
    return view;
  }

  it('says the device does not support them', async () => {
    await atSettings('unsupported');
    expect(screen.getByText('This device does not support notifications.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).not.toBeInTheDocument();
  });

  it('says they are on', async () => {
    await atSettings('granted');
    expect(screen.getByText('Notifications are on for this device.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).not.toBeInTheDocument();
  });

  it('says they are blocked, and where to turn them on', async () => {
    await atSettings('denied');
    expect(screen.getByText('Notifications are blocked. Turn them on for this app in your browser/site settings, then reload.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).not.toBeInTheDocument();
  });

  it('explains them, and a button asks the browser and redraws with its answer', async () => {
    const view = await atSettings('default');
    expect(screen.getByText(/^Get an alert when an order is due/)).toBeInTheDocument();
    browser.ask.mockImplementation(async () => {
      browser.permission.mockReturnValue('granted');
      return 'granted';
    });
    await view.user.click(screen.getByRole('button', { name: 'Enable notifications' }));
    expect(await screen.findByText('Notifications are on for this device.')).toBeInTheDocument();
    expect(browser.ask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Enable notifications' })).not.toBeInTheDocument();
  });
});
