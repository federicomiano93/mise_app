import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';
import { markBusy } from '../session/busy';
import { pageReload } from './pageReload';

const main = () => within(screen.getByRole('main'));
// The screen’s own card: the page has other live regions (the connection notice).
const card = () => within(screen.getByRole('heading', { level: 2, name: /App language|Lingua dell’app/ }).closest('section') as HTMLElement);
const UK = { location: { country: 'GB' } };
const ITALY = { location: { country: 'IT' } };
const NO_COUNTRY = { location: {} };

let reload: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  reload = vi.spyOn(pageReload, 'reload').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

async function open(options: NonNullable<Parameters<typeof renderApp>[1]> = {}) {
  const source: FakeSettingsSource = fakeSettingsSource();
  const view = renderApp('/settings/language', { session: UK, ...options, data: { settings: () => source } });
  await screen.findByRole('heading', { level: 2, name: options.lang === 'it' ? 'Lingua dell’app' : 'App language' });
  return { ...view, source };
}

describe('App language', () => {
  it('has one h1 (Settings), the screen’s name as its title and the intro', async () => {
    await open();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    expect(main().getByText('The language everybody who works here reads on screen.')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
  });

  it('opens on its title; opened by its address, Back REPLACES it with Settings (no history pile)', async () => {
    const { router, user } = await open();
    await waitFor(() => { expect(main().getByRole('heading', { level: 2, name: 'App language' })).toHaveFocus(); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => { expect(main().getByRole('link', { name: 'App language' })).toHaveFocus(); });
  });

  it('opened from Settings, Back is the browser’s Back (POP) and so is the browser’s own Back; both hand the focus to the door', async () => {
    const { router, user } = renderApp('/settings');
    await user.click(main().getByRole('link', { name: 'App language' }));
    expect(router.state.historyAction).toBe('PUSH');
    await user.click(await screen.findByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => { expect(main().getByRole('link', { name: 'App language' })).toHaveFocus(); });

    // The phone’s back gesture runs no code of the screen it leaves: the focus was promised when the screen opened.
    await user.click(main().getByRole('link', { name: 'Sections for employees' }));
    await screen.findByRole('button', { name: 'Back' });
    await act(async () => { await router.navigate(-1); });
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => { expect(main().getByRole('link', { name: 'Sections for employees' })).toHaveFocus(); });
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('names each language in itself, in either interface language', async () => {
    await open({ lang: 'it' });
    expect(main().getByText('English')).toBeInTheDocument();
    expect(main().getByText('Italiano')).toBeInTheDocument();
    expect(main().queryByText('Italian')).not.toBeInTheDocument();
  });

  it('marks the language in use as pressed and disabled, and offers the other', async () => {
    await open();
    const inUse = main().getByRole('button', { name: 'In use' });
    expect(inUse).toHaveAttribute('aria-pressed', 'true');
    expect(inUse).toBeDisabled();
    const other = main().getByRole('button', { name: 'Use this' });
    expect(other).toHaveAttribute('aria-pressed', 'false');
    expect(other).toBeEnabled();
  });

  it('marks Italian in use when the interface is Italian', async () => {
    await open({ lang: 'it' });
    expect(main().getByRole('button', { name: 'In uso' })).toBeDisabled();
    expect(main().getByRole('button', { name: 'Usa questa' })).toBeEnabled();
  });

  it('changes the language with the server first, then reloads — and says «Saving…» meanwhile, with every button off', async () => {
    const { user, source } = await open();
    let finish: () => void = () => undefined;
    source.setLanguage = vi.fn(() => new Promise<void>(done => { finish = done; }));
    const status = card().getByRole('status');
    expect(status).toHaveTextContent('');

    await user.click(main().getByRole('button', { name: 'Use this' }));
    expect(source.setLanguage).toHaveBeenCalledWith('it');
    expect(status).toHaveTextContent('Saving…');
    expect(main().getByRole('button', { name: 'In use' })).toBeDisabled();
    expect(main().getByRole('button', { name: 'Use this' })).toBeDisabled();
    // The icon-only Back is found by its name, and is off too: leaving would not undo the save in the air.
    expect(main().getByRole('button', { name: 'Back' })).toBeDisabled();
    // The phone has not heard of the change yet: a reload now would read the old venue.
    expect(reload).not.toHaveBeenCalled();

    finish();
    await waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
  });

  it('says it could not and does not reload when the change is refused, offline or past the timeout', async () => {
    const { user, source } = await open();
    source.functionsFailWith = Object.assign(new Error('denied'), { code: 'functions/permission-denied' });
    await user.click(main().getByRole('button', { name: 'Use this' }));

    const notice = await screen.findByRole('alertdialog');
    expect(within(notice).getByText('Could not change the language. Check your connection and try again.')).toBeInTheDocument();
    await user.click(within(notice).getByRole('button', { name: 'OK' }));
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });

    expect(reload).not.toHaveBeenCalled();
    expect(main().getByRole('button', { name: 'Use this' })).toBeEnabled();
    expect(main().getByRole('button', { name: 'Back' })).toBeEnabled();
    expect(card().getByRole('status')).toHaveTextContent('');
    // The button that was pressed gets the focus back once it is enabled again.
    await waitFor(() => { expect(main().getByRole('button', { name: 'Use this' })).toHaveFocus(); });
  });

  describe('the reload never throws away typing', () => {
    afterEach(() => { pageReload.retryMs = 5_000; });

    it('waits while an editor holds the busy marker, then reloads once it is released', async () => {
      pageReload.retryMs = 20;
      const { user } = await open();
      const release = markBusy();
      await user.click(main().getByRole('button', { name: 'Use this' }));
      await new Promise(resolve => setTimeout(resolve, 120));
      expect(reload).not.toHaveBeenCalled();
      release();
      await waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
    });

    it('also waits for the reload that follows a failure the server turned out to have saved', async () => {
      pageReload.retryMs = 20;
      const { user, source } = await open();
      source.functionsFailWith = new Error('timeout');
      source.venue = { ...(source.venue ?? {}), language: 'it' };
      const release = markBusy();
      await user.click(main().getByRole('button', { name: 'Use this' }));
      await new Promise(resolve => setTimeout(resolve, 120));
      expect(reload).not.toHaveBeenCalled();
      release();
      await waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
    });

    it('reads the venue into the session before it reloads', async () => {
      const { user, store } = await open();
      await user.click(main().getByRole('button', { name: 'Use this' }));
      await waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
      expect(store.refreshLocation).toHaveBeenCalledTimes(1);
      expect(store.refreshLocation.mock.invocationCallOrder[0]).toBeLessThan(reload.mock.invocationCallOrder[0] ?? 0);
    });
  });

  // Driven 7 Nov 2026: a cold function outlived the phone's wait and saved all the same.
  it('reloads after all when the call failed but the server now holds the chosen language', async () => {
    const { user, source } = await open();
    source.functionsFailWith = Object.assign(new Error('timeout'), { code: 'functions/deadline-exceeded' });
    source.venue = { ...(source.venue ?? {}), language: 'it' };
    await user.click(main().getByRole('button', { name: 'Use this' }));
    await waitFor(() => { expect(reload).toHaveBeenCalledTimes(1); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  describe('the sentence about the labels', () => {
    it('names the language and the country of a venue in the United Kingdom', async () => {
      await open({ session: UK });
      expect(main().getByText(
        'Allergen labels are not affected: they are printed in English, because this business sells in the United Kingdom. '
        + 'The law asks for a label in the language of the country where the food is sold.',
      )).toBeInTheDocument();
    });

    it('names Italian and Italy for a venue in Italy, whatever the interface says', async () => {
      await open({ session: ITALY });
      expect(main().getByText(/they are printed in Italian, because this business sells in Italy\./)).toBeInTheDocument();
    });

    it('is in the words of the interface: «inglese» and «nel Regno Unito» on the Italian screen', async () => {
      await open({ lang: 'it', session: UK });
      expect(main().getByText(/sono prodotte in inglese, perché questa attività vende nel Regno Unito\./)).toBeInTheDocument();
    });

    it('says plainly that a venue with no country prints no label at all', async () => {
      await open({ session: NO_COUNTRY });
      expect(main().getByText(/This business has no country set, so it cannot print an allergen label at all\./)).toBeInTheDocument();
    });

    it('is there while the change is saving, and after a failure', async () => {
      const { user, source } = await open();
      source.functionsFailWith = new Error('offline');
      await user.click(main().getByRole('button', { name: 'Use this' }));
      await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'OK' }));
      expect(main().getByText(/printed in English/)).toBeInTheDocument();
    });
  });

  describe('who may open it', () => {
    it('lets a manager in (a head chef is a manager)', async () => {
      await open({ session: { ...UK, role: 'manager', canManage: true, isOwner: false } });
      expect(main().getByRole('button', { name: 'In use' })).toBeInTheDocument();
    });

    it('sends an employee back to Settings, whose page does not offer it', async () => {
      const { router } = renderApp('/settings/language', { session: { role: 'staff', canManage: false, isOwner: false } });
      await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
      expect(main().queryByRole('link', { name: 'App language' })).not.toBeInTheDocument();
      expect(router.state.historyAction).toBe('REPLACE');
    });

    it('sends any other address under Settings back to the page', async () => {
      const { router } = renderApp('/settings/people');
      await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
    });
  });
});
