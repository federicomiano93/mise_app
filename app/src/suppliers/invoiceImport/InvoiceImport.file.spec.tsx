import { beforeAll, describe, expect, it } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { noVatKey } from '@mise/shared/invoice-zip/fatturapa';
import { decisionId, supplierDecisionKey } from '@mise/shared/invoice-zip/selection';
import { fakeSuppliersSource } from '../../testing/fakeSuppliersSource';
import { supplier } from '../../testing/renderSuppliers';
import { fakeImportSource } from './testing/fakeImportSource';
import {
  COLA, FLOUR, K_FLOUR, LOAD, SUPPLIER_VAT, chooseFiles, fileBox, findImportScreen, invoiceZip, renderImport, withBytes,
} from './testing/renderImport';

// «Import from invoices», part B3a: step 1, choose the file — the picker, the read, what the invoices held, and what is refused.
//
// PORTS (tests/invoice-import-flow.test.mjs): «a zip is read in the app: a summary, groups for what is left out, and NOTHING is
// written», «the file box is a label dressed as a button for one hidden input, and the chosen file name is shown», «ticking a
// product re-runs the selection at once…» (the selection half; the decision written BEFORE the rows is part B3b), «a remembered
// skip is listed, ticking "Import again" imports it…» (the listing and the tick; the DELETE of the decision is B3b), «the
// remembered decisions are read from the server: offline refuses the file, with a message», «a plan drawn before the lists have
// arrived is refused, not drawn with everything new» (its step-1 half), «one .json beside zips … a bad zip is a friendly error»
// (replaced by F6: the .json half is gone, see below).
// (tests/invoice-import-review.test.mjs): «6 · the picker is off and busy while a zip is read, and comes back on every way out»,
// «6 · after a read the focus goes to the result status line, else to the Next button».
// NOT PORTED, BY DECISION: «a file that is not an import file says what is wrong, in words» and «a .json file still takes the old
// path» (F6: the screen speaks only of the zip, and `.json` is not accepted).
// The zip-path tests that write rows, decisions and price changes are in InvoiceImport.run.spec.tsx (part B3b).

beforeAll(async () => {
  await import('../SuppliersSection');
  await import('./InvoiceImportScreen');
}, 60_000);

async function open(options: Parameters<typeof renderImport>[1] = {}) {
  const view = renderImport('/suppliers/import', options);
  const screenView = await findImportScreen(options.lang === 'it' ? 'Importa da fatture' : 'Import from invoices');
  return { ...view, ...screenView };
}

const resultLine = () => screen.getByText(/invoices? read/);

