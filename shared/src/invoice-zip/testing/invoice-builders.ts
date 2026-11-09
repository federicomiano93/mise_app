// Invented invoices for the specs (a port of invoice-import/tests/helpers.py, through tests/helpers/invoice-builders.mjs).
// Every name, VAT number and price here is made up: the repository is public, so a real invoice must never become a
// fixture. Specs only: nothing in the app imports it.
//
// What needs the zip reader or builds zips is NOT here: shared/ has no runtime dependency, so that half is in
// app/src/suppliers/invoiceImport/testing/. `makeCase` takes the implementation to drive (the TypeScript port, or the
// js/ original) as an argument, so one spec runs every test against both. Loose files need no zip reader: `looseRead`
// is the reader's result for them.

import type { InvoiceRead, LoadOptions, LoadResult } from '../fatturapa';
import type { BuildOptions, ImportResult } from '../build-import';
import type { Catalogue, ConfigOptions, Product, ProductConfig } from '../products';
import { parseXmlTree } from './xml-tree';
import fixtureDefault from '../../../../invoice-import/tests/fixtures/invoice_default.xml?raw';
import fixtureDefaultMeta from '../../../../invoice-import/tests/fixtures/invoice_default_MT_001.xml?raw';
import fixtureNs3 from '../../../../invoice-import/tests/fixtures/invoice_ns3.xml?raw';
import fixtureNs3Meta from '../../../../invoice-import/tests/fixtures/invoice_ns3_MT_001.xml?raw';
import fixtureNs3Pad from '../../../../invoice-import/tests/fixtures/invoice_ns3_PAD_MT_001.xml?raw';
import fixtureP from '../../../../invoice-import/tests/fixtures/invoice_p.xml?raw';
import fixturePMeta from '../../../../invoice-import/tests/fixtures/invoice_p_MT_001.xml?raw';

// shared/ declares no DOM types (tsconfig `lib` is ES2022 only), and TextEncoder is a platform global in the
// browser and in Node alike: this declares just the one use, emits nothing and changes no behaviour.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

// A file as the picker hands it over.
export interface PickedFile { name: string; bytes: Uint8Array }

// One invented invoice line.
export interface LineSpec {
  desc: string;
  code?: string;
  qty?: number | null;
  unit?: string;
  total?: number | null;
  vat?: string;
}

// The invented invoice around the lines.
export interface InvoiceSpec {
  name?: string;
  vat?: string;
  taxCode?: string | null;
  docType?: string;
  date?: string;
  number?: string;
  buyerVat?: string | null;
}

export const escapeXml = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function lineXml(n: number, spec: LineSpec): string {
  const { qty, total } = spec;
  const parts = [`<NumeroLinea>${n}</NumeroLinea>`];
  if (spec.code) {
    parts.push(`<CodiceArticolo><CodiceTipo>X</CodiceTipo><CodiceValore>${escapeXml(spec.code)}</CodiceValore></CodiceArticolo>`);
  }
  parts.push(`<Descrizione>${escapeXml(spec.desc)}</Descrizione>`);
  if (qty !== undefined && qty !== null) parts.push(`<Quantita>${qty}</Quantita>`);
  if (spec.unit) parts.push(`<UnitaMisura>${spec.unit}</UnitaMisura>`);
  if (qty && total !== undefined && total !== null) parts.push(`<PrezzoUnitario>${total / qty}</PrezzoUnitario>`);
  if (total !== undefined && total !== null) parts.push(`<PrezzoTotale>${total}</PrezzoTotale>`);
  parts.push(`<AliquotaIVA>${spec.vat ?? '4.00'}</AliquotaIVA>`);
  return `<DettaglioLinee>${parts.join('')}</DettaglioLinee>`;
}

export function invoiceXml(lines: readonly LineSpec[], {
  name = 'FORNITORE ESEMPIO SRL', vat = '00000000001', taxCode = null, docType = 'TD01', date = '2026-09-01', number = '1', buyerVat = null,
}: InvoiceSpec = {}): string {
  const ident = vat ? `<IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${vat}</IdCodice></IdFiscaleIVA>` : '';
  const cf = taxCode ? `<CodiceFiscale>${taxCode}</CodiceFiscale>` : '';
  const buyer = buyerVat
    ? `<CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>${buyerVat}</IdCodice></IdFiscaleIVA>`
      + '<Anagrafica><Denominazione>CLIENTE ESEMPIO</Denominazione></Anagrafica></DatiAnagrafici></CessionarioCommittente>'
    : '';
  const body = lines.map((spec, i) => lineXml(i + 1, spec)).join('');
  return '<?xml version="1.0" encoding="UTF-8"?>'
    + '<p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2">'
    + `<FatturaElettronicaHeader><CedentePrestatore><DatiAnagrafici>${ident}${cf}`
    + `<Anagrafica><Denominazione>${escapeXml(name)}</Denominazione></Anagrafica></DatiAnagrafici>`
    + `</CedentePrestatore>${buyer}</FatturaElettronicaHeader>`
    + '<FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento>'
    + `<TipoDocumento>${docType}</TipoDocumento><Data>${date}</Data><Numero>${number}</Numero>`
    + '<ImportoTotaleDocumento>1.00</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali>'
    + `<DatiBeniServizi>${body}</DatiBeniServizi></FatturaElettronicaBody></p:FatturaElettronica>`;
}

export const metadataXml = (sdi: string): string => `<?xml version="1.0"?><FileMetadati><IdentificativoSdI>${sdi}</IdentificativoSdI></FileMetadati>`;

// UTF-8 bytes of a text (fflate's strToU8, without fflate).
export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

