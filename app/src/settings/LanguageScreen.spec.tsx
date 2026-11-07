import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSettingsSource } from '../testing/fakeSettingsSource';
import type { FakeSettingsSource } from '../testing/fakeSettingsSource';
import { renderApp } from '../testing/renderApp';
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

  it('opens on its title, and Back goes up one level to Settings', async () => {
    const { router, user } = await open();
    await waitFor(() => { expect(main().getByRole('heading', { level: 2, name: 'App language' })).toHaveFocus(); });
    await user.click(main().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/settings'); });
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
    for (const button of main().getAllByRole('button', { name: /In use|Use this|Back/ })) {
      if (button.textContent !== '') expect(button).toBeDisabled();
    }
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
    expect(card().getByRole('status')).toHaveTextContent('');
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
