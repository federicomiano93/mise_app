import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';

const main = () => within(screen.getByRole('main'));
// The screen’s own card: the page has other live regions (the connection notice).
const card = () => within(screen.getByRole('heading', { level: 2, name: /Sections for employees|Sezioni per i dipendenti/ }).closest('section') as HTMLElement);

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

async function open(
  options: NonNullable<Parameters<typeof renderApp>[1]> = {},
  seed: Parameters<typeof fakeSettingsSource>[0] = {},
) {
  // The «server» holds the same venue the session opened with, unless a spec says the two differ.
  const source: FakeSettingsSource = fakeSettingsSource({ venue: options.session?.location ?? {}, ...seed });
  const view = renderApp('/settings/sections', { ...options, data: { settings: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Sezioni per i dipendenti' : 'Sections for employees' });
  // The server’s answer has been asked for and has arrived.
  await waitFor(() => { expect(source.readVenueFromServer).toHaveBeenCalled(); });
  await new Promise(resolve => setTimeout(resolve, 0));
  return { ...view, source };
}

const sw = (name: string) => screen.getByRole('switch', { name });
const switchNames = () => screen.getAllByRole('switch').map(item => item.getAttribute('aria-labelledby'))
  .map(ids => (ids ?? '').split(' ')[0] ?? '').map(id => document.getElementById(id)?.textContent);

describe('Sections for employees', () => {
  it('has one h1, the intro, and the two sentences that are always on the screen', async () => {
    await open();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(main().getByText('Choose which sections the people who work here see.')).toBeInTheDocument();
    expect(main().getByText(/Owners, managers and head chefs always see every section, so your own app does not change\./)).toBeInTheDocument();
    expect(main().getByText('Employees see the change the next time they open the app. The notifications of a hidden section stop for them at once.')).toBeInTheDocument();
  });

  it('has one switch per section the venue has, named like the sections of the app', async () => {
    await open();
    expect(switchNames()).toEqual(['Calculator', 'Recipes', 'Orders', 'Suppliers', 'Pastries', 'Food cost', 'Stocktake']);
  });

  it('reads a switch as one: the section, its state in words, switch, on', async () => {
    await open();
    expect(sw('Pastries Visible')).toBeChecked();
    expect(sw('Food cost Hidden')).not.toBeChecked();
    expect(sw('Stocktake Hidden')).not.toBeChecked();
  });

  it('shows the state saved on the venue: an everyday section hidden, a money section shown', async () => {
    await open({ session: { location: { staffHiddenCards: { pastries: true }, staffShownCards: { foodcost: true } } } });
    expect(sw('Pastries Hidden')).not.toBeChecked();
    expect(sw('Food cost Visible')).toBeChecked();
    expect(sw('Stocktake Hidden')).not.toBeChecked();
  });

  it('leaves out the sections the venue does not have, money ones included', async () => {
    await open({ session: { location: { sections: { foodcost: false, pastries: false } } } });
    expect(switchNames()).toEqual(['Calculator', 'Recipes', 'Orders', 'Suppliers']);
  });

  it('keeps Orders and Suppliers together: both come with the Orders part of the business', async () => {
    await open({ session: { location: { sections: { orders: false } } } });
    expect(switchNames()).toEqual(['Calculator', 'Recipes', 'Pastries', 'Food cost', 'Stocktake']);
  });

  it('says so when the venue has no section to choose from', async () => {
    await open({ session: { location: { sections: { orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false } } } });
    expect(main().getByText('This business has no sections to choose from.')).toBeInTheDocument();
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  describe('hiding', () => {
    it('asks first, in the danger look, and says nothing is deleted', async () => {
      const { user, source } = await open();
      await user.click(sw('Pastries Visible'));

      const question = await screen.findByRole('alertdialog', { name: 'Hide «Pastries» from employees?' });
      expect(within(question).getByText('They will no longer see it in the app or be able to open it. Owners, managers and head chefs still see it, and nothing is deleted.')).toBeInTheDocument();
      expect(within(question).queryByText('They will not receive its notifications either.')).not.toBeInTheDocument();
      expect(within(question).getByRole('button', { name: 'Hide it' }).className).toMatch(/danger/);
      expect(source.setStaffCard).not.toHaveBeenCalled();
    });

    it('adds that the notifications stop, for a section that sends them', async () => {
      const { user } = await open();
      await user.click(sw('Calculator Visible'));
      const question = await screen.findByRole('alertdialog', { name: 'Hide «Calculator» from employees?' });
      expect(within(question).getByText('They will not receive its notifications either.')).toBeInTheDocument();
    });

    it('adds the allergen sheet line for Recipes, as well as the notifications', async () => {
      const { user } = await open();
      await user.click(sw('Recipes Visible'));
      const question = await screen.findByRole('alertdialog', { name: 'Hide «Recipes» from employees?' });
      expect(within(question).getByText(/The allergen sheet is behind it/)).toBeInTheDocument();
      expect(within(question).getByText('They will not receive its notifications either.')).toBeInTheDocument();
    });

    it('asks to hide a money section that was shown, too', async () => {
      const { user } = await open({ session: { location: { staffShownCards: { foodcost: true } } } });
      await user.click(sw('Food cost Visible'));
      expect(await screen.findByRole('alertdialog', { name: 'Hide «Food cost» from employees?' })).toBeInTheDocument();
    });

    it('does nothing on Cancel, and the focus goes back to the switch', async () => {
      const { user, source } = await open();
      await user.click(sw('Pastries Visible'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(source.setStaffCard).not.toHaveBeenCalled();
      expect(sw('Pastries Visible')).toBeChecked();
      await waitFor(() => { expect(sw('Pastries Visible')).toHaveFocus(); });
    });

    it('saves through the server, and shows the section hidden only after it agreed', async () => {
      const { user, source } = await open();
      let agree: (venue: Record<string, unknown>) => void = () => undefined;
      source.setStaffCard = vi.fn(() => new Promise<Record<string, unknown>>(done => { agree = done; }));
      await user.click(sw('Pastries Visible'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hide it' }));

      expect(source.setStaffCard).toHaveBeenCalledWith('pastries', true);
      // The server has not answered: the switch has not moved.
      expect(sw('Pastries Visible')).toBeChecked();
      agree({ staffHiddenCards: { pastries: true } });
      expect(await screen.findByRole('switch', { name: 'Pastries Hidden' })).not.toBeChecked();
    });
  });

  describe('showing', () => {
    it('asks before showing a money section, in the normal look, with the section’s own sentence', async () => {
      const { user, source } = await open();
      await user.click(sw('Food cost Hidden'));
      const question = await screen.findByRole('alertdialog', { name: 'Show «Food cost» to employees?' });
      expect(within(question).getByText(/They will see what every ingredient costs/)).toBeInTheDocument();
      const ok = within(question).getByRole('button', { name: 'Show it' });
      expect(ok.className).not.toMatch(/danger/);

      await user.click(ok);
      expect(source.setStaffCard).toHaveBeenCalledWith('foodcost', false);
      expect(await screen.findByRole('switch', { name: 'Food cost Visible' })).toBeChecked();
    });

    it('says the Stocktake sentence for the Stocktake', async () => {
      const { user } = await open();
      await user.click(sw('Stocktake Hidden'));
      const question = await screen.findByRole('alertdialog', { name: 'Show «Stocktake» to employees?' });
      expect(within(question).getByText(/They will see the products and be able to type the counts/)).toBeInTheDocument();
    });

    it('does not show a money section on Cancel', async () => {
      const { user, source } = await open();
      await user.click(sw('Food cost Hidden'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
      expect(source.setStaffCard).not.toHaveBeenCalled();
    });

    it('shows an everyday section again at once, with no question', async () => {
      const { user, source } = await open({ session: { location: { staffHiddenCards: { pastries: true } } } }, { venue: { staffHiddenCards: { pastries: true } } });
      await user.click(sw('Pastries Hidden'));
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(source.setStaffCard).toHaveBeenCalledWith('pastries', false);
      expect(await screen.findByRole('switch', { name: 'Pastries Visible' })).toBeChecked();
    });
  });

  describe('while saving', () => {
    it('says «Saving…» in a live region that was there before, and turns every switch off', async () => {
      const { user, source } = await open({ session: { location: { staffHiddenCards: { pastries: true } } } });
      const status = card().getByRole('status');
      expect(status).toHaveTextContent('');
      let agree: (venue: Record<string, unknown>) => void = () => undefined;
      source.setStaffCard = vi.fn(() => new Promise<Record<string, unknown>>(done => { agree = done; }));

      await user.click(sw('Pastries Hidden'));
      expect(status).toHaveTextContent('Saving…');
      for (const item of screen.getAllByRole('switch')) expect(item).toBeDisabled();

      agree({});
      await waitFor(() => { expect(status).toHaveTextContent(''); });
      for (const item of screen.getAllByRole('switch')) expect(item).toBeEnabled();
    });

    it('keeps the focus on the switch that was pressed', async () => {
      const { user } = await open({ session: { location: { staffHiddenCards: { pastries: true } } } }, { venue: { staffHiddenCards: { pastries: true } } });
      await user.click(sw('Pastries Hidden'));
      await waitFor(() => { expect(screen.getByRole('switch', { name: 'Pastries Visible' })).toHaveFocus(); });
    });
  });

  describe('when it fails', () => {
    it('says it could not, puts the switch back, and the focus stays on it', async () => {
      const { user, source } = await open({ session: { location: { staffHiddenCards: { pastries: true } } } });
      source.functionsFailWith = Object.assign(new Error('denied'), { code: 'functions/permission-denied' });
      await user.click(sw('Pastries Hidden'));

      const notice = await screen.findByRole('alertdialog');
      expect(within(notice).getByText('Could not save the change. Check your connection and try again.')).toBeInTheDocument();
      await user.click(within(notice).getByRole('button', { name: 'OK' }));
      await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });

      expect(sw('Pastries Hidden')).not.toBeChecked();
      expect(sw('Pastries Hidden')).toBeEnabled();
      expect(card().getByRole('status')).toHaveTextContent('');
      await waitFor(() => { expect(sw('Pastries Hidden')).toHaveFocus(); });
    });

    // Driven 7 Nov 2026: the first call to a cold function outlived the phone's wait, the phone said «not saved» and the server
    // saved it all the same. After a failure the screen shows what the server holds.
    it('after a failure, shows what the server now holds (a save that landed after the phone stopped waiting)', async () => {
      const { user, source } = await open({ session: { location: {} } }, { venue: {} });
      source.functionsFailWith = Object.assign(new Error('timeout'), { code: 'functions/deadline-exceeded' });
      // The server already holds the change the phone is about to be told failed.
      source.venue = { staffHiddenCards: { pastries: true } };
      await user.click(sw('Pastries Visible'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hide it' }));

      await waitFor(() => { expect(screen.getByText('Could not save the change. Check your connection and try again.')).toBeInTheDocument(); });
      await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'OK' }));
      await waitFor(() => { expect(sw('Pastries Hidden')).not.toBeChecked(); });
    });
  });

  describe('what the screen starts from and keeps', () => {
    it('starts from the session’s copy at once, then follows the server’s answer', async () => {
      await open({ session: { location: {} } }, { venue: { staffHiddenCards: { pastries: true } } });
      await waitFor(() => { expect(sw('Pastries Hidden')).not.toBeChecked(); });
    });

    it('keeps the session’s copy when the server cannot be reached', async () => {
      const source = fakeSettingsSource({ venue: {} });
      source.offline = true;
      renderApp('/settings/sections', { session: { location: { staffHiddenCards: { pastries: true } } }, data: { settings: () => source } });
      await waitFor(() => { expect(source.readVenueFromServer).toHaveBeenCalled(); });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(sw('Pastries Hidden')).not.toBeChecked();
    });

    it('does not let a late first read overwrite a change just saved', async () => {
      const source = fakeSettingsSource({ venue: {} });
      let arrive: (venue: Record<string, unknown>) => void = () => undefined;
      source.readVenueFromServer = vi.fn(() => new Promise<Record<string, unknown>>(done => { arrive = done; }));
      const { user } = renderApp('/settings/sections', { session: { location: { staffHiddenCards: { pastries: true } } }, data: { settings: () => source } });
      await screen.findByRole('switch', { name: 'Pastries Hidden' });

      await user.click(screen.getByRole('switch', { name: 'Pastries Hidden' }));
      await screen.findByRole('switch', { name: 'Pastries Visible' });
      arrive({ staffHiddenCards: { pastries: true } });
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(sw('Pastries Visible')).toBeChecked();
    });

    it('keeps the server’s answer as its state: another change made elsewhere shows with the one just saved', async () => {
      const { user, source } = await open();
      source.setStaffCard = vi.fn(async () => ({ staffHiddenCards: { pastries: true, calculator: true } }));
      await user.click(sw('Pastries Visible'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hide it' }));
      expect(await screen.findByRole('switch', { name: 'Pastries Hidden' })).toBeInTheDocument();
      expect(sw('Calculator Hidden')).not.toBeChecked();
    });

    it('shows the change anyway when the save worked but the server could not be read straight after', async () => {
      const { user, source } = await open();
      source.setStaffCard = vi.fn(async () => null);
      await user.click(sw('Pastries Visible'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Hide it' }));
      expect(await screen.findByRole('switch', { name: 'Pastries Hidden' })).not.toBeChecked();
    });

    it('stores a money section as shown, not hidden, when the server could not be read', async () => {
      const { user, source } = await open();
      source.setStaffCard = vi.fn(async () => null);
      await user.click(sw('Food cost Hidden'));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Show it' }));
      expect(await screen.findByRole('switch', { name: 'Food cost Visible' })).toBeChecked();
    });

    it('reads the server again each time it is opened', async () => {
      const source = fakeSettingsSource();
      const { router, user } = renderApp('/settings/sections', { data: { settings: () => source } });
      await screen.findByRole('switch', { name: 'Pastries Visible' });
      expect(source.readVenueFromServer).toHaveBeenCalledTimes(1);
      await user.click(screen.getByRole('button', { name: 'Back' }));
      await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
      await user.click(await screen.findByRole('link', { name: 'Sections for employees' }));
      await screen.findByRole('switch', { name: 'Pastries Visible' });
      expect(source.readVenueFromServer).toHaveBeenCalledTimes(2);
    });
  });

  describe('who may open it', () => {
    it('sends an employee back to Settings', async () => {
      const { router } = renderApp('/settings/sections', { session: { role: 'staff', canManage: false, isOwner: false } });
      await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
    });

    it('lets a manager in', async () => {
      await open({ session: { role: 'manager', canManage: true, isOwner: false } });
      expect(screen.getAllByRole('switch')).toHaveLength(7);
    });
  });

  it('speaks Italian: the sections’ own names, the states and the question', async () => {
    const { user } = await open({ lang: 'it' });
    expect(screen.getByRole('switch', { name: 'Paste Visibile' })).toBeChecked();
    await user.click(screen.getByRole('switch', { name: 'Paste Visibile' }));
    expect(await screen.findByRole('alertdialog', { name: 'Nascondere «Paste» ai dipendenti?' })).toBeInTheDocument();
  });
});
