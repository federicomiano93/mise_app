// @vitest-environment node
//
// The two files of the recipe export, really built: a PDF read back as text and an .xlsx unzipped. Ported from
// the file-building tests of tests/recipe-export.test.mjs (the pure half — layout, names, the sheet description —
// is pinned in shared/src/recipe-export.spec.ts). The owner cannot read a PDF's internals, so these pin what he
// would see: one page, every row, the title, numbers that stay exact, Calibri 11.
//
// Also pinned here: the two libraries are NEVER imported statically anywhere in app/src (they are ~470 KB and
// must load on the tap only), and a library that cannot be fetched is told apart from a bug in the build.
// Fake recipe names only — the repo is public.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { strFromU8, unzipSync } from 'fflate';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportErrorCode, exportErrorKey, rowText } from '@mise/shared/recipe-export';
import type { ExportModel } from '@mise/shared/recipe-export';
import { buildPdfBlob, buildXlsxBlob } from './recipeExport';

const SIX: ExportModel = {
  name: 'Impasto di prova',
  trays: 0,
  totalG: 24000,
  rows: [
    { name: 'Farina di prova', grams: 14400.4 },
    { name: 'Acqua', grams: 8640.5 },
    { name: 'Sale', grams: 288.25 },
    { name: 'Lievito', grams: 72.5 },
    { name: 'Olio di prova', grams: 480 },
    { name: 'Malto', grams: 118.4 },
  ],
};
const TRAYS: ExportModel = { ...SIX, name: 'Pizza di prova', trays: 3, totalG: 9000 };
const SIXTY: ExportModel = {
  name: 'Ricetta enorme di prova',
  trays: 0,
  totalG: 60000,
  rows: Array.from({ length: 60 }, (_, i) => ({ name: `Ingrediente di prova numero ${String(i + 1)}`, grams: 100 + i * 7.3 })),
};
// 500 ml + 2 kg + 250 g = 2750 g.
const MIXED: ExportModel = {
  name: 'Crema di prova',
  trays: 0,
  totalG: 2750,
  rows: [
    { name: 'Latte di prova', value: 500, unit: 'ml', factor: 1 },
    { name: 'Farina di prova', value: 2, unit: 'kg', factor: 1000 },
    { name: 'Uova di prova', value: 3, unit: 'pz', factor: 0 },
    { name: 'Zucchero di prova', value: 250, unit: 'g', factor: 1 },
    { name: 'Sale di prova', value: null, unit: 'q.b.', factor: 0 },
  ],
};
// Each row rounds in its own unit on screen: the formula over the rows would not round to the Total.
const MIXED_DRIFT: ExportModel = {
  name: 'Salsa di prova',
  trays: 0,
  totalG: 1841,
  rows: [
    { name: 'Olio di prova', value: 1, unit: 'kg', factor: 1000 },
    { name: 'Acqua di prova', value: 1, unit: 'kg', factor: 1000 },
    { name: 'Sale di prova', value: 1, unit: 'g', factor: 1 },
  ],
};
const ONLY_PIECES: ExportModel = {
  name: 'Decori di prova',
  trays: 0,
  totalG: 0,
  rows: [
    { name: 'Ciliegie di prova', value: 6, unit: 'pz', factor: 0 },
    { name: 'Sale di prova', value: null, unit: 'q.b.', factor: 0 },
  ],
};

async function pdfText(model: ExportModel): Promise<string> {
  const blob = await buildPdfBlob(model);
  expect(blob.type).toBe('application/pdf');
  return Buffer.from(await blob.arrayBuffer()).toString('latin1');
}
const pageCount = (pdf: string) => (pdf.match(/\/Type \/Page(?!s)/g) ?? []).length;

async function sheetFiles(blob: Blob) {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const text = (name: string) => strFromU8(files[name] ?? new Uint8Array());
  return {
    sheet: text('xl/worksheets/sheet1.xml'),
    styles: text('xl/styles.xml'),
    strings: text('xl/sharedStrings.xml'),
    workbook: text('xl/workbook.xml'),
  };
}

