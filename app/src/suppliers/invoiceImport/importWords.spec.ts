import { describe, expect, it } from 'vitest';
import { LEFT_OUT, NOTE, SKIPPED } from '@mise/shared/invoice-zip/reasons';
import { en } from '../../i18n/en';
import type { Message } from '../../i18n/en';
import { it as italian } from '../../i18n/it';
import { FILTERS } from '@mise/shared/invoice-import-plan';
import {
  CODE_KEYS, FILTER_KEYS, REASON_KEYS, STATUS, SUPPLIER_REASON_KEYS, SUPPLIER_STATUS, UNKNOWN_REASON_KEY, codeKeys, filterKey, reasonKey,
  supplierReasonKey,
} from './importWords';

// The words of «Import from invoices» (parts B3a and B3b, slice 1): every reason the reader can give has a phrase, every key is asked by somebody,
// nothing is frozen at module load, and the wording the owner agreed is the wording on screen.
//
// PORTS (tests/invoice-import-screen.test.mjs): «every reason code of the invoice reader that can reach the screen has a phrase»,
// «every invoiceImport key the code asks for exists in English AND Italian, with the same plural shape» (and its converse: no key
// that nothing asks for), «⚠️ no phrase is frozen at module load», «the labels the owner agreed are the ones on screen», «the words
// the owner reads on the invoices path are the agreed ones, in both languages». The i18n spec already pins that Italian has exactly
// the keys English has; the shape and the placeholders here are for this screen's keys only.