describe('the first step', () => {
  it('starts empty: the explanation, the picker, and no Next', async () => {
    const { within: inScreen } = await open();
    expect(inScreen.getByRole('heading', { level: 3, name: 'Choose the file' })).toBeInTheDocument();
    expect(inScreen.getByText('Step 1 of 3')).toBeInTheDocument();
    expect(inScreen.getByText(/Choose the zip of the invoices you downloaded from the Agenzia delle Entrate/)).toBeInTheDocument();
    expect(inScreen.getByText('Choose the file', { selector: 'label' })).toBeInTheDocument();
    expect(inScreen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(inScreen.queryByText(/Chosen file/)).not.toBeInTheDocument();
  });

  it('⚠️ F6: the screen speaks only of the zip — no .json in the words, none accepted', async () => {
    const { region } = await open();
    expect(region.textContent).not.toMatch(/json/i);
    expect(fileBox().accept).toBe('.zip,.xml,.p7m');
    expect(fileBox().multiple).toBe(true);
  });

  it('speaks Italian, with the same wording as the current app (minus the .json)', async () => {
    const { region } = await open({ lang: 'it' });
    expect(region).toHaveAccessibleName('Importa da fatture');
    expect(within(region).getByText(/Scegli lo zip delle fatture scaricato dall’Agenzia delle Entrate \(anche più di uno\)/)).toBeInTheDocument();
    expect(within(region).getByText('Scegli il file', { selector: 'label' })).toBeInTheDocument();
    expect(region.textContent).not.toMatch(/json/i);
  });

  it('the file box is a label dressed as a button for ONE input, and the chosen file name is shown', async () => {
    const { user } = await open();
    const input = fileBox();
    const label = screen.getByText('Choose the file', { selector: 'label' });
    expect(label).toHaveAttribute('for', input.id);
    expect(input).toHaveClass('visually-hidden');
    await chooseFiles(user, invoiceZip(undefined, undefined, 'fatture-ottobre.zip'));
    expect(screen.getByText('Chosen file: fatture-ottobre.zip')).toBeInTheDocument();
    expect(document.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(fileBox()).toBe(input);
  });

  it('⚠️ a zip is read in the app: a summary, groups for what is left out, and NOTHING is written', async () => {
    const { user, importing } = await open();
    await chooseFiles(user, invoiceZip());
    expect(screen.getByText('Chosen file: fatture.zip')).toBeInTheDocument();
    expect(resultLine()).toHaveTextContent('1 invoice read · 1 supplier found · 2 ingredients found');
    expect(screen.getByText('Packaging and resale (1)')).toBeInTheDocument();
    expect(screen.getByText(/COCA COLA LATTINA 33 CL/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Import as an ingredient' })).not.toBeChecked();
    expect(screen.queryByText(/Left out by you/)).not.toBeInTheDocument();
    expect(importing.writes).toEqual([]);
    // The log is read when the screen opens, and again — fresh — before the file is read; then the remembered decisions.
    expect(importing.calls.map(call => call[0])).toEqual(['loadImportLog', 'loadImportLog', 'loadDecisions']);
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it('the groups stay closed until opened, and the open ones are remembered across a redraw', async () => {
    const { user } = await open();
    await chooseFiles(user, invoiceZip());
    const group = screen.getByText('Packaging and resale (1)').closest('details');
    expect(group).not.toBeNull();
    expect(group).not.toHaveAttribute('open');
    await user.click(screen.getByText('Packaging and resale (1)'));
    await waitFor(() => { expect(group).toHaveAttribute('open'); });
    // A tick redraws the screen; the group stays open.
    await user.click(screen.getByRole('checkbox', { name: 'Import as an ingredient' }));
    expect(screen.getByText('Packaging and resale (1)').closest('details')).toHaveAttribute('open');
  });

  it('a loose .p7m is accepted, counted and not read; the facts line says so', async () => {
    const { user } = await open();
    const signed = withBytes(new File([new Uint8Array([1, 2, 3])], 'IT01234567890_00001.xml.p7m'), new Uint8Array([1, 2, 3]));
    await chooseFiles(user, invoiceZip(), signed);
    expect(screen.getByText(/1 signed \.p7m file not read: download the XML version/)).toBeInTheDocument();
    expect(screen.getByText('Chosen file: fatture.zip, IT01234567890_00001.xml.p7m')).toBeInTheDocument();
  });
});

describe('⚠️ ticking changes the selection at once, in memory', () => {
  it('a product put back is counted, and taken out again; nothing is written', async () => {
    const { user, importing } = await open();
    await chooseFiles(user, invoiceZip());
    await user.click(screen.getByRole('checkbox', { name: 'Import as an ingredient' }));
    expect(resultLine()).toHaveTextContent('3 ingredients found');
    expect(screen.getByRole('checkbox', { name: 'Import as an ingredient' })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Import as an ingredient' }));
    expect(resultLine()).toHaveTextContent('2 ingredients found');
    expect(importing.writes).toEqual([]);
    expect(importing.countOf('loadDecisions')).toBe(1);
  });

  it('a remembered skip is listed, and ticking «Import again» brings the product back', async () => {
    const importing = fakeImportSource({ decisions: [{ id: decisionId(K_FLOUR), decision: 'skip', label: 'Farina' }] });
    const { user } = await open({ importing });
    await chooseFiles(user, invoiceZip());
    expect(screen.getByText('Left out by you (1)')).toBeInTheDocument();
    expect(resultLine()).toHaveTextContent('1 ingredient found');
    await user.click(screen.getByRole('checkbox', { name: 'Import again' }));
    expect(resultLine()).toHaveTextContent('2 ingredients found');
    expect(importing.writes).toEqual([]);
  });

  it('a remembered skipped SUPPLIER is listed with its products, and ticking «Import again» brings them back', async () => {
    const importing = fakeImportSource({ decisions: [{ id: decisionId(supplierDecisionKey(SUPPLIER_VAT)), decision: 'skip', label: 'Fornitore' }] });
    const { user } = await open({ importing });
    await chooseFiles(user, invoiceZip());
    expect(screen.getByText('Suppliers left out by you (1)')).toBeInTheDocument();
    expect(screen.getByText('3 products')).toBeInTheDocument();
    expect(resultLine()).toHaveTextContent('0 ingredients found');
    await user.click(screen.getByRole('checkbox', { name: 'Import again' }));
    expect(resultLine()).toHaveTextContent('2 ingredients found');
  });

  it('a product that cannot be an ingredient says why, with no tick', async () => {
    const { user } = await open();
    const odd = { desc: 'PRODOTTO STRANO', code: 'ODD', qty: 3, unit: 'PZ', total: 9 };
    await chooseFiles(user, invoiceZip([FLOUR, odd]));
    const row = screen.getByRole('listitem', { name: 'Prodotto strano' });
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(within(row).getByText(/Sold by the piece/)).toBeInTheDocument();
    expect(screen.getByText('Products that could not be read (1)')).toBeInTheDocument();
  });

  it('a file the reader skipped is listed with the reason, in words', async () => {
    const { user } = await open();
    const broken = withBytes(new File([new Uint8Array([9, 9, 9, 9])], 'rotto.zip'), new Uint8Array([9, 9, 9, 9]));
    await chooseFiles(user, broken);
    expect(screen.getByText('Files not read (1)')).toBeInTheDocument();
    expect(screen.getByText('The zip could not be opened.')).toBeInTheDocument();
  });
});

describe('⚠️ the picker while a zip is read', () => {
  it('is off and busy, with «Reading the invoices…», and comes back on when the read is over', async () => {
    const importing = fakeImportSource();
    const release = importing.hold('loadDecisions');
    const { user } = await open({ importing });
    await user.upload(fileBox(), invoiceZip());
    await waitFor(() => { expect(fileBox()).toBeDisabled(); });
    expect(fileBox()).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Reading the invoices…', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    release();
    await waitFor(() => { expect(fileBox()).toBeEnabled(); });
    expect(fileBox()).not.toHaveAttribute('aria-busy');
    expect(screen.queryByText('Reading the invoices…')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
  });

  it.each([
    ['the remembered decisions cannot be loaded', async (importing: ReturnType<typeof fakeImportSource>) => { importing.failWith('loadDecisions', 'offline'); return invoiceZip(); }],
    ['the file cannot be read at all', () => Promise.resolve(Object.defineProperty(new File([new Uint8Array([1])], 'x.zip'), 'arrayBuffer', {
      value: () => Promise.reject(new Error('disk')),
    }))],
  ])('comes back on when %s', async (_why, make) => {
    const importing = fakeImportSource();
    const file = await make(importing);
    const { user } = await open({ importing });
    await chooseFiles(user, file);
    expect(fileBox()).toBeEnabled();
    expect(fileBox()).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('after a read the focus goes to the next thing to do', () => {
  it('the result line when the invoices were read', async () => {
    const { user } = await open();
    await chooseFiles(user, invoiceZip());
    await waitFor(() => { expect(resultLine()).toHaveFocus(); });
    expect(resultLine()).toHaveAttribute('role', 'status');
    expect(resultLine()).toHaveAttribute('tabindex', '-1');
  });

  it('the red line when they could not be', async () => {
    const importing = fakeImportSource();
    importing.failWith('loadDecisions', 'offline');
    const { user } = await open({ importing });
    await chooseFiles(user, invoiceZip());
    await waitFor(() => { expect(screen.getByRole('alert')).toHaveFocus(); });
    expect(screen.getByRole('alert')).toHaveAttribute('tabindex', '-1');
  });
});

describe('⚠️ the venue’s id is the salt of a supplier without a VAT number', () => {
  const TAX_CODE = 'RSSMRA80A01H501U';
  const NAME = 'FORNITORE SENZA PARTITA IVA';
  const remembered = (venue: string) => fakeImportSource({
    decisions: [{ id: decisionId(supplierDecisionKey(noVatKey(TAX_CODE, NAME, venue))), decision: 'skip', label: NAME }],
  });

  it('a supplier remembered under the key of THIS venue is recognised, so the key was salted with the venue id', async () => {
    const { user } = await open({ importing: remembered('bakery') });
    await chooseFiles(user, invoiceZip([FLOUR], { vat: '', taxCode: TAX_CODE, name: NAME }));
    expect(screen.getByText('Suppliers left out by you (1)')).toBeInTheDocument();
  });

  it('and one remembered under another venue’s key (or the empty salt) is not', async () => {
    for (const venue of ['panificio-miano', '']) {
      const { user } = await open({ importing: remembered(venue) });
      await chooseFiles(user, invoiceZip([FLOUR], { vat: '', taxCode: TAX_CODE, name: NAME }));
      expect(screen.queryByText(/Suppliers left out by you/)).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('what is refused, in words', () => {
  it('a file the reader cannot even open: the one friendly message, nothing read, nothing offered', async () => {
    const { user, importing } = await open();
    const unreadable = Object.defineProperty(new File([new Uint8Array([1])], 'x.zip'), 'arrayBuffer', {
      value: () => Promise.reject(new Error('disk')),
    });
    await chooseFiles(user, unreadable);
    expect(screen.getByRole('alert')).toHaveTextContent('The invoices could not be read. Choose the zip you downloaded from the Agenzia delle Entrate.');
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(importing.calls.map(call => call[0])).toEqual(['loadImportLog', 'loadImportLog']);
  });

  it.each([
    ['offline', 'There is no connection. The import stopped: load the same file again when you are online.'],
    ['timeout', 'There is no connection. The import stopped: load the same file again when you are online.'],
    ['permission-denied', 'Mise was not allowed to save this: your account may not change prices here. The import stopped.'],
    ['internal', 'Your remembered choices could not be loaded. Check your connection and try again.'],
  ])('⚠️ the remembered decisions are read from the server: %s refuses the file, with a message', async (code, words) => {
    const importing = fakeImportSource();
    importing.failWith('loadDecisions', code);
    const { user } = await open({ importing });
    await chooseFiles(user, invoiceZip());
    expect(screen.getByRole('alert')).toHaveTextContent(words);
    expect(screen.queryByText(/ingredients? found/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Next' }), 'no way on without the decisions').not.toBeInTheDocument();
  });

  it('a second file replaces the first: the old result and the old error are gone', async () => {
    const importing = fakeImportSource();
    importing.failWith('loadDecisions', 'offline');
    const { user } = await open({ importing });
    await chooseFiles(user, invoiceZip());
    expect(screen.getByRole('alert')).toBeInTheDocument();
    importing.failWith('loadDecisions', null);
    await chooseFiles(user, invoiceZip([COLA, FLOUR], {}, 'altro.zip'));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Chosen file: altro.zip')).toBeInTheDocument();
    expect(resultLine()).toHaveTextContent('1 invoice read');
  });
});

describe('«Next» waits for the lists', () => {
  it('⚠️ is refused with «still loading» until the suppliers, the ingredients and the prices came from the SERVER', async () => {
    const suppliers = fakeSuppliersSource({ suppliers: [supplier('s-1', { name: 'Alpine' })] });
    suppliers.fromCache = true;
    const { user } = await open({ suppliers });
    await chooseFiles(user, invoiceZip());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Your suppliers and ingredients are still loading. Try again in a moment.');
    expect(screen.getByRole('heading', { level: 3, name: 'Choose the file' })).toBeInTheDocument();
    expect(screen.getByText('Step 1 of 3')).toBeInTheDocument();
    // The server speaks: the refusal goes by itself, and Next goes on.
    suppliers.fromCache = false;
    suppliers.push();
    await waitFor(() => { expect(screen.queryByRole('alert')).not.toBeInTheDocument(); });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Suppliers' })).toBeInTheDocument();
  });

  it('⚠️ an EMPTY venue is not «loading» for ever: the server saying «nothing» is an answer', async () => {
    const { user } = await open({ suppliers: fakeSuppliersSource() });
    await chooseFiles(user, invoiceZip());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByRole('heading', { level: 3, name: 'Suppliers' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(/still loading/)).not.toBeInTheDocument();
  });

  it('prices that came only from the browser\'s own database are not enough', async () => {
    const suppliers = fakeSuppliersSource();
    suppliers.pricesFromCache = true;
    const { user } = await open({ suppliers });
    await chooseFiles(user, invoiceZip());
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('alert')).toHaveTextContent('still loading');
  });
});