describe('a real PDF', () => {
  it('is exactly one page with the title and every row in it', async () => {
    const pdf = await pdfText(TRAYS);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pageCount(pdf)).toBe(1);
    expect(pdf).toContain('(Pizza di prova x 3)');
    for (const row of TRAYS.rows) {
      const { name, grams } = row as { name: string; grams: number };
      expect(pdf, name).toContain(`(${name})`);
      expect(pdf, rowText(grams)).toContain(`(${rowText(grams)})`);
    }
    expect(pdf).toMatch(/\/Title \(Pizza di prova x 3\)/);
  });

  it('of 60 rows is still one page', async () => {
    const pdf = await pdfText(SIXTY);
    expect(pageCount(pdf)).toBe(1);
    expect(pdf).toContain(`(${rowText((SIXTY.rows[59] as { grams: number }).grams)})`);
  });

  it('from mixed units has each row with its own unit, and a title with no weight for pieces only', async () => {
    const pdf = await pdfText(MIXED);
    expect(pageCount(pdf)).toBe(1);
    for (const text of ['500 ml', '2 kg', '3 pz', '250 g', 'q.b.']) expect(pdf, text).toContain(`(${text})`);
    const pieces = await pdfText(ONLY_PIECES);
    expect(pieces).toContain('(Decori di prova)');
    expect(pieces).toMatch(/\/Title \(Decori di prova\)/);
  });

  it('prints a kg row with the screen’s own number (the Italian decimal mark), never rounded to «2 kg»', async () => {
    const model: ExportModel = {
      name: 'Impasto di prova',
      trays: 0,
      totalG: 3000,
      rows: [{ name: 'Farina di prova', value: 0.727, unit: 'kg', factor: 1000, decimals: 3, text: '0,727' }],
    };
    expect(await pdfText(model)).toContain('(0,727 kg)');
  });
});

describe('a real .xlsx', () => {
  it('has the merged bold title, exact numbers with the «g» format, and a SUM formula total', async () => {
    const blob = await buildXlsxBlob(SIX, 'Impasto totale');
    expect(blob.type).toMatch(/spreadsheetml/);
    const { sheet, styles, strings, workbook } = await sheetFiles(blob);
    expect(sheet).toMatch(/<mergeCell ref="A1:B1"/);
    expect(sheet).toMatch(/<f>SUM\(B3:B8\)<\/f>/);
    expect(sheet).toMatch(/orientation="portrait"/);
    expect(strings).toContain('Impasto di prova — 24000 g');
    expect(strings).toContain('Impasto totale');
    expect(styles).toMatch(/formatCode="0 &quot;g&quot;"/);
    expect(styles).toMatch(/<b\s*\/>|<b>/);
    const values = [...sheet.matchAll(/<c r="B([3-8])"[^>]*><v>([^<]+)<\/v>/g)].map(m => Number(m[2]));
    expect(values).toEqual(SIX.rows.map(row => (row as { grams: number }).grams));
    expect(workbook).toMatch(/<sheet [^>]*name="Impasto di prova"/);
  });

  it('names its font: every font is Calibri 11, so the column widths mean the same in every spreadsheet app', async () => {
    const { styles } = await sheetFiles(await buildXlsxBlob(SIX, 'Totale'));
    const fonts = [...styles.matchAll(/<font>(.*?)<\/font>/g)].map(m => m[1] ?? '');
    expect(fonts.length).toBeGreaterThanOrEqual(2);
    for (const font of fonts) {
      expect(font).toMatch(/<sz val="11"\/>/);
      expect(font).toMatch(/<name val="Calibri"\/>/);
    }
  });

  it('from mixed units has the unit formats, «q.b.» as text and the converted-total formula', async () => {
    const { sheet, styles, strings } = await sheetFiles(await buildXlsxBlob(MIXED, 'Totale'));
    expect(sheet).toMatch(/<f>B3\+B4\*1000\+B6<\/f>/);
    for (const unit of ['ml', 'kg', 'pz', 'g']) expect(styles).toMatch(new RegExp(`formatCode="0 &quot;${unit}&quot;"`));
    expect(strings).toContain('q.b.');
    const values = [...sheet.matchAll(/<c r="B([3-5])"[^>]*><v>([^<]+)<\/v>/g)].map(m => Number(m[2]));
    expect(values).toEqual([500, 2, 3]);
  });

  it('puts the screen’s total in as a plain number when the formula would not round to it', async () => {
    const { sheet } = await sheetFiles(await buildXlsxBlob(MIXED_DRIFT, 'Totale'));
    expect(sheet).not.toMatch(/<f>/);
    expect(sheet).toMatch(/<c r="B6"[^>]*><v>1841<\/v>/);
  });

  it('keeps the decimals of a kg row and does not round them away in the format', async () => {
    const model: ExportModel = {
      name: 'Impasto di prova',
      trays: 0,
      totalG: 3000,
      rows: [
        { name: 'Farina di prova', value: 0.727, unit: 'kg', factor: 1000, decimals: 3, text: '0,727' },
        { name: 'Latte di prova', value: 2.273, unit: 'l', factor: 1000, decimals: 3, text: '2,273' },
      ],
    };
    const { sheet, styles } = await sheetFiles(await buildXlsxBlob(model, 'Totale'));
    expect(styles).toMatch(/formatCode="General &quot;kg&quot;"/);
    expect(styles).toMatch(/formatCode="General &quot;l&quot;"/);
    expect([...sheet.matchAll(/<c r="B([3-4])"[^>]*><v>([^<]+)<\/v>/g)].map(m => Number(m[2]))).toEqual([0.727, 2.273]);
  });

  it('uses the caller’s word for a sheet whose recipe has no usable name', async () => {
    const { workbook } = await sheetFiles(await buildXlsxBlob({ ...SIX, name: '' }, 'Totale', 'Ricetta'));
    expect(workbook).toMatch(/<sheet [^>]*name="Ricetta"/);
  });
});