const sources = import.meta.glob(['./*.ts', './*.tsx', '../SuppliersList.tsx', '!./*.spec.*', '!./testing/*'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const IMP_KEYS = (Object.keys(en) as (keyof typeof en)[]).filter(key => key.startsWith('sup.imp.'));
const textsOf = (message: Message): string[] => (typeof message === 'string' ? [message] : Object.values(message));

describe('the reader\'s reasons', () => {
  const reasons = Object.values(NOTE);
  // The notes that explain a price that cannot be used start at «egg-quantity-unclear»; the ones before it say how a price WAS reached.
  const codes = [...reasons.slice(reasons.indexOf('egg-quantity-unclear')), ...Object.values(LEFT_OUT), ...Object.values(SKIPPED)]
    .filter(code => code !== LEFT_OUT.NOT_AN_INGREDIENT);

  it('finds them (the check below is not looking at nothing)', () => {
    expect(codes.length).toBeGreaterThanOrEqual(20);
  });

  it.each(codes)('⚠️ %s has a phrase, in English and in Italian', code => {
    const key = (CODE_KEYS as Record<string, keyof typeof en>)[code];
    expect(key, `${code} has no phrase in the screen's table`).toBeDefined();
    expect(en[key as keyof typeof en]).toBeTruthy();
    expect(italian[key as keyof typeof italian]).toBeTruthy();
  });

  it('a note that holds several codes joins their phrases; a code nobody knows is «could not be imported», never blank', () => {
    expect(codeKeys('mixed-units; no-price-unit')).toEqual(['sup.imp.code.mixedUnits', 'sup.imp.code.noPriceUnit']);
    expect(codeKeys('not-a-code')).toEqual([UNKNOWN_REASON_KEY]);
    expect(codeKeys('')).toEqual([]);
    expect(codeKeys(undefined)).toEqual([]);
  });

  it('a supplier\'s reason is a phrase too, and an unknown one is the plain «could not be imported»', () => {
    for (const code of Object.keys(SUPPLIER_REASON_KEYS)) expect(supplierReasonKey(code)).not.toBe(UNKNOWN_REASON_KEY);
    expect(supplierReasonKey('something-new')).toBe(UNKNOWN_REASON_KEY);
    expect(supplierReasonKey('toString')).toBe(UNKNOWN_REASON_KEY);
  });

  it('every status is a WORD in a pill, and the colour only repeats it', () => {
    for (const { key, tone } of Object.values(SUPPLIER_STATUS)) {
      expect(en[key].length).toBeGreaterThan(2);
      expect(italian[key].length).toBeGreaterThan(2);
      expect(['ok', 'warn', 'error']).toContain(tone);
    }
  });
});

describe('step 3\'s tables (part B3b)', () => {
  // Every reason code the model and the plan can put on an ingredient row (invoice-import-model.ts / invoice-import-plan.ts).
  const ROW_REASONS = [
    'not-object', 'key-missing', 'duplicate-key', 'name-missing', 'vat-missing', 'vat-too-long', 'supplier-key-missing',
    'supplier-missing', 'price-unit', 'unit-weight-missing', 'pack-count', 'no-prices', 'price-invalid', 'target-not-found',
    'code-ambiguous', 'name-ambiguous', 'merge-target-not-found', 'merge-target-ambiguous', 'duplicate-vat', 'code-differs',
    'unit-differs', 'piece-differs', 'codes-full',
  ];

  it.each(ROW_REASONS)('⚠️ the reason %s has a phrase, in English and in Italian', code => {
    const key = reasonKey(code);
    expect(key).not.toBe(UNKNOWN_REASON_KEY);
    expect(en[key]).toBeTruthy();
    expect(italian[key]).toBeTruthy();
  });

  it('an unknown reason, a missing one and a prototype name are «could not be imported», never a blank', () => {
    expect(reasonKey('something-new')).toBe(UNKNOWN_REASON_KEY);
    expect(reasonKey(undefined)).toBe(UNKNOWN_REASON_KEY);
    expect(reasonKey('toString')).toBe(UNKNOWN_REASON_KEY);
    expect(Object.keys(REASON_KEYS).sort()).toEqual([...ROW_REASONS].sort());
  });

  it('the six reasons a supplier shares with a product use the same phrases', () => {
    for (const code of Object.keys(SUPPLIER_REASON_KEYS)) expect(reasonKey(code)).toBe(supplierReasonKey(code));
  });

  it('every row status is a WORD in a pill with a tone, and «quiet» is for what writes nothing', () => {
    for (const { key, tone } of Object.values(STATUS)) {
      expect(en[key]).toBeTruthy();
      expect(italian[key]).toBeTruthy();
      expect(['ok', 'warn', 'error', 'quiet']).toContain(tone);
    }
    expect(STATUS['history-only'].tone).toBe('quiet');
    expect(STATUS.unchanged.tone).toBe('quiet');
    expect(STATUS.skipped.tone).toBe('quiet');
    expect(STATUS.check.tone).toBe('warn');
  });

  it('every chip of the plan has a word, and an unknown one never throws', () => {
    for (const filter of FILTERS) {
      expect(Object.hasOwn(FILTER_KEYS, filter), filter).toBe(true);
      expect(en[filterKey(filter)]).toBeTruthy();
      expect(italian[filterKey(filter)]).toBeTruthy();
    }
    expect(filterKey('nonsense')).toBe(UNKNOWN_REASON_KEY);
  });
});

describe('the review sentences (tests/invoice-import-review.test.mjs)', () => {
  it('3 · the sales-invoice summary line exists in English and Italian, with a singular and a plural', () => {
    for (const message of [en['sup.imp.zip.sales'], italian['sup.imp.zip.sales']]) {
      expect(typeof message).toBe('object');
      const { one, other } = message as { one: string; other: string };
      expect(one).toMatch(/\{n\}/);
      expect(other).toMatch(/\{n\}/);
    }
    expect((en['sup.imp.zip.sales'] as { other: string }).other).toBe('{n} sales invoices skipped');
    expect((italian['sup.imp.zip.sales'] as { other: string }).other).toBe('{n} fatture di vendita ignorate');
  });

  it('4 · the reason sentences exist in both languages, with their holes', () => {
    expect(italian['sup.imp.check.olderInvoice']).toBe('Prezzo dalla fattura del {date}: la più recente è da verificare.');
    for (const key of ['sup.imp.check.weightUnreadable', 'sup.imp.check.priceJump', 'sup.imp.check.olderInvoice'] as const) {
      expect(typeof en[key], key).toBe('string');
      expect(typeof italian[key], key).toBe('string');
    }
    for (const language of [en, italian]) {
      expect(language['sup.imp.check.priceJump']).toMatch(/\{limit\}/);
      expect(language['sup.imp.check.olderInvoice']).toMatch(/\{date\}/);
      expect(language['sup.imp.check.olderInvoiceNew']).toMatch(/\{date\}/);
      expect(language['sup.imp.check.weightRescaled']).toMatch(/\{stored\}.*\{file\}/);
      expect(language['sup.imp.check.invoiceNameChanged']).toMatch(/\{old\}.*\{new\}/);
      expect(typeof language['sup.imp.ing.confirm.use']).toBe('string');
      expect(typeof language['sup.imp.ing.confirm.hold']).toBe('string');
    }
  });

  it('4 · the unreadable-weight sentence says the price below uses the invoice weight', () => {
    expect(en['sup.imp.check.weightUnreadable'])
      .toBe('The pack weight saved in Mise cannot be read: the price per kilo or litre below uses the weight on the invoice. Check it.');
    expect(italian['sup.imp.check.weightUnreadable'])
      .toBe('Il peso della confezione salvato in Mise non si legge: il prezzo al chilo o al litro qui sotto usa il peso scritto in fattura. Controllalo.');
  });

  it('7 · a NEW row from an older invoice says it WILL BE CREATED, the matched one does not', () => {
    expect(en['sup.imp.check.olderInvoiceNew'])
      .toBe('It will be created with the price of the invoice of {date}: the most recent one needs checking.');
    expect(italian['sup.imp.check.olderInvoiceNew'])
      .toBe('Verrà creato con il prezzo della fattura del {date}: la più recente è da verificare.');
    expect(en['sup.imp.check.olderInvoice']).not.toMatch(/created/);
  });

  it('10 · «This price?» has its own label', () => {
    expect(en['sup.imp.ing.confirm.label']).toBe('This price?');
    expect(italian['sup.imp.ing.confirm.label']).toBe('Questo prezzo?');
  });

  it('R6 · the rescaled sentence names both packs', () => {
    expect(en['sup.imp.check.weightRescaled'])
      .toBe('Price worked out with the pack saved in Mise ({stored}) instead of the one on the invoice ({file}). Check it.');
    expect(italian['sup.imp.check.weightRescaled'])
      .toBe('Prezzo calcolato con la confezione salvata in Mise ({stored}) invece di quella in fattura ({file}). Controllalo.');
  });
});

describe('the dictionary', () => {
  it('finds the keys (the checks below are not looking at nothing)', () => {
    expect(IMP_KEYS.length).toBeGreaterThan(80);
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(8);
  });

  it('⚠️ a plural in English is a plural in Italian, and both forms say how many', () => {
    for (const key of IMP_KEYS) {
      const english = en[key] as Message;
      const other = italian[key] as Message;
      expect(typeof english, key).toBe(typeof other);
      if (typeof english === 'object') {
        for (const form of [english, other as typeof english]) {
          expect(Object.keys(form).sort(), key).toEqual(['one', 'other']);
          expect(form.one, key).toMatch(/\{n\}/);
          expect(form.other, key).toMatch(/\{n\}/);
        }
      }
    }
  });

  it('has the same {holes} in both languages', () => {
    const holes = (message: Message) => textsOf(message).flatMap(text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1])).sort().join(',');
    for (const key of IMP_KEYS) expect(holes(italian[key] as Message), key).toBe(holes(en[key] as Message));
  });

  it('⚠️ every key is asked by a file of the screen (none is left over, none is missing)', () => {
    const everything = Object.values(sources).join('\n');
    const asked = new Set([...everything.matchAll(/'(sup\.imp\.[A-Za-z.]+)'/g)].map(match => match[1]));
    for (const key of IMP_KEYS) expect(asked.has(key), `${key} is in the dictionary and nothing asks for it`).toBe(true);
    for (const key of asked) expect(IMP_KEYS as string[], `${key} is asked for and is not in the dictionary`).toContain(key);
  });

  it('⚠️ no phrase is frozen at module load: no t() call sits at the top level of a file', () => {
    for (const [file, source] of Object.entries(sources)) {
      const frozen = source.split('\n').filter(line => /^(export\s+)?(const|let|var)\s[^=]*=.*\bt\(\s*'sup\.imp\./.test(line));
      expect(frozen, file).toEqual([]);
    }
  });

  it('⚠️ F6: nothing the owner reads offers a .json file', () => {
    for (const key of IMP_KEYS) {
      for (const text of [...textsOf(en[key] as Message), ...textsOf(italian[key] as Message)]) expect(text, key).not.toMatch(/json/i);
    }
  });
});

describe('the words the owner agreed', () => {
  it('are the current app\'s, in English', () => {
    expect(en['sup.imp.title']).toBe('Import from invoices');
    expect(en['sup.imp.status.maybe']).toBe('Maybe this one?');
    expect(en['sup.imp.sameAs']).toBe('Same as {name}');
    expect(en['sup.imp.suppliers.createNew']).toBe('Create a new supplier');
    expect(en['sup.imp.file.label']).toBe('Choose the file');
    expect(en['sup.imp.suppliers.changed']).toBe('The supplier list changed: check again.');
    expect(en['sup.imp.discard.title']).toBe('Leave the import?');
    expect(en['sup.imp.file.explain']).toMatch(/zip of the invoices .* Agenzia delle Entrate/);
  });

  it('are the current app\'s, in Italian', () => {
    expect(italian['sup.imp.title']).toBe('Importa da fatture');
    expect(italian['sup.imp.file.label']).toBe('Scegli il file');
    expect(italian['sup.imp.file.reading']).toBe('Sto leggendo le fatture…');
    expect(italian['sup.imp.file.explain']).toMatch(/zip delle fatture .*Agenzia delle Entrate/);
    expect(italian['sup.imp.zip.group.notImported']).toBe('Imballaggi e rivendita ({n})');
    expect(italian['sup.imp.zip.group.skippedByYou']).toBe('Esclusi da te ({n})');
    expect(italian['sup.imp.zip.group.skippedSuppliers']).toBe('Fornitori esclusi da te ({n})');
    expect(italian['sup.imp.zip.importAsIngredient']).toBe('Importa come ingrediente');
    expect(italian['sup.imp.zip.importAgain']).toBe('Importa di nuovo');
    expect(italian['sup.imp.stop.offline']).toMatch(/^Non c’è connessione\./);
  });
});
