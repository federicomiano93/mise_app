import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';

// What the shell shows depends on WHO is signed in and WHICH VENUE is open. These specs set both
// through the fake session; AppShell.spec.tsx covers the shell itself for the default owner.

const rail = (name = 'All sections') => within(screen.getByRole('navigation', { name }));
const tabs = (name = 'Main sections') => within(screen.getByRole('navigation', { name }));
// The top bar is the first banner: the page's own heading sits in a header too.
const topBar = () => within(screen.getAllByRole('banner')[0] as HTMLElement);
const linkNames = (scope: { getAllByRole: (role: string) => HTMLElement[] }) =>
  scope.getAllByRole('link').map(link => link.textContent);

const EMPLOYEE = { canManage: false, isOwner: false, role: 'staff' as const, location: {} };
// Straight from production: a restaurant that bought Orders and nothing else.
const RESTAURANT = {
  location: { sections: { calculator: false, catalogue: false, pastries: false, foodcost: false } },
};

describe('the shell for an employee', () => {
  it('keeps Food cost and Stocktake out of the rail', () => {
    renderApp('/orders', { session: EMPLOYEE });
    expect(linkNames(rail())).toEqual(['Orders', 'Suppliers', 'Recipes', 'Calculator', 'Pastries', 'Settings']);
  });

  it('keeps Stocktake out of the tab bar and both out of «More»', async () => {
    const { user } = renderApp('/orders', { session: EMPLOYEE });
    expect(linkNames(tabs())).toEqual(['Orders', 'Recipes', 'Calculator', 'More']);

    await user.click(tabs().getByRole('link', { name: 'More' }));

    const list = within(await screen.findByRole('list'));
    expect(list.getAllByRole('link').map(link => link.textContent)).toEqual(['Suppliers', 'Pastries', 'Settings']);
  });

  it('shows Food cost when the venue chose to show it to staff, but not Stocktake', () => {
    renderApp('/orders', { session: { ...EMPLOYEE, location: { staffShownCards: { foodcost: true } } } });
    expect(linkNames(rail())).toContain('Food cost');
    expect(linkNames(rail())).not.toContain('Stocktake');
  });

  it('shows a manager everything the venue bought', () => {
    renderApp('/orders', { session: { ...EMPLOYEE, canManage: true, role: 'manager' } });
    expect(linkNames(rail())).toHaveLength(8);
  });

  it('says «not available» for an address typed by hand', async () => {
    const { router, user } = renderApp('/food-cost', { session: EMPLOYEE });

    expect(screen.getByRole('heading', { level: 1, name: 'Food cost' })).toBeInTheDocument();
    expect(screen.getByText('This section is not on for you at this venue.')).toBeInTheDocument();
    // Not the placeholder a shown section has.
    expect(screen.queryByText(/will arrive in one of the next steps/)).not.toBeInTheDocument();
    // The navigation is still around it, and «More» does not claim a section it does not hold.
    expect(rail().getAllByRole('link')).toHaveLength(6);
    expect(tabs().getByRole('link', { name: 'More' })).not.toHaveAttribute('aria-current');

    await user.click(screen.getByRole('link', { name: 'Go to the start' }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders');
  });

  it('says «not available» for Stocktake too', () => {
    renderApp('/stocktake', { session: EMPLOYEE });
    expect(screen.getByRole('heading', { level: 1, name: 'Stocktake' })).toBeInTheDocument();
    expect(screen.getByText('This section is not on for you at this venue.')).toBeInTheDocument();
  });
});

describe('the shell for a venue that bought less', () => {
  it('lists Orders, Suppliers and Settings in the rail', () => {
    renderApp('/orders', { session: RESTAURANT });
    expect(linkNames(rail())).toEqual(['Orders', 'Suppliers', 'Settings']);
  });

  it('has Orders and «More» in the tab bar, with no empty column', () => {
    renderApp('/orders', { session: RESTAURANT });
    expect(linkNames(tabs())).toEqual(['Orders', 'More']);
  });

  it('says «not available» for a section the venue did not buy, even to its owner', () => {
    renderApp('/calculator', { session: RESTAURANT });
    expect(screen.getByRole('heading', { level: 1, name: 'Calculator' })).toBeInTheDocument();
    expect(screen.getByText('This section is not on for you at this venue.')).toBeInTheDocument();
  });

  it('keeps Settings open when nothing else is', async () => {
    const nothing = { location: { sections: { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false } } };
    renderApp('/settings', { session: nothing });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(linkNames(rail())).toEqual(['Settings']);
  });
});

describe('where the address with no section in it lands', () => {
  it('is Orders when Orders is shown', async () => {
    const { router } = renderApp('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'Orders' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/orders');
  });

  it('is the first section shown when Orders is not', async () => {
    const { router } = renderApp('/', { session: { location: { sections: { orders: false } } } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/recipes');
  });

  it('is Settings when nothing else is shown', async () => {
    const nothing = { location: { sections: { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false } } };
    const { router } = renderApp('/', { session: nothing });
    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('leaves the focus alone, as the app arranging itself', async () => {
    renderApp('/', { session: { location: { sections: { orders: false } } } });
    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).not.toHaveFocus();
  });

  it('is where «Go to the start» on «Page not found» leads', async () => {
    const { router, user } = renderApp('/no-such-section', { session: { location: { sections: { orders: false } } } });
    await user.click(screen.getByRole('link', { name: 'Go to the start' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Recipes' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/recipes');
  });
});

describe('the avatar under Settings', () => {
  it('is the first letter of the email, in capitals, and leads to the account', async () => {
    const { router, user } = renderApp('/orders', { session: { user: { uid: 'u2', email: 'chef@club.test', isAnonymous: false } } });

    const avatar = screen.getByRole('link', { name: 'Account' });
    expect(avatar).toHaveTextContent('C');
    expect(avatar).toHaveAttribute('href', '/settings');

    await user.click(avatar);

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('is not one of the sections: it is outside the «All sections» navigation', () => {
    renderApp('/orders');
    const avatar = screen.getByRole('link', { name: 'Account' });
    expect(screen.getByRole('navigation', { name: 'All sections' })).not.toContainElement(avatar);
  });

  it('falls back to the account\'s id when it has no email', () => {
    renderApp('/orders', { session: { user: { uid: 'zed-9', email: null, isAnonymous: false } } });
    expect(screen.getByRole('link', { name: 'Account' })).toHaveTextContent('Z');
  });

  it('is named «Account» in Italian too', () => {
    renderApp('/orders', { lang: 'it' });
    expect(screen.getByRole('link', { name: 'Account' })).toBeInTheDocument();
  });
});

describe('the venue in the top bar', () => {
  const TWO = {
    options: ['bakery', 'restaurant'],
    optionNames: { bakery: 'The Bakery', restaurant: 'The Restaurant' },
    name: 'The Bakery',
  };

  it('is just its name when the account has one venue', () => {
    renderApp('/orders', { session: { name: 'The Bakery' } });
    const header = topBar();
    expect(header.getByText('The Bakery')).toBeInTheDocument();
    expect(header.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the venue\'s first letter in a small square', () => {
    renderApp('/orders', { session: { name: 'the bakery' } });
    expect(topBar().getByText('T')).toBeInTheDocument();
  });

  it('is a button that opens the other venues when the account has several', async () => {
    const { user } = renderApp('/orders', { session: TWO });

    const chip = topBar().getByRole('button', { name: 'The Bakery' });
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog');
    await user.click(chip);

    const dialog = await screen.findByRole('dialog', { name: 'Switch venue' });
    expect(within(dialog).getAllByRole('button').map(button => button.textContent)).toEqual(['The Restaurant', 'Cancel']);
  });

  it('switches to the venue picked, after asking whether anything is waiting to be sent', async () => {
    const { store, user } = renderApp('/orders', { session: TWO });
    await user.click(topBar().getByRole('button', { name: 'The Bakery' }));
    await user.click(await screen.findByRole('button', { name: 'The Restaurant' }));

    await waitFor(() => { expect(store.switchLocation).toHaveBeenCalledWith('restaurant'); });
    expect(store.changesStillWaiting).toHaveBeenCalledTimes(1);
  });

  it('warns first, and does not switch, when something has not reached the server', async () => {
    const { store, user } = renderApp('/orders', { session: TWO });
    store.changesStillWaiting.mockResolvedValue(true);
    await user.click(topBar().getByRole('button', { name: 'The Bakery' }));
    await user.click(await screen.findByRole('button', { name: 'The Restaurant' }));

    expect(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).toBeInTheDocument();
    expect(store.switchLocation).not.toHaveBeenCalled();
  });
});
