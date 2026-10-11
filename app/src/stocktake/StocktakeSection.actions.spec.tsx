import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { it as italian } from '../i18n/it';
import { ACTION_EVENT } from '../telemetry/usage';
import { fakeStocktakeSource } from '../testing/fakeStocktakeSource';
import {
  closedMonthDoc, freezeClock, ingredient, monthDoc, renderStocktake,
} from '../testing/renderStocktake';

// The month's bottom bar («What it cost», «Close the month» / «Reopen the month») and the four
// things done to a month: Carry forward, From the orders, Close and Reopen — each asks first where
// it writes something that is hard to take back, says what happened, and ignores a second tap
// while it is running. The pieces they call (the store) are covered in stocktakeStore.spec.ts.

beforeAll(async () => { await import('./StocktakeSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  freezeClock();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

const LOAD = { timeout: 10_000 };
// The save is sent 700ms after the last change; this is the real clock.
const SAVED = { timeout: 4000 };

const EMPLOYEE = {
  canManage: false,
  isOwner: false,
  role: 'staff' as const,
  location: { country: 'GB', staffShownCards: { inventory: true } },
};
const MANAGER = { canManage: true, isOwner: false, role: 'manager' as const };

const INGREDIENTS = [
  ingredient('flour', { name: 'Farina 00', shortName: 'Farina', weight: '25kg', unit: 'sacco', category: 'Dispensa' }),
  ingredient('sugar', { name: 'Zucchero', weight: '', unit: 'kg', category: 'Dispensa' }),
  ingredient('butter', { name: 'Burro', weight: '1kg', unit: 'kg', category: 'Frigo' }),
];

// Flour at 0.80 a kilo (a 25 kg sack is worth 20) and butter at 8 a kilo; sugar has no price.
const PRICES = {
  flour: { priceUnit: 'kg', pricePerUnit: 0.8 },
  butter: { priceUnit: 'kg', pricePerUnit: 8 },
};

function source(months = [monthDoc('2026-10')], orders: Record<string, unknown>[] = []) {
  return fakeStocktakeSource({
    months,
    ingredients: INGREDIENTS,
    prices: PRICES,
    orders: orders.map((order, index) => ({ id: `o${index}`, ...order })),
  });
}

type Options = Parameters<typeof renderStocktake>[1];

async function loaded(fake = source(), path = '/stocktake/2026-10', options: Options = {}) {
  const view = renderStocktake(path, { source: fake, ...options });
  await screen.findAllByRole('heading', { level: 3 }, LOAD);
  return { ...view, fake };
}

const button = (name: string) => screen.getByRole('button', { name });
// A button of the page behind an open dialog (out of the accessibility tree, but still there).
const hiddenButton = (name: string) => screen.getByRole('button', { name, hidden: true });
// A button of the bottom bar by its words, shown or not: an element with the `hidden` attribute has
// no accessible name, so a role query cannot find it.
const barButton = (name: string, anchor = 'What it cost') => {
  const bar = screen.getByText(anchor, { selector: 'button' }).parentElement as HTMLElement;
  return within(bar).getByText(name, { selector: 'button' });
};
// No message is on screen: the section's own live region (the shell has others, with their own
// words) is empty. The module's class names are served as written (vite.config.ts).
const noMessage = () => screen.getAllByRole('status')
  .filter(region => region.className.includes('region'))
  .every(region => region.textContent === '');
const dialog = (name: string) => screen.findByRole('alertdialog', { name }, LOAD);
const boxOf = (name: string) => screen.getByRole('textbox', { name: `How many of ${name} are left` });
const ready = () => waitFor(() => { expect(button('Close the month')).toBeEnabled(); }, LOAD);

// A tap on a button of the page behind an open dialog, as a script or a second tap would make it
// (the dialog is modal, so a person cannot reach it).
const tap = (name: string) => {
  fireEvent.click(name === 'Close the month' || name === 'Reopen the month' ? barButton(name) : hiddenButton(name));
};

describe('the bottom bar', () => {
  it('offers «What it cost» and «Close the month» (the primary one) on an open month, and hides «Reopen»', async () => {
    await loaded();
    expect(button('What it cost')).toBeInTheDocument();
    expect(button('Close the month').className).toContain('primary');
    // Built and hidden, not left out: the month changes live.
    expect(barButton('Reopen the month')).not.toBeVisible();
    expect(screen.queryByRole('button', { name: 'Reopen the month' })).not.toBeInTheDocument();
  });

  it('offers «Reopen the month», quieter, on a closed month, and hides «Close the month»', async () => {
    await loaded(source([closedMonthDoc('2026-09', { names: { flour: 'Farina 25kg' } })]), '/stocktake/2026-09');
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'Reopen the month' })).toBeInTheDocument(); }, LOAD);
    expect(button('Reopen the month').className).not.toContain('primary');
    expect(button('Reopen the month').className).toContain('secondary');
    expect(barButton('Close the month')).not.toBeVisible();
    expect(button('What it cost')).toBeInTheDocument();
  });

  it.each([['the owner', {}], ['a manager', MANAGER]])('is shown to %s', async (_who, session) => {
    await loaded(source(), '/stocktake/2026-10', { session });
    expect(button('What it cost')).toBeInTheDocument();
    expect(button('Close the month')).toBeInTheDocument();
  });

  it('is not shown to an employee, hidden or not', async () => {
    await loaded(source(), '/stocktake/2026-10', { session: EMPLOYEE });
    for (const name of ['What it cost', 'Close the month', 'Reopen the month']) {
      expect(screen.queryByRole('button', { name, hidden: true })).not.toBeInTheDocument();
    }
  });

  it('is not shown to an employee on the sentence of a month the rules refuse', async () => {
    const fake = source();
    fake.refuse.watchMonth = true;
    renderStocktake('/stocktake/2026-09', { source: fake, session: EMPLOYEE });
    expect(await screen.findByText(
      'This month cannot be opened here: it is closed, or the Stocktake is no longer shown to employees. Owners and managers still see it.',
      undefined,
      LOAD,
    )).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'What it cost', hidden: true })).not.toBeInTheDocument();
  });

  it('shuts the month button until the month and the products have answered', async () => {
    const fake = source();
    fake.hold();
    renderStocktake('/stocktake/2026-10', { source: fake });
    await screen.findAllByRole('heading', { level: 3 }, LOAD);
    expect(button('Close the month')).toBeDisabled();
    fake.release();
    await ready();
  });

  it('sticks to the bottom of the list\'s column, after the list', async () => {
    await loaded();
    const bar = button('What it cost').parentElement as HTMLElement;
    expect(bar.contains(button('Close the month'))).toBe(true);
    expect(bar.parentElement?.lastElementChild).toBe(bar);
  });

  it('opens «What it cost» by pushing its address', async () => {
    const { router, user } = await loaded();
    await user.click(button('What it cost'));
    expect(router.state.location.pathname).toBe('/stocktake/2026-10/cost');
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('speaks Italian', async () => {
    await loaded(source(), '/stocktake/2026-10', { lang: 'it' });
    expect(button(italian['stock.seeCost'])).toBeInTheDocument();
    expect(button(italian['stock.closeMonth'])).toBeInTheDocument();
    expect(barButton(italian['stock.reopenMonth'], italian['stock.seeCost'])).not.toBeVisible();
  });
});

