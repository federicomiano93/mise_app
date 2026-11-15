import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithSession } from '../testing/renderWithSession';
import { dropOrphanLabDrafts, hasLabDraft } from './pendingLabWork';
import { SignOutButton } from './SignOutButton';
import { SwitchVenueButton } from './SwitchVenueButton';
import type { Session } from './session';

// Signing out and switching venue wipe this device's local copies, and a lab production in progress lives in one of them: both ask
// first when one is open for the open venue (Food cost lab mode, review of PR #537).

const KEY = 'foodcost-lab-draft:bakery:bread';
const OTHER_VENUE = 'foodcost-lab-draft:restaurant:bread';
const DRAFT = JSON.stringify({ v: 1, startedAt: 1_700_000_000_000, step: 'oven', lines: [] });

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

describe('which drafts count', () => {
  it('only the open venue\'s', () => {
    expect(hasLabDraft('bakery')).toBe(false);
    window.localStorage.setItem(OTHER_VENUE, DRAFT);
    expect(hasLabDraft('bakery')).toBe(false);
    window.localStorage.setItem(KEY, DRAFT);
    expect(hasLabDraft('bakery')).toBe(true);
    expect(hasLabDraft(null)).toBe(false);
  });

  it('only drafts that are drafts: a corrupt key is not a production', () => {
    window.localStorage.setItem(KEY, '{broken');
    expect(hasLabDraft('bakery')).toBe(false);
    window.localStorage.setItem(KEY, JSON.stringify({ v: 2, startedAt: 5, lines: [] }));
    expect(hasLabDraft('bakery')).toBe(false);
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, startedAt: 'yesterday', lines: [] }));
    expect(hasLabDraft('bakery')).toBe(false);
    window.localStorage.setItem(KEY, DRAFT);
    expect(hasLabDraft('bakery')).toBe(true);
  });

  it('no storage, no question', () => {
    expect(hasLabDraft('bakery', null)).toBe(false);
  });
});

describe('cleaning the drafts of products that are gone', () => {
  it('removes the venue\'s drafts of missing products and corrupt keys, and nobody else\'s', () => {
    window.localStorage.setItem('foodcost-lab-draft:bakery:bread', DRAFT);
    window.localStorage.setItem('foodcost-lab-draft:bakery:gone', DRAFT);
    window.localStorage.setItem('foodcost-lab-draft:bakery:broken', '{nope');
    window.localStorage.setItem(OTHER_VENUE, DRAFT);
    dropOrphanLabDrafts('bakery', new Set(['bread', 'broken']));
    expect(window.localStorage.getItem('foodcost-lab-draft:bakery:bread')).toBe(DRAFT);
    expect(window.localStorage.getItem('foodcost-lab-draft:bakery:gone')).toBeNull();
    expect(window.localStorage.getItem('foodcost-lab-draft:bakery:broken')).toBeNull();
    expect(window.localStorage.getItem(OTHER_VENUE)).toBe(DRAFT);
  });

  it('with no storage does nothing and does not throw', () => {
    expect(() => { dropOrphanLabDrafts('bakery', new Set(), null); }).not.toThrow();
  });
});

describe('signing out with a lab production open', () => {
  async function confirmSignOut() {
    const view = renderWithSession(<SignOutButton />);
    await view.user.click(screen.getByRole('button', { name: 'Log out' }));
    const dialog = await screen.findByRole('alertdialog');
    await view.user.click(within(dialog).getByRole('button', { name: 'Log out' }));
    return view;
  }

  it('warns first and does not sign out; Stay keeps everything', async () => {
    window.localStorage.setItem(KEY, DRAFT);
    const { store, user } = await confirmSignOut();
    const warning = await screen.findByRole('alertdialog', { name: 'Lab production' });
    expect(warning).toHaveTextContent('A lab production is open and not saved: leaving loses it.');
    expect(store.signOut).not.toHaveBeenCalled();
    await user.click(within(warning).getByRole('button', { name: 'Stay' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(store.signOut).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
  });

  it('signs out when the person chooses «Leave anyway»', async () => {
    window.localStorage.setItem(KEY, DRAFT);
    const { store, user } = await confirmSignOut();
    const warning = await screen.findByRole('alertdialog', { name: 'Lab production' });
    await user.click(within(warning).getByRole('button', { name: 'Leave anyway' }));
    await waitFor(() => { expect(store.signOut).toHaveBeenCalledTimes(1); });
  });

  it('asks nothing extra when there is no production, or it is another venue\'s', async () => {
    window.localStorage.setItem(OTHER_VENUE, DRAFT);
    const { store } = await confirmSignOut();
    await waitFor(() => { expect(store.signOut).toHaveBeenCalledTimes(1); });
  });

  it('asks the lab question after the unsent-changes one, when both apply', async () => {
    window.localStorage.setItem(KEY, DRAFT);
    const view = renderWithSession(<SignOutButton />);
    view.store.changesStillWaiting.mockResolvedValue(true);
    await view.user.click(screen.getByRole('button', { name: 'Log out' }));
    await view.user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Log out' }));
    await view.user.click(within(await screen.findByRole('alertdialog', { name: 'Not sent yet' })).getByRole('button', { name: 'Go on anyway' }));
    const warning = await screen.findByRole('alertdialog', { name: 'Lab production' });
    expect(view.store.signOut).not.toHaveBeenCalled();
    await view.user.click(within(warning).getByRole('button', { name: 'Leave anyway' }));
    await waitFor(() => { expect(view.store.signOut).toHaveBeenCalledTimes(1); });
  });
});

describe('switching venue with a lab production open', () => {
  const TWO: Partial<Session> = {
    options: ['bakery', 'restaurant'],
    optionNames: { bakery: 'The Bakery', restaurant: 'The Restaurant' },
    locationId: 'bakery',
    name: 'The Bakery',
  };

  it('warns first; «Leave anyway» switches, Stay does not', async () => {
    window.localStorage.setItem(KEY, DRAFT);
    const { store, user } = renderWithSession(<SwitchVenueButton>The Bakery</SwitchVenueButton>, { session: TWO });
    await user.click(screen.getByRole('button', { name: 'The Bakery' }));
    await user.click(await screen.findByRole('button', { name: 'The Restaurant' }));
    const warning = await screen.findByRole('alertdialog', { name: 'Lab production' });
    expect(store.switchLocation).not.toHaveBeenCalled();
    await user.click(within(warning).getByRole('button', { name: 'Stay' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(store.switchLocation).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'The Bakery' }));
    await user.click(await screen.findByRole('button', { name: 'The Restaurant' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Lab production' })).getByRole('button', { name: 'Leave anyway' }));
    await waitFor(() => { expect(store.switchLocation).toHaveBeenCalledWith('restaurant'); });
  });
});
