// The two implementations of the invoice reader a spec runs every test against: the TypeScript port in shared/ and
// the js/orders/invoice-zip/ files the live app runs today (until the switch to Mise 2 retires them). Specs only.
//
// The js/ files are typed as the ports are (the cast is typing only): allowJs lets the compiler read them, it does
// not check them. `caseImpl` is what `makeCase` drives. For the port, the reader's result for loose files is
// `looseRead` (the zip reader is app code); for the original it is the original's own reader.

import * as fatturapa from '../fatturapa';
import * as products from '../products';
import * as pricing from '../pricing';
import * as selection from '../selection';
import * as buildImport from '../build-import';
import * as legacyFatturapaJs from '../../../../js/orders/invoice-zip/fatturapa.js';
import * as legacyProductsJs from '../../../../js/orders/invoice-zip/products.js';
import * as legacyPricingJs from '../../../../js/orders/invoice-zip/pricing.js';
import * as legacySelectionJs from '../../../../js/orders/invoice-zip/selection.js';
import * as legacyBuildImportJs from '../../../../js/orders/invoice-zip/build-import.js';
import * as legacyZipReadJs from '../../../../js/orders/invoice-zip/zip-read.js';
import { looseRead, type CaseImpl, type PickedFile } from './invoice-builders';

// build-import.js without the zip: the port leaves out `buildImportFromInvoices` and has `buildImportFromRead`.
export type BuildImportNames = Omit<typeof buildImport, 'buildImportFromRead'>;

export interface Implementation {
  fatturapa: typeof fatturapa;
  products: typeof products;
  pricing: typeof pricing;
  selection: typeof selection;
  buildImport: BuildImportNames;
  caseImpl: CaseImpl;
}

const legacyFatturapa = legacyFatturapaJs as unknown as typeof fatturapa;
const legacyProducts = legacyProductsJs as unknown as typeof products;
const legacyBuildImport = legacyBuildImportJs as unknown as BuildImportNames & {
  buildImportFromInvoices: CaseImpl['buildImport'];
};
const legacyZipRead = legacyZipReadJs as unknown as { readInvoiceArchives: CaseImpl['readInvoiceArchives'] };

export const ported: Implementation = {
  fatturapa,
  products,
  pricing,
  selection,
  buildImport,
  caseImpl: {
    readInvoiceArchives: looseRead,
    loadInvoices: fatturapa.loadInvoices,
    buildCatalogue: products.buildCatalogue,
    makeConfig: products.makeConfig,
    buildImport: (files: readonly PickedFile[], options) => buildImport.buildImportFromRead(looseRead(files), options),
  },
};

export const legacy: Implementation = {
  fatturapa: legacyFatturapa,
  products: legacyProducts,
  pricing: legacyPricingJs as unknown as typeof pricing,
  selection: legacySelectionJs as unknown as typeof selection,
  buildImport: legacyBuildImport,
  caseImpl: {
    readInvoiceArchives: legacyZipRead.readInvoiceArchives,
    loadInvoices: legacyFatturapa.loadInvoices,
    buildCatalogue: legacyProducts.buildCatalogue,
    makeConfig: legacyProducts.makeConfig,
    buildImport: legacyBuildImport.buildImportFromInvoices,
  },
};

export const implementations = [
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const;
