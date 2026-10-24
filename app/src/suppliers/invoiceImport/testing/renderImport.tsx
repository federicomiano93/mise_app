// renderImport.tsx — draws the real app at «Import from invoices», for the screen's specs (specs only): an Italian venue whose owner
// may write prices, a fake «server» behind the import (fakeImportSource) and a fake database behind the section (fakeSuppliersSource).
// Plus the invented invoice zips the specs choose. Invented names, VAT numbers and invoice ids only.

import { zipSync, strToU8 } from 'fflate';
import { expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';
import { invoiceXml, metadataXml } from '@mise/shared/invoice-zip/testing/invoice-builders';
import type { InvoiceSpec, LineSpec } from '@mise/shared/invoice-zip/testing/invoice-builders';
import { fakeSuppliersSource } from '../../../testing/fakeSuppliersSource';
import type { FakeSuppliersSource } from '../../../testing/fakeSuppliersSource';
import { renderApp } from '../../../testing/renderApp';
import { LOAD } from '../../../testing/renderSuppliers';
import { fakeImportSource } from './fakeImportSource';
import type { FakeImportSource } from './fakeImportSource';

export { LOAD };

// The venue is in Italy and the person owns it: the door and the address are open.
export const ITALY = { location: { country: 'IT' } } as const;

type Options = NonNullable<Parameters<typeof renderApp>[1]> & {
  // What the section's store holds (the venue's suppliers and ingredients) and what «the server» answers to the import.
  suppliers?: FakeSuppliersSource;
  importing?: FakeImportSource;
};

export function renderImport(path = '/suppliers/import', { suppliers, importing, session = ITALY, ...options }: Options = {}) {
  const source = suppliers ?? fakeSuppliersSource();
  const serverSide = importing ?? fakeImportSource({ suppliers: [...source.suppliers.values()] });
  const view = renderApp(path, { ...options, session, data: { suppliers: () => source, invoiceImport: () => serverSide, ...options.data } });
  return { ...view, source, importing: serverSide };
}

// The screen, once its code has loaded.
export async function findImportScreen(name = 'Import from invoices') {
  const region = await screen.findByRole('region', { name }, LOAD);
  return { region, within: within(region) };
}

// ── Invented invoices ───────────────────────────────────────────────────────────────────────────────

export const FLOUR: LineSpec = { desc: 'FARINA TIPO 00 SACCO KG 25', code: 'F00', qty: 25, unit: 'KG', total: 14.25 };
export const COLA: LineSpec = { desc: 'COCA COLA LATTINA 33 CL', code: 'COLA', qty: 24, unit: 'PZ', total: 12 };
export const STRONG: LineSpec = { desc: 'SPEZIA FORTE', code: 'SP', qty: 100, unit: 'KG', total: 4 };
export const K_FLOUR = 'IT00000000001|code:F00';
export const K_COLA = 'IT00000000001|code:COLA';
export const SUPPLIER_VAT = 'IT00000000001';
export const SUPPLIER_NAME = 'FORNITORE ESEMPIO SRL';

// A zip with one invoice (and its SdI metadata file), the way the Agenzia delle Entrate hands them out.
export function invoiceZip(
  lines: readonly LineSpec[] = [FLOUR, COLA, STRONG], spec: InvoiceSpec = {}, name = 'fatture.zip', sdi = '9000000001',
): File {
  const members = { 'inv1.xml': invoiceXml(lines, spec), 'inv1_MT_001.xml': metadataXml(sdi) };
  // ⚠️ Uint8Array.from: strToU8 answers with the TextEncoder's array, which jsdom's realm does not recognise as bytes (fflate would
  // read it as a folder).
  const bytes = zipSync(Object.fromEntries(Object.entries(members).map(([member, xml]) => [member, Uint8Array.from(strToU8(xml))])));
  return withBytes(new File([bytes.slice().buffer], name, { type: 'application/zip' }), bytes);
}

// jsdom's File cannot always hand its bytes back; this one always can.
export function withBytes(file: File, bytes: Uint8Array): File {
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(bytes.slice().buffer),
  });
  return file;
}

// ── Driving the screen ──────────────────────────────────────────────────────────────────────────────

// The one file box of step 1.
export const fileBox = (): HTMLInputElement => {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error('There is no file box on the screen.');
  return input;
};

// Chooses the files and waits until the read is over (the picker is back on).
export async function chooseFiles(user: UserEvent, ...files: File[]): Promise<void> {
  await user.upload(fileBox(), files);
  await waitFor(() => { expect(fileBox()).toBeEnabled(); }, LOAD);
}

// Chooses the zip and goes on to the suppliers step, with everything ready.
export async function toSuppliers(user: UserEvent, ...files: File[]): Promise<void> {
  await chooseFiles(user, ...(files.length > 0 ? files : [invoiceZip()]));
  await user.click(await screen.findByRole('button', { name: 'Next' }, LOAD));
  await screen.findByRole('heading', { level: 3, name: 'Suppliers' }, LOAD);
}
