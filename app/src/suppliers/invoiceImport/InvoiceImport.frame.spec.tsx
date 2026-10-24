import { beforeAll, describe, expect, it } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../../session/busy';
import { chooseFiles, findImportScreen, invoiceZip, renderImport, toSuppliers, LOAD } from './testing/renderImport';

// «Import from invoices», part B3a: the frame — the step count, Back and the question «Leave the import?», every way out of the
// screen, the polite live region, the focus and the scroll after a step. (Parity I7, I83, I84, I98.)
//
// PORTS (tests/invoice-import-flow.test.mjs): «Back closes at once before a file is loaded, and asks (danger) once there is one»,
// «the screen is a modal dialog named by its title, and focus goes back to the button that opened it» (a region named by its title
// now; the focus goes back to the Import door — in the door spec), «while rows are being written Back is off and does nothing» (the
// suppliers' write is in the suppliers spec; the rows' is B3b). (tests/invoice-import-screen.test.mjs): «leaving asks first
// (danger), is off while writing, and nothing is written before a confirmation», «accessibility: real controls, chips with
// aria-pressed, a live region, focus on the heading» (the chips are step 3's).
// NEW: the router's blocker (the browser's Back and the rail), which the original did not need — it was an overlay.

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

const FROM_THE_LIST = [{ pathname: '/suppliers' }, { pathname: '/suppliers/import', state: { keepFocus: true, fromList: true } }];

async function open(options: Parameters<typeof renderImport>[1] = {}) {
  const view = renderImport('/suppliers/import', options);
  const screenView = await findImportScreen(options.lang === 'it' ? 'Importa da fatture' : 'Import from invoices');
  return { ...view, ...screenView };
}

const leaveDialog = () => screen.findByRole('alertdialog', { name: 'Leave the import?' });

describe('Back', () => {
  it('closes at once before a file is loaded: nothing to lose, nothing asked', async () => {
    const { user, router } = await open({ entries: FROM_THE_LIST });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('⚠️ asks (in danger words) once there is a file; Cancel keeps the screen, Leave goes, and nothing was written', async () => {
    const { user, router, importing } = await open({ entries: FROM_THE_LIST });
    await chooseFiles(user, invoiceZip());
    await user.click(screen.getByRole('button', { name: 'Back' }));
    let dialog = await leaveDialog();
    expect(within(dialog).getByText('What is already saved stays. The rest of this file will not be imported; you can load it again later.')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Leave' }).className).toContain('danger');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(screen.getByText('Chosen file: fatture.zip')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back' }));
    dialog = await leaveDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(importing.writes).toEqual([]);
  });

  it('still asks on the suppliers step, and in Italian', async () => {
    const { user } = await open({ entries: FROM_THE_LIST, lang: 'it' });
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, invoiceZip());
    await user.click(await screen.findByRole('button', { name: 'Avanti' }, LOAD));
    await screen.findByRole('heading', { level: 3, name: 'Fornitori' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Indietro' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Uscire dall’importazione?' });
    expect(within(dialog).getByRole('button', { name: 'Esci' })).toBeInTheDocument();
  });

  it('a file that failed to read is nothing to lose: Back closes at once', async () => {
    const { user, router, importing } = await open({ entries: FROM_THE_LIST });
    importing.failWith('loadDecisions', 'offline');
    await chooseFiles(user, invoiceZip());
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('⚠️ every other way out asks too', () => {
  it('the browser\'s Back, once a file is loaded', async () => {
    const { user, router } = await open({ entries: FROM_THE_LIST });
    await chooseFiles(user, invoiceZip());
    await act(async () => { await router.navigate(-1); });
    let dialog = await leaveDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/import');
    expect(screen.getByText('Chosen file: fatture.zip')).toBeInTheDocument();

    await act(async () => { await router.navigate(-1); });
    dialog = await leaveDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Leave' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
  });

  it('the rail, once a file is loaded', async () => {
    const { user, router } = await open({ entries: FROM_THE_LIST });
    await chooseFiles(user, invoiceZip());
    const rail = screen.getAllByRole('navigation', { name: 'All sections' })[0] as HTMLElement;
    await user.click(within(rail).getByRole('link', { name: 'Orders' }));
    const dialog = await leaveDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(router.state.location.pathname).toBe('/suppliers/import');
  });

  it('nothing is asked when no file is loaded', async () => {
    const { router } = await open({ entries: FROM_THE_LIST });
    await act(async () => { await router.navigate('/orders'); });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/orders'); });
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('the frame', () => {
  it('has one h1 (the section), a region named by the screen\'s title, and a live region that is there before it speaks', async () => {
    const { region } = await open();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(region).toHaveAccessibleName('Import from invoices');
    const live = within(region).getAllByRole('status').find(node => node.classList.contains('visually-hidden'));
    expect(live).toBeDefined();
    expect(live).toBeEmptyDOMElement();
  });

  it('the live region says «Reading the invoices…» while it reads and is empty again afterwards', async () => {
    const { user, importing, region } = await open();
    const release = importing.hold('loadDecisions');
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, invoiceZip());
    const live = within(region).getAllByRole('status').find(node => node.classList.contains('visually-hidden')) as HTMLElement;
    await waitFor(() => { expect(live).toHaveTextContent('Reading the invoices…'); });
    release();
    await waitFor(() => { expect(live).toBeEmptyDOMElement(); });
  });

  it('⚠️ holds the app\'s busy marker while a file is loaded, so a reload by itself cannot throw the import away', async () => {
    const { user, router } = await open({ entries: FROM_THE_LIST });
    await waitFor(() => { expect(isBusy()).toBe(false); });
    await chooseFiles(user, invoiceZip());
    await waitFor(() => { expect(isBusy()).toBe(true); });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await user.click(within(await leaveDialog()).getByRole('button', { name: 'Leave' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/suppliers'); });
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('after a step the page is at the top and the step\'s heading has the focus', async () => {
    const { user } = await open();
    await chooseFiles(user, invoiceZip());
    const main = screen.getByRole('main');
    Object.defineProperty(main, 'scrollTop', { value: 640, writable: true });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { level: 3, name: 'Suppliers' }, LOAD);
    await waitFor(() => { expect(main.scrollTop).toBe(0); });
    expect(screen.getByRole('heading', { level: 3, name: 'Suppliers' })).toHaveFocus();

    Object.defineProperty(main, 'scrollTop', { value: 300, writable: true });
    await user.click(screen.getByRole('button', { name: 'Save 1 supplier' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save these suppliers?' })).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    await waitFor(() => { expect(main.scrollTop).toBe(0); });
    expect(screen.getByRole('heading', { level: 3, name: 'Ingredients' })).toHaveFocus();
    expect(screen.getByText('Step 3 of 3')).toBeInTheDocument();
  });

  it('step 3 is the hand-over to part B3b: its heading and nothing else yet, and Back still asks', async () => {
    const { user } = await open();
    await toSuppliers(user);
    await user.click(screen.getByRole('button', { name: 'Save 1 supplier' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save these suppliers?' })).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { level: 3, name: 'Ingredients' }, LOAD);
    expect(screen.queryByRole('button', { name: /^(Next|Save)/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(await leaveDialog()).toBeInTheDocument();
  });
});
