import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import { LOAD, configOf, renderCalculator } from '../testing/renderCalculator';

// The owner of the kitchen has no clients to run (worksOnClients, the list of worksOnClientsAs in firestore.rules):
// the three client doors are not drawn for them and their addresses send them back to the Settings hub. The two
// venue switches stay — they are the venue's own.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { window.localStorage.clear(); });

const main = () => within(screen.getByRole('main'));
const KITCHEN = { role: 'owner-kitchen', canManage: true, canManageVenue: false, isOwner: false } as const;
const SALES = { role: 'owner-sales', canManage: true, canManageVenue: false, isOwner: false } as const;

async function hub(session: Record<string, unknown>, path = '/calculator/settings') {
  const view = renderCalculator(path, { source: fakeCalculatorSource({ config: configOf() }), session });
  await main().findByRole('heading', { level: 2 }, LOAD);
  return view;
}

describe('the kitchen owner’s Calculator settings', () => {
  it('draws no Clients, WhatsApp or Client ordering door, and keeps the rest', async () => {
    await hub(KITCHEN);
    for (const name of [/^Clients/, /^WhatsApp/, /^Client ordering/]) {
      expect(main().queryByRole('button', { name })).not.toBeInTheDocument();
    }
    for (const name of [/^Recipes/, /^Extra dough/, /^Divisor/, /^Dough history/]) {
      expect(main().getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('keeps the two switches of the venue under the heading the doors would have had', async () => {
    await hub(KITCHEN);
    expect(main().getByRole('switch', { name: 'Show the Orders button' })).toBeInTheDocument();
    expect(main().getByRole('switch', { name: 'Ask which day the dough is for' })).toBeInTheDocument();
  });

  it.each([
    ['clients', '/calculator/settings/clients'],
    ['whatsapp', '/calculator/settings/whatsapp'],
    ['ordering', '/calculator/settings/ordering'],
  ])('replaces the %s address with the hub', async (_screen, path) => {
    const { router } = renderCalculator(path, { source: fakeCalculatorSource({ config: configOf() }), session: KITCHEN });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/calculator/settings'); }, LOAD);
    expect(router.state.historyAction).toBe('REPLACE');
    await main().findByRole('switch', { name: 'Show the Orders button' }, LOAD);
  });

  it('leaves every other role its doors', async () => {
    await hub({ role: 'owner', canManage: true, isOwner: true });
    expect(main().getByRole('button', { name: /^Clients/ })).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^WhatsApp/ })).toBeInTheDocument();
    expect(main().getByRole('button', { name: /^Client ordering/ })).toBeInTheDocument();
  });

  it('does not touch the sales owner’s role answer: worksOnClients is true for them', async () => {
    // The sales owner has no Calculator section at all (it is not on their rail), so the screen is not drawn for them;
    // what matters here is that the rule is the kitchen's alone.
    const { worksOnClients } = await import('@mise/shared/membership');
    expect(worksOnClients(SALES.role)).toBe(true);
    expect(worksOnClients(KITCHEN.role)).toBe(false);
  });
});