// Everything an object holds, as text, Maps and Sets included — for «this never appears anywhere» checks.
export const dump = (value: unknown): string => JSON.stringify(value, (_key, v: unknown) => {
  if (v instanceof Map) return [...v.entries()];
  if (v instanceof Set) return [...v];
  if (v instanceof Uint8Array) return `<${v.length} bytes>`;
  return v;
});

// The platform's own SHA-256 of a text (Web Crypto, a global in the browser and in Node), as lower-case hex. The
// original's specs use node:crypto, which shared/ cannot import; the answer is the same, only async.
export async function platformSha256(text: string): Promise<string> {
  const subtle = (globalThis as unknown as {
    crypto: { subtle: { digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer> } };
  }).crypto.subtle;
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytesOf(text)));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

// The invented fixtures of invoice-import/tests/fixtures/ as { name: text }.
export function fixtureTexts(): Record<string, string> {
  return {
    'invoice_default.xml': fixtureDefault,
    'invoice_default_MT_001.xml': fixtureDefaultMeta,
    'invoice_ns3.xml': fixtureNs3,
    'invoice_ns3_MT_001.xml': fixtureNs3Meta,
    'invoice_ns3_PAD_MT_001.xml': fixtureNs3Pad,
    'invoice_p.xml': fixtureP,
    'invoice_p_MT_001.xml': fixturePMeta,
  };
}

// ── the zip reader's result for loose files ─────────────────────────────────

const baseName = (path: string): string => {
  const parts = String(path).replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] as string;
};
const isZip = (name: string): boolean => name.toLowerCase().endsWith('.zip');
const isXml = (name: string): boolean => name.toLowerCase().endsWith('.xml');
const isP7m = (name: string): boolean => name.toLowerCase().endsWith('.p7m');

// What readInvoiceArchives() returns for loose files only (no archive, no limit): ONE container for all the .xml
// files, every .p7m counted. It is the reader's own rule for loose files, so a spec of the shared logic can run
// without the zip reader (which is app code); a file with the name of a zip is not handled — use the real reader.
export function looseRead(files: readonly PickedFile[]): InvoiceRead {
  const result: InvoiceRead = { containers: [], p7mCount: 0, skipped: [] };
  const sorted = [...files].sort((a, b) => {
    const x = a.name.toLowerCase();
    const y = b.name.toLowerCase();
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const loose = sorted.filter((file) => !isZip(file.name) && (isXml(file.name) || isP7m(file.name)));
  if (loose.length) {
    const entries: Record<string, Uint8Array> = {};
    for (const file of loose) {
      const name = baseName(file.name);
      if (isP7m(name)) result.p7mCount += 1;
      else entries[name] = file.bytes;
    }
    result.containers.push({ source: '', entries });
  }
  return result;
}

// ── a set of invented files ─────────────────────────────────────────────────

// The limits of the reader (tests only). Loose-file readers ignore them.
export interface ReadLimits { maxXmlBytes?: number; maxEntries?: number; maxArchiveBytes?: number }
export interface CaseOptions extends BuildOptions { limits?: ReadLimits }

// The implementation a case drives: the TypeScript port, or the js/ original, behind the same names.
export interface CaseImpl {
  readInvoiceArchives: (files: readonly PickedFile[], options?: { limits?: ReadLimits }) => InvoiceRead;
  loadInvoices: (read: InvoiceRead, options?: LoadOptions) => LoadResult;
  buildCatalogue: (load: LoadResult, config: ProductConfig) => Catalogue;
  makeConfig: (options?: ConfigOptions) => ProductConfig;
  buildImport: (files: readonly PickedFile[], options?: CaseOptions) => ImportResult;
}

export interface InvoiceCase {
  files: PickedFile[];
  add: (lines: readonly LineSpec[], options?: InvoiceSpec & { sdi?: string | null; base?: string }) => void;
  writeInvoice: (base: string, xml: string, sdi?: string | null) => void;
  read: (options?: CaseOptions) => InvoiceRead;
  load: (options?: CaseOptions) => LoadResult;
  catalogue: (options?: CaseOptions) => Catalogue;
  onlyProduct: (catalogue?: Catalogue) => [Catalogue, Product];
  build: (options?: CaseOptions) => ImportResult;
}

// A set of invented files, as the picker would hand them to the app: [{ name, bytes }].
export function makeCase(impl: CaseImpl): InvoiceCase {
  const files: PickedFile[] = [];
  let counter = 0;
  const api: InvoiceCase = {
    files,
    // One invented invoice as a loose file, with its metadata file (unless sdi is null).
    add(lines, { sdi, base, ...kwargs } = {}) {
      counter += 1;
      const name = base || `inv${String(counter).padStart(3, '0')}`;
      api.writeInvoice(name, invoiceXml(lines, kwargs), sdi === undefined ? `9000${String(counter).padStart(6, '0')}` : sdi);
    },
    writeInvoice(base, xml, sdi) {
      files.push({ name: `${base}.xml`, bytes: bytesOf(xml) });
      if (sdi) files.push({ name: `${base}_MT_001.xml`, bytes: bytesOf(metadataXml(sdi)) });
    },
    read(options) {
      return impl.readInvoiceArchives(files, options);
    },
    load(options = {}) {
      return impl.loadInvoices(api.read(options), { parseXml: parseXmlTree, ...options });
    },
    catalogue(options = {}) {
      return impl.buildCatalogue(api.load(options), impl.makeConfig(options));
    },
    onlyProduct(catalogue = api.catalogue()) {
      const all = [...catalogue.products.values()];
      if (all.length !== 1) throw new Error(`expected one product, got ${JSON.stringify(all.map((p) => p.key))}`);
      return [catalogue, all[0] as Product];
    },
    build(options = {}) {
      return impl.buildImport(files, { parseXml: parseXmlTree, now: new Date('2026-10-03T10:15:00Z'), ...options });
    },
  };
  return api;
}
