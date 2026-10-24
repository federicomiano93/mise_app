// The two implementations of the invoice import the app's specs run every test against: the TypeScript port (the
// zip reader in app/, the rest in shared/) and the js/orders/invoice-zip/ files the live app runs today (until the
// switch to Mise 2 retires them). Specs only.
//
// The js/ files are loaded with `import.meta.glob`, as the other specs of app/ do: this project does not read js/
// as TypeScript (no `allowJs`), and a static import of it would not type-check. The cast is typing only.

import * as fatturapa from '@mise/shared/invoice-zip/fatturapa';
import * as products from '@mise/shared/invoice-zip/products';
import { makeCase } from '@mise/shared/invoice-zip/testing/invoice-builders';
import type { CaseImpl, InvoiceCase } from '@mise/shared/invoice-zip/testing/invoice-builders';
import { zipSync, strToU8 } from 'fflate';
import * as zipRead from '../zipRead';
import { buildImportFromInvoices } from '../buildImport';

const modules = import.meta.glob('../../../../../js/orders/invoice-zip/*.js', { eager: true });
const legacyModules = import.meta.glob('../../../../../js/orders/invoice-import-model.js', { eager: true });

function legacyFile<T>(file: string): T {
  const module = modules[`../../../../../js/orders/invoice-zip/${file}`];
  if (!module) throw new Error(`js/orders/invoice-zip/${file} is not where the spec looks for it`);
  return module as T;
}

export interface Implementation {
  fatturapa: typeof fatturapa;
  zipRead: typeof zipRead;
  buildImportFromInvoices: typeof buildImportFromInvoices;
  caseImpl: CaseImpl;
}

const legacyFatturapa = legacyFile<typeof fatturapa>('fatturapa.js');
const legacyProducts = legacyFile<typeof products>('products.js');
const legacyZipRead = legacyFile<typeof zipRead>('zip-read.js');
const legacyBuild = legacyFile<{ buildImportFromInvoices: typeof buildImportFromInvoices }>('build-import.js');

export const ported: Implementation = {
  fatturapa,
  zipRead,
  buildImportFromInvoices,
  caseImpl: {
    readInvoiceArchives: zipRead.readInvoiceArchives,
    loadInvoices: fatturapa.loadInvoices,
    buildCatalogue: products.buildCatalogue,
    makeConfig: products.makeConfig,
    buildImport: buildImportFromInvoices,
  },
};

export const legacy: Implementation = {
  fatturapa: legacyFatturapa,
  zipRead: legacyZipRead,
  buildImportFromInvoices: legacyBuild.buildImportFromInvoices,
  caseImpl: {
    readInvoiceArchives: legacyZipRead.readInvoiceArchives,
    loadInvoices: legacyFatturapa.loadInvoices,
    buildCatalogue: legacyProducts.buildCatalogue,
    makeConfig: legacyProducts.makeConfig,
    buildImport: legacyBuild.buildImportFromInvoices,
  },
};

export const implementations = [
  ['app/ + shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const;

// The current app's own model of the import file: the import the port builds must be accepted by it too (it is what the
// screen of the current app reads; Mise 2's own model comes with its screen).
export const legacyImportModel = Object.values(legacyModules)[0] as {
  parseImportFile: (text: string) => { ok: boolean; file: { ingredients: { invalid?: unknown }[]; suppliers: { invalid?: unknown }[] } };
};

// ── a case with zip archives ───────────────────────────────────────────────

export interface ZipCase extends InvoiceCase {
  // A zip of text members { 'a.xml': '<…>' } (a Uint8Array member is kept as it is).
  zipOf: (name: string, members: Record<string, string | Uint8Array>) => void;
}

// `makeCase` plus `zipOf`, which needs fflate (the zip is built with `zipSync`, as the current app's tests do).
export function makeZipCase(impl: CaseImpl): ZipCase {
  const base = makeCase(impl);
  return Object.assign(base, {
    zipOf(name: string, members: Record<string, string | Uint8Array>): void {
      const data: Record<string, Uint8Array> = {};
      for (const [member, content] of Object.entries(members)) {
        data[member] = typeof content === 'string' ? strToU8(content) : content;
      }
      base.files.push({ name, bytes: zipSync(data) });
    },
  });
}