describe('a library that cannot be loaded', () => {
  afterEach(() => {
    vi.doUnmock('jspdf');
    vi.doUnmock('write-excel-file/browser');
    vi.resetModules();
  });

  it('is a library error, told apart from a bug: only an OFFLINE phone is asked to connect', async () => {
    vi.resetModules();
    vi.doMock('jspdf', () => { throw new Error('Failed to fetch dynamically imported module'); });
    vi.doMock('write-excel-file/browser', () => { throw new Error('Failed to fetch dynamically imported module'); });
    const fresh = await import('./recipeExport');
    const pdf = await fresh.buildPdfBlob(SIX).then(() => null, (error: unknown) => error);
    const xlsx = await fresh.buildXlsxBlob(SIX, 'Totale').then(() => null, (error: unknown) => error);
    for (const error of [pdf, xlsx]) {
      expect(exportErrorCode(error)).toBe('library');
      expect(exportErrorKey(error, false)).toBe('export.needsConnection');
      expect(exportErrorKey(error, true)).toBe('export.failed');
    }
  });
});

describe('the libraries stay out of the app’s own code', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const src = join(here, '..');

  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      return /\.(ts|tsx)$/.test(name) && !/\.spec\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  it('⚠️ no file in app/src imports jspdf or write-excel-file statically (only import() inside a function)', () => {
    const files = sources(src);
    expect(files.length).toBeGreaterThan(50);
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // `import x from 'jspdf'`, `import { x } from '...'` over several lines, `export … from '…'`, `import 'jspdf'`.
      if (/(?:^|\n)\s*(?:import(?!\s+type\b)|export)\b[^;]*?\bfrom\s*['"](?:jspdf|write-excel-file)[^'"]*['"]/.test(text)) offenders.push(file);
      if (/(?:^|\n)\s*import\s*['"](?:jspdf|write-excel-file)[^'"]*['"]/.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it('loads each library with import() inside the builders, and write-excel-file through its browser entry', () => {
    const text = readFileSync(join(here, 'recipeExport.ts'), 'utf8');
    expect(text).toMatch(/import\('jspdf'\)/);
    expect(text).toMatch(/import\('write-excel-file\/browser'\)/);
    expect(text).toMatch(/libraryError\(cause\)/);
  });
});