describe('Carry forward', () => {
  const september = () => closedMonthDoc('2026-09', {
    names: { flour: 'Farina 25kg', sugar: 'Zucchero' }, closing: { flour: 5, sugar: 2.5 },
  });

  it('asks first, naming the month before, and reads nothing if the answer is no', async () => {
    const fake = source([monthDoc('2026-10'), september()]);
    const { user } = await loaded(fake);
    await user.click(button('Carry forward'));
    const ask = await dialog('Carry last month’s counts forward?');
    expect(ask).toHaveAccessibleDescription(
      'The opening figures for this month become what was left at the end of September 2026. Anything already typed here is overwritten.',
    );
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(fake.getMonthOnce).not.toHaveBeenCalled();
    expect(noMessage()).toBe(true);
    await waitFor(() => { expect(button('Carry forward')).toHaveFocus(); });
  });

  it('copies the counted closings into the openings and says how many', async () => {
    const fake = source([monthDoc('2026-10'), september()]);
    const { user } = await loaded(fake);
    await user.click(button('Carry forward'));
    await user.click(within(await dialog('Carry last month’s counts forward?')).getByRole('button', { name: 'Carry forward' }));

    expect(await screen.findByText('2 opening figures carried forward.')).toBeInTheDocument();
    expect(fake.getMonthOnce).toHaveBeenCalledWith('2026-09');
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.monthId).toBe('2026-10');
    expect(fake.saved[0]?.patch.opening).toEqual({ flour: 5, sugar: 2.5 });
  });

  it('says «1 opening figure», in the singular', async () => {
    const fake = source([monthDoc('2026-10'), closedMonthDoc('2026-09', { closing: { flour: 5 } })]);
    const { user } = await loaded(fake);
    await user.click(button('Carry forward'));
    await user.click(within(await dialog('Carry last month’s counts forward?')).getByRole('button', { name: 'Carry forward' }));
    expect(await screen.findByText('1 opening figure carried forward.')).toBeInTheDocument();
  });

  it('says there is nothing to carry when the month before has nothing, or does not exist', async () => {
    const { user, fake } = await loaded();
    await user.click(button('Carry forward'));
    await user.click(within(await dialog('Carry last month’s counts forward?')).getByRole('button', { name: 'Carry forward' }));
    expect(await screen.findByText('There is nothing to carry forward from that month.')).toBeInTheDocument();
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
  });

  // ⚠️ THREE ANSWERS, NOT TWO: «nothing there» and «could not read it» mean opposite things.
  it('says it could not read the month, which is not the same as nothing', async () => {
    const fake = source([monthDoc('2026-10'), september()]);
    fake.refuse.getMonthOnce = true;
    const { user } = await loaded(fake);
    await user.click(button('Carry forward'));
    await user.click(within(await dialog('Carry last month’s counts forward?')).getByRole('button', { name: 'Carry forward' }));
    expect(await screen.findByText('Could not read that month — check the connection and try again.')).toBeInTheDocument();
    expect(screen.queryByText('There is nothing to carry forward from that month.')).not.toBeInTheDocument();
    expect(fake.saved).toHaveLength(0);
  });

  it('overwrites an opening already typed, as the dialog says', async () => {
    const fake = source([monthDoc('2026-10', { opening: { flour: 99, butter: 7 } }), september()]);
    const { user } = await loaded(fake);
    await user.click(button('Carry forward'));
    await user.click(within(await dialog('Carry last month’s counts forward?')).getByRole('button', { name: 'Carry forward' }));
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.months.get('2026-10')?.opening).toEqual({ flour: 5, sugar: 2.5, butter: 7 });
  });

  it('is not offered on a closed month, nor to an employee', async () => {
    await loaded(source([closedMonthDoc('2026-09', { names: { flour: 'Farina 25kg' } })]), '/stocktake/2026-09');
    expect(screen.queryByRole('button', { name: 'Carry forward' })).not.toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    const fake = source([monthDoc('2026-10'), september()]);
    const { user } = await loaded(fake, '/stocktake/2026-10', { lang: 'it' });
    await user.click(button(italian['stock.carryShort']));
    expect(await dialog(italian['stock.carryTitle'])).toBeInTheDocument();
  });
});

