// Invented invoices for the tests (a port of invoice-import/tests/helpers.py). Every name, VAT number and
// price here is made up: the repository is public, so a real invoice must never become a fixture.
import { readFileSync, readdirSync } from 'node:fs';
import { zipSync, strToU8 } from '../../js/vendor/fflate.esm.js';
import { readInvoiceArchives } from '../../js/orders/invoice-zip/zip-read.js';
import { loadInvoices } from '../../js/orders/invoice-zip/fatturapa.js';
import { buildCatalogue, makeConfig } from '../../js/orders/invoice-zip/products.js';
import { buildImportFromInvoices } from '../../js/orders/invoice-zip/build-import.js';
import { parseXmlTree } from './xml-tree.mjs';

export const FIXTURES = new URL('../../invoice-import/tests/fixtures/', import.meta.url);

export const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function lineXml(n, spec) {
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

export function invoiceXml(lines, {
  name = 'FORNITORE ESEMPIO SRL', vat = '00000000001', taxCode = null, docType = 'TD01', date = '2026-09-01', number = '1', buyerVat = null,
} = {}) {
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

export const metadataXml = (sdi) => `<?xml version="1.0"?><FileMetadati><IdentificativoSdI>${sdi}</IdentificativoSdI></FileMetadati>`;

export const bytesOf = (text) => strToU8(text);

// A set of invented files, as the picker would hand them to the app: [{ name, bytes }].
export function newCase() {
  const files = [];
  let counter = 0;
  const api = {
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
    // A zip of text members { 'a.xml': '<…>' } (a Uint8Array member is kept as it is).
    zipOf(name, members) {
      const data = {};
      for (const [member, content] of Object.entries(members)) {
        data[member] = typeof content === 'string' ? strToU8(content) : content;
      }
      files.push({ name, bytes: zipSync(data) });
    },
    read(options) {
      return readInvoiceArchives(files, options);
    },
    load(options = {}) {
      return loadInvoices(api.read(options), { parseXml: parseXmlTree, ...options });
    },
    catalogue(options = {}) {
      return buildCatalogue(api.load(options), makeConfig(options));
    },
    onlyProduct(catalogue = api.catalogue()) {
      const all = [...catalogue.products.values()];
      if (all.length !== 1) throw new Error(`expected one product, got ${JSON.stringify(all.map((p) => p.key))}`);
      return [catalogue, all[0]];
    },
    build(options = {}) {
      return buildImportFromInvoices(files, { parseXml: parseXmlTree, now: new Date('2026-10-03T10:15:00Z'), ...options });
    },
  };
  return api;
}

// The invented fixtures of invoice-import/tests/fixtures/ as { name: text }.
export function fixtureTexts() {
  const out = {};
  for (const name of readdirSync(FIXTURES)) {
    if (name.endsWith('.xml')) out[name] = readFileSync(new URL(name, FIXTURES), 'utf8');
  }
  return out;
}
