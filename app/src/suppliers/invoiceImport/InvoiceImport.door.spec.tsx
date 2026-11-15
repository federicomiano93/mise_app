import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { split } from '../../testing/renderSuppliers';
import { LOAD, findImportScreen, renderImport } from './testing/renderImport';

// «Import from invoices», part B3a: the door and the address — who sees the door, who is sent back, how it opens and how Back
// returns. (Decision F3 (b): only an Italian venue; parity I1, I2, I4.)
//
// PORTS (tests/invoice-import-screen.test.mjs): «the button is in the bottom bar, hidden until the session says the person may
// use it», «the button is gated on the role AND the Food cost section». The bottom bar is gone (the door sits beside Settings);
// the country is new (F3). The gate is the same function for the door and the address, so both are specced for each case.

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const IT = { country: 'IT' };
const EMPLOYEE = { canManage: false, role: 'staff', isOwner: false } as const;

// Everybody who must NOT have the door, and why.
const NOT_ALLOWED = [
  ['an employee', { ...EMPLOYEE, location: IT }],
  ['an employee of a venue with Food cost off', { ...EMPLOYEE, location: { ...IT, sections: { foodcost: false } } }],
  ['an owner of a venue with Food cost off', { location: { ...IT, sections: { foodcost: false } } }],
  ['an owner in the United Kingdom', { location: { country: 'GB' } }],
  ['an owner of a venue that names no country', { location: {} }],
  ['an owner of a venue with an unknown country', { location: { country: 'FR' } }],
] as const;

describe('the door', () => {
  it('⚠️ is beside the Settings door for an owner of an Italian venue with Food cost on, and says what it is', async () => {
    renderImport('/suppliers');
    const door = await screen.findByRole('button', { name: 'Import from invoices' }, LOAD);
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(door.parentElement).toBe(screen.getByRole('button', { name: 'Settings' }).parentElement);
  });

  it('a manager has it too', async () => {
    renderImport('/suppliers', { session: { role: 'manager', isOwner: false, location: IT } });
    expect(await screen.findByRole('button', { name: 'Import from invoices' }, LOAD)).toBeInTheDocument();
  });

  it('speaks Italian in an Italian interface', async () => {
    renderImport('/suppliers', { lang: 'it' });
    expect(await screen.findByRole('button', { name: 'Importa da fatture' }, LOAD)).toBeInTheDocument();
  });

  it.each(NOT_ALLOWED)('⚠️ is not drawn for %s', async (_who, session) => {
    renderImport('/suppliers', { session });
    await screen.findByRole('tab', { name: 'Packaging' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Import from invoices' })).not.toBeInTheDocument();
  });
});

describe('the address', () => {
  it.each(NOT_ALLOWED)('⚠️ %s who types it is sent to the list (replaced), and nothing of the screen is drawn', async (_who, session) => {
    const { router } = renderImport('/suppliers/import', { session });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('region', { name: 'Import from invoices' })).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it('opens for an owner of an Italian venue, with the usage name of its own', async () => {
    const { router } = renderImport('/suppliers/import');
    const { within: inScreen } = await findImportScreen();
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(inScreen.getByRole('heading', { level: 2, name: 'Import from invoices' })).toBeInTheDocument();
  });
});

describe('opening and leaving', () => {
  it.each([['a phone', false], ['the split', true]])('opens one level down and FULL WIDTH on %s, with the focus on its title', async (_where, onSplit) => {
    if (onSplit) split();
    const { router, user } = renderImport('/suppliers/suppliers');
    await user.click(await screen.findByRole('button', { name: 'Import from invoices' }, LOAD));
    const { region, within: inScreen } = await findImportScreen();
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(router.state.historyAction).toBe('PUSH');
    expect(region.closest('[data-view]')).toHaveAttribute('data-view', 'wide');
    await waitFor(() => { expect(inScreen.getByRole('heading', { level: 2, name: 'Import from invoices' })).toHaveFocus(); });
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('Back returns to the list it came from, with the focus on the Import door', async () => {
    const { router, user } = renderImport('/suppliers/suppliers');
    await user.click(await screen.findByRole('button', { name: 'Import from invoices' }, LOAD));
    const { within: inScreen } = await findImportScreen();
    await user.click(inScreen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers/suppliers'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Import from invoices' })).toHaveFocus(); });
  });

  it('opened by its address, Back replaces it with the list', async () => {
    const { router, user } = renderImport('/suppliers/import');
    const { within: inScreen } = await findImportScreen();
    await user.click(inScreen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('marks the door as the current one while the screen is open (the list is behind it)', async () => {
    const { user } = renderImport('/suppliers');
    await user.click(await screen.findByRole('button', { name: 'Import from invoices' }, LOAD));
    await findImportScreen();
    expect(screen.getByRole('button', { name: 'Import from invoices', hidden: true })).toHaveAttribute('aria-current', 'true');
  });
});