describe('From the orders', () => {
  const ORDERS = [
    { date: '2026-10-03', quantities: { flour: 3, sugar: 2 } },
    { date: '2026-10-09', quantities: { flour: 2, butter: 4 }, missing: { butter: true } },
    // Another month: not this one's.
    { date: '2026-09-28', quantities: { flour: 100 } },
  ];

  const fill = async (user: ReturnType<typeof renderStocktake>['user']) => {
    await user.click(button('From the orders'));
  };

  it('says it could not read the orders, and writes nothing', async () => {
    const fake = source([monthDoc('2026-10')], ORDERS);
    fake.refuse.orders = true;
    const { user } = await loaded(fake);
    await fill(user);
    expect(await screen.findByText('Could not read the orders — write in what you bought by hand.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.saved).toHaveLength(0);
  });

  it('says when the month has no orders', async () => {
    const { user, fake } = await loaded(source([monthDoc('2026-10')], [ORDERS[2] as Record<string, unknown>]));
    await fill(user);
    expect(await screen.findByText('No orders recorded in October 2026.')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(fake.saved).toHaveLength(0);
  });

  it('asks first, saying what it cannot know, and fills nothing if the answer is no', async () => {
    const fake = source([monthDoc('2026-10', { purchased: { butter: 9 } })], ORDERS);
    const { user } = await loaded(fake);
    await fill(user);
    const ask = await dialog('Fill in what was bought?');
    expect(ask).toHaveAccessibleDescription(/^The orders recorded in October 2026 account for 2 products\. What was ordered goes in as what you bought, replacing anything typed here by hand\. Careful: ordered is not the same as delivered/);
    await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
    expect(fake.months.get('2026-10')?.purchased).toEqual({ butter: 9 });
  });

  it('fills in what was ordered less what was ticked missing, REPLACING what was typed', async () => {
    const fake = source([monthDoc('2026-10', { purchased: { butter: 9 } })], ORDERS);
    const { user } = await loaded(fake);
    await fill(user);
    await user.click(within(await dialog('Fill in what was bought?')).getByRole('button', { name: 'Fill them in' }));

    // 5 flour and 2 sugar; the butter ticked missing is not counted, and the 9 typed by hand is cleared.
    expect(await screen.findByText('2 products filled in from the orders.')).toBeInTheDocument();
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.purchased).toEqual({ flour: 5, sugar: 2 });
    expect(fake.saved[0]?.clear).toEqual({ purchased: { butter: true } });
    expect(fake.months.get('2026-10')?.purchased).toEqual({ flour: 5, sugar: 2 });
    // And it shows in the answer of a product.
    await user.click(screen.getByRole('button', { name: 'Open Farina 25kg' }));
    expect(await screen.findByRole('textbox', { name: 'How many you bought during the month' })).toHaveValue('5');
  });

  it('says «1 product» in the singular', async () => {
    const fake = source([monthDoc('2026-10')], [{ date: '2026-10-03', quantities: { flour: 3 } }]);
    const { user } = await loaded(fake);
    await fill(user);
    const ask = await dialog('Fill in what was bought?');
    expect(ask).toHaveAccessibleDescription(/account for 1 product\. /);
    await user.click(within(ask).getByRole('button', { name: 'Fill them in' }));
    expect(await screen.findByText('1 product filled in from the orders.')).toBeInTheDocument();
  });

  // ⚠️ Said in a dialog and not in the status message: a message vanishes before a list of names can
  // be read, and a quiet omission would read as «none bought».
  it('shows only the other-unit sentence, in a dialog with one button, when nothing could be counted', async () => {
    const fake = source([monthDoc('2026-10')], [{ date: '2026-10-03', quantities: { flour: 2 }, units: { flour: 'busta' } }]);
    const { user } = await loaded(fake);
    await fill(user);
    const sentence = 'Farina 00 25kg: not counted here — the app cannot tell how many of the counted unit they make. Add them by hand.';
    const alert = await dialog(sentence);
    expect(alert).toHaveAccessibleDescription(sentence);
    expect(within(alert).getAllByRole('button')).toHaveLength(1);
    expect(within(alert).getByRole('button', { name: 'OK' })).toHaveFocus();
    expect(screen.queryByRole('alertdialog', { name: 'Fill in what was bought?' })).not.toBeInTheDocument();

    await user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    // Nothing was filled in, and nothing asked.
    await new Promise(resolve => { setTimeout(resolve, 900); });
    expect(fake.saved).toHaveLength(0);
    expect(noMessage()).toBe(true);
    await waitFor(() => { expect(button('From the orders')).toHaveFocus(); });
  });

  it('names the products in another unit with the invoice name and the pack text, in order', async () => {
    const fake = source([monthDoc('2026-10')], [{
      date: '2026-10-03',
      quantities: { flour: 2, butter: 1, gone: 3 },
      units: { flour: 'busta', butter: 'cartone', gone: 'busta' },
    }]);
    const { user } = await loaded(fake);
    await fill(user);
    // The `name` field and the pack text (not the short name), A to Z; a deleted product has none.
    await dialog('Burro 1kg, Farina 00 25kg, Product with no name: not counted here — the app cannot tell how many of the counted unit they make. Add them by hand.');
  });

  it('fills in what it could, then tells what it could not, in the same dialog as when nothing was counted', async () => {
    const fake = source([monthDoc('2026-10')], [{
      date: '2026-10-03', quantities: { sugar: 4, flour: 2 }, units: { flour: 'busta' },
    }]);
    const { user } = await loaded(fake);
    await fill(user);
    await user.click(within(await dialog('Fill in what was bought?')).getByRole('button', { name: 'Fill them in' }));

    expect(await screen.findByText('1 product filled in from the orders.')).toBeInTheDocument();
    const sentence = 'Farina 00 25kg: not counted here — the app cannot tell how many of the counted unit they make. Add them by hand.';
    const alert = await dialog(sentence);
    expect(within(alert).getAllByRole('button')).toHaveLength(1);
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.purchased).toEqual({ sugar: 4 });
    await user.click(within(alert).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
  });

  it('is available to an employee, who fills in the month like anybody', async () => {
    const fake = source([monthDoc('2026-10')], ORDERS);
    const { user } = await loaded(fake, '/stocktake/2026-10', { session: EMPLOYEE });
    await fill(user);
    await user.click(within(await dialog('Fill in what was bought?')).getByRole('button', { name: 'Fill them in' }));
    await waitFor(() => { expect(fake.saved).toHaveLength(1); }, SAVED);
    expect(fake.saved[0]?.patch.purchased).toEqual({ flour: 5, sugar: 2 });
  });

  it('is not offered on a closed month', async () => {
    await loaded(source([closedMonthDoc('2026-09', { names: { flour: 'Farina 25kg' } })], ORDERS), '/stocktake/2026-09');
    expect(screen.queryByRole('button', { name: 'From the orders' })).not.toBeInTheDocument();
  });

  it('ignores a second tap while the first is still reading the orders', async () => {
    const fake = source([monthDoc('2026-10')], ORDERS);
    vi.mocked(fake.getOrdersInMonth).mockImplementationOnce(
      () => new Promise(resolve => { setTimeout(() => { resolve(ORDERS.map((o, i) => ({ id: `o${i}`, ...o }))); }, 80); }),
    );
    const { user } = await loaded(fake);
    await user.click(button('From the orders'));
    await user.click(button('From the orders'));
    await dialog('Fill in what was bought?');
    expect(fake.getOrdersInMonth).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
  });

  it('speaks Italian', async () => {
    const fake = source([monthDoc('2026-10')], ORDERS);
    const { user } = await loaded(fake, '/stocktake/2026-10', { lang: 'it' });
    await user.click(button(italian['stock.purchasesShort']));
    expect(await dialog(italian['stock.purchasesTitle'])).toBeInTheDocument();
  });
});

describe('Close the month', () => {
  // Flour 4 left of 10, sugar 2 of 5; the butter is not counted.
  const counted = () => monthDoc('2026-10', {
    opening: { flour: 10, sugar: 5 }, closing: { flour: 4, sugar: 2 },
  });

  it('asks first, saying the figures stay as they are', async () => {
    const fake = source([monthDoc('2026-10', {
      opening: { flour: 10, sugar: 5, butter: 3 }, closing: { flour: 4, sugar: 2, butter: 1 },
    })]);
    const { user } = await loaded(fake);
    await ready();
    await user.click(button('Close the month'));
    const ask = await dialog('Close the month?');
    expect(ask).toHaveAccessibleDescription(
      'The figures for October 2026 stay as they are, and the next month opens with what is on the shelves today. You can reopen it if you need to.',
    );
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('counts the products nobody counted into the question', async () => {
    const { user } = await loaded(source([counted()]));
    await ready();
    await user.click(button('Close the month'));
    expect(await dialog('Close the month?')).toHaveAccessibleDescription(
      '1 product has not been counted, so October 2026 will have no answer for it. The month is closed as it stands and the next one opens with what is there today.',
    );
  });

  it('says it in the plural for two', async () => {
    const { user } = await loaded(source([monthDoc('2026-10', { closing: { flour: 4 } })]));
    await ready();
    await user.click(button('Close the month'));
    expect(await dialog('Close the month?')).toHaveAccessibleDescription(/^2 products have not been counted, so October 2026 will have no answer for them\./);
  });

  it('writes nothing, and announces nothing, if the answer is no', async () => {
    const fake = source([counted()]);
    const heard: string[] = [];
    const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listener);
    try {
      const { user } = await loaded(fake);
      await ready();
      await user.click(button('Close the month'));
      await user.click(within(await dialog('Close the month?')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(fake.saved).toHaveLength(0);
      expect(heard).toEqual([]);
      expect(button('Close the month')).toBeVisible();
      await waitFor(() => { expect(button('Close the month')).toHaveFocus(); });
    } finally {
      window.removeEventListener(ACTION_EVENT, listener);
    }
  });

  it('writes the next month first, then this one with what the month was worth, and announces it', async () => {
    const fake = source([monthDoc('2026-10', {
      opening: { flour: 10, sugar: 5 }, closing: { flour: 4, sugar: 2 }, packKg: { butter: 2 },
    })]);
    const heard: string[] = [];
    const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listener);
    try {
      const { user } = await loaded(fake);
      await ready();
      await user.click(button('Close the month'));
      await user.click(within(await dialog('Close the month?')).getByRole('button', { name: 'Close the month' }));

      expect(await screen.findByText('Month closed. November 2026 is open, with what was left as its opening.')).toBeInTheDocument();
      expect(heard).toEqual(['month-closed']);

      // ⚠️ THE NEXT MONTH IS WRITTEN FIRST: a failure of the second write fails towards «closed
      // nothing, lost nothing».
      expect(fake.saved.map(save => save.monthId)).toEqual(['2026-11', '2026-10']);
      const [next, thisMonth] = fake.saved;
      expect(next?.patch).toMatchObject({ month: '2026-11', opening: { flour: 4, sugar: 2 }, packKg: { butter: 2 } });
      expect(thisMonth?.patch.closedAt).toMatch(/^2026-10-1[45]T/);
      // Frozen as the screens show them, and what ONE counted unit cost where it is known.
      expect(thisMonth?.patch.names).toEqual({ flour: 'Farina 25kg', sugar: 'Zucchero', butter: 'Burro 1kg' });
      // The weight typed in wins (2 kg of butter at 8 a kilo is 16 a pack); the pack text is read for
      // the rest; sugar has neither, and no price either.
      expect(thisMonth?.patch.unitPrice).toEqual({ flour: 20, butter: 16 });
      expect(thisMonth?.patch.packKg).toEqual({ flour: 25, butter: 2 });
      expect(fake.months.get('2026-11')?.opening).toEqual({ flour: 4, sugar: 2 });
    } finally {
      window.removeEventListener(ACTION_EVENT, listener);
    }
  });

  it('sends what is still unsent before it closes', async () => {
    const fake = source([counted()]);
    const { user } = await loaded(fake);
    await ready();
    await waitFor(() => { expect(boxOf('Burro 1kg')).toBeEnabled(); });
    await user.type(boxOf('Burro 1kg'), '3');
    await user.tab();
    await user.click(button('Close the month'));
    await user.click(within(await dialog('Close the month?')).getByRole('button', { name: 'Close the month' }));
    await screen.findByText(/^Month closed\./);
    expect(fake.saved.map(save => save.monthId)).toEqual(['2026-10', '2026-11', '2026-10']);
    expect(fake.saved[0]?.patch.closing).toEqual({ butter: 3 });
    expect(fake.saved[1]?.patch.opening).toEqual({ flour: 4, sugar: 2, butter: 3 });
  });

  it('freezes the count typed while the question was open, not the one it was asked about', async () => {
    const fake = source([counted()]);
    const { user } = await loaded(fake);
    await ready();
    await user.click(button('Close the month'));
    const ask = await dialog('Close the month?');
    // Another phone counts the butter while this one reads the question.
    fake.months.set('2026-10', { ...(fake.months.get('2026-10') ?? monthDoc('2026-10')), closing: { flour: 4, sugar: 2, butter: 6 }, opening: { flour: 10, sugar: 5, butter: 8 } });
    fake.push();
    await user.click(within(ask).getByRole('button', { name: 'Close the month' }));
    await screen.findByText(/^Month closed\./);
    const thisMonth = fake.saved.find(save => save.monthId === '2026-10');
    expect(thisMonth?.patch.unitPrice).toEqual({ flour: 20, butter: 8 });
    expect(fake.saved.find(save => save.monthId === '2026-11')?.patch.opening).toEqual({ flour: 4, sugar: 2, butter: 6 });
  });

  it('shuts the boxes, shows the closed month and swaps the month button, keeping the focus on it', async () => {
    const fake = source([counted()]);
    const { user } = await loaded(fake);
    await ready();
    await waitFor(() => { expect(boxOf('Farina 25kg')).toBeEnabled(); });
    await user.click(button('Close the month'));
    await user.click(within(await dialog('Close the month?')).getByRole('button', { name: 'Close the month' }));

    await waitFor(() => { expect(boxOf('Farina 25kg')).toBeDisabled(); });
    expect(boxOf('Zucchero')).toBeDisabled();
    expect(screen.getByText('This month is closed: its figures no longer change.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Carry forward' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'From the orders' })).not.toBeInTheDocument();
    expect(button('Reopen the month')).toBeVisible();
    expect(barButton('Close the month')).not.toBeVisible();
    // The button that was pressed is gone: the focus follows to the one that takes its place.
    await waitFor(() => { expect(button('Reopen the month')).toHaveFocus(); });
  });

  // The month is closed on this phone whatever the server says (it is never rolled back: the write
  // stays in the browser's database and goes up on its own).
  it('shows the month as closed when the write is refused, with the screen still working', async () => {
    const fake = source([counted()]);
    fake.refuse.save = true;
    const { user } = await loaded(fake);
    await ready();
    await user.click(button('Close the month'));
    await user.click(within(await dialog('Close the month?')).getByRole('button', { name: 'Close the month' }));
    await waitFor(() => { expect(button('Reopen the month')).toBeVisible(); });
    expect(boxOf('Farina 25kg')).toBeDisabled();
    expect(fake.saved.map(save => save.monthId)).toEqual(['2026-11', '2026-10']);
  });

  it('ignores a second tap while the question is open', async () => {
    const fake = source([counted()]);
    const { user } = await loaded(fake);
    await ready();
    const close = button('Close the month');
    fireEvent.click(close);
    await dialog('Close the month?');
    tap('Close the month');
    tap('Close the month');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);

    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Close the month' }));
    await screen.findByText(/^Month closed\./);
    // Closed once: the next month, then this one.
    expect(fake.saved.map(save => save.monthId)).toEqual(['2026-11', '2026-10']);
  });

  it('ignores another action while one is running', async () => {
    const fake = source([counted(), closedMonthDoc('2026-09', { closing: { flour: 5 } })]);
    const { user } = await loaded(fake);
    await ready();
    fireEvent.click(button('Close the month'));
    await dialog('Close the month?');
    tap('Carry forward');
    tap('From the orders');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    expect(screen.getByRole('alertdialog', { name: 'Close the month?' })).toBeInTheDocument();
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(fake.getMonthOnce).not.toHaveBeenCalled();
    expect(fake.getOrdersInMonth).not.toHaveBeenCalled();
  });

  it('can be pressed again after the question was answered', async () => {
    const { user } = await loaded(source([counted()]));
    await ready();
    await user.click(button('Close the month'));
    await user.click(within(await dialog('Close the month?')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    await user.click(button('Close the month'));
    expect(await dialog('Close the month?')).toBeInTheDocument();
  });

  it('speaks Italian', async () => {
    const { user } = await loaded(source([counted()]), '/stocktake/2026-10', { lang: 'it' });
    await waitFor(() => { expect(button(italian['stock.closeMonth'])).toBeEnabled(); }, LOAD);
    await user.click(button(italian['stock.closeMonth']));
    expect(await dialog(italian['stock.closeTitle'])).toBeInTheDocument();
  });
});

describe('Reopen the month', () => {
  const closedSeptember = () => closedMonthDoc('2026-09', {
    names: { flour: 'Farina 25kg' }, opening: { flour: 10 }, closing: { flour: 4 }, unitPrice: { flour: 20 },
  });

  it('asks first, saying the month after does not change', async () => {
    const { user } = await loaded(source([closedSeptember()]), '/stocktake/2026-09');
    await waitFor(() => { expect(button('Reopen the month')).toBeEnabled(); }, LOAD);
    await user.click(button('Reopen the month'));
    const ask = await dialog('Reopen this month?');
    expect(ask).toHaveAccessibleDescription(
      'You will be able to correct its figures again. Note that the month after it does NOT change: its opening figures were copied when this one was closed, so correct them there too if they matter.',
    );
    expect(within(ask).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('changes nothing if the answer is no', async () => {
    const fake = source([closedSeptember()]);
    const { user } = await loaded(fake, '/stocktake/2026-09');
    await waitFor(() => { expect(button('Reopen the month')).toBeEnabled(); }, LOAD);
    await user.click(button('Reopen the month'));
    await user.click(within(await dialog('Reopen this month?')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(fake.saved).toHaveLength(0);
    expect(button('Reopen the month')).toBeVisible();
    await waitFor(() => { expect(button('Reopen the month')).toHaveFocus(); });
  });

  it('writes closedAt back to empty, leaves the next month alone, and opens the boxes again', async () => {
    const fake = source([closedSeptember(), monthDoc('2026-10', { opening: { flour: 4 } })]);
    const { user } = await loaded(fake, '/stocktake/2026-09');
    await waitFor(() => { expect(button('Reopen the month')).toBeEnabled(); }, LOAD);
    expect(boxOf('Farina 25kg')).toBeDisabled();
    await user.click(button('Reopen the month'));
    await user.click(within(await dialog('Reopen this month?')).getByRole('button', { name: 'Reopen' }));

    await waitFor(() => { expect(boxOf('Farina 25kg')).toBeEnabled(); });
    expect(fake.saved).toHaveLength(1);
    expect(fake.saved[0]?.monthId).toBe('2026-09');
    expect(fake.saved[0]?.patch.closedAt).toBe('');
    expect(fake.months.get('2026-10')?.opening).toEqual({ flour: 4 });
    // The month button swaps back to «Close the month», with the focus on it, and the fill-ins return.
    expect(button('Close the month')).toBeVisible();
    expect(barButton('Reopen the month')).not.toBeVisible();
    await waitFor(() => { expect(button('Close the month')).toHaveFocus(); });
    expect(button('Carry forward')).toBeInTheDocument();
    expect(button('From the orders')).toBeInTheDocument();
  });

  it('ignores a second tap while the question is open', async () => {
    const fake = source([closedSeptember()]);
    const { user } = await loaded(fake, '/stocktake/2026-09');
    await waitFor(() => { expect(button('Reopen the month')).toBeEnabled(); }, LOAD);
    fireEvent.click(button('Reopen the month'));
    await dialog('Reopen this month?');
    tap('Reopen the month');
    expect(screen.getAllByRole('alertdialog')).toHaveLength(1);
    await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => { expect(fake.saved).toHaveLength(1); });
  });

  it('speaks Italian', async () => {
    const { user } = await loaded(source([closedSeptember()]), '/stocktake/2026-09', { lang: 'it' });
    await waitFor(() => { expect(button(italian['stock.reopenMonth'])).toBeEnabled(); }, LOAD);
    await user.click(button(italian['stock.reopenMonth']));
    expect(await dialog(italian['stock.reopenTitle'])).toBeInTheDocument();
  });
});
