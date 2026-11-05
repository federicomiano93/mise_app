import { describe, expect, test } from 'vitest';
import { normalizeCatalogueRecipe } from '@mise/shared/catalogue-model';
import {
  cleanWorking, duplicateWorking, labelIngredientsBoxText, labelNameText, restoreWorking, workingFrom,
} from './editorModel';
import { asLabelLogo, imageLabelChoice } from './imageLabelData';
import {
  LABEL_NAME_MAX, LABEL_TEXT_MAX, labelTextPatchOf, labelTextsOf, labelTitleOf, normalizeStoredRecipe, normalizeStoredRecipes,
} from './labelTexts';

// The image label's data, read and written by Mise 2 only: the recipe's two texts, the model chosen in config/labels and
// the logo. Each is checked here before a screen ever draws it.

const STORED = {
  id: 'R1', name: ' Torta ', ingredients: [{ label: 'Farina', grams: 500, unit: 'g' }], shelfLifeDays: 3,
  labelName: 'TORTA DI|PROVA', labelIngredientsText: 'INGREDIENTI: farina di GRANO.', bakery: 'b',
};

describe('the recipe’s two label texts', () => {
  test('⚠️ the shared normaliser still drops them (it is pinned to the current app), the store’s keeps them', () => {
    const shared = normalizeCatalogueRecipe(STORED) as unknown as Record<string, unknown>;
    expect('labelName' in shared).toBe(false);
    const ours = normalizeStoredRecipe(STORED) as unknown as Record<string, unknown>;
    expect(ours).toEqual({ ...shared, labelName: 'TORTA DI|PROVA', labelIngredientsText: 'INGREDIENTI: farina di GRANO.' });
    expect(normalizeStoredRecipe(null)).toBeNull();
    expect(normalizeStoredRecipes([STORED, null, 3])).toHaveLength(1);
    expect(normalizeStoredRecipes('nope')).toEqual([]);
  });

  test('blank or not a string is no text at all', () => {
    for (const odd of ['', '   ', 7, null, ['A'], { a: 1 }]) {
      const held = normalizeStoredRecipe({ ...STORED, labelName: odd, labelIngredientsText: odd }) as unknown as Record<string, unknown>;
      expect('labelName' in held).toBe(false);
      expect('labelIngredientsText' in held).toBe(false);
      expect(labelTextsOf(held)).toEqual({ labelName: '', labelIngredientsText: '' });
    }
  });

  test('the title is the typed one, else the recipe’s name in capitals', () => {
    expect(labelTitleOf({ name: 'Torta', labelName: '  TORTA DI|PROVA ' })).toBe('TORTA DI|PROVA');
    expect(labelTitleOf({ name: ' Torta di nocciole ', labelName: '  ' })).toBe('TORTA DI NOCCIOLE');
    expect(labelTitleOf({ name: 'Crème brûlée' })).toBe('CRÈME BRÛLÉE');
    expect(labelTitleOf(null)).toBe('');
  });

  test('a save sends a typed text trimmed and cut to the rules, an emptied one as null, and nothing it was not handed', () => {
    expect(labelTextPatchOf({ labelName: '  A  ', labelIngredientsText: '' })).toEqual({ labelName: 'A', labelIngredientsText: null });
    expect(labelTextPatchOf({ labelName: undefined })).toEqual({});
    expect(labelTextPatchOf({ labelName: 5 })).toEqual({});
    expect(labelTextPatchOf(null)).toEqual({});
    const long = labelTextPatchOf({ labelName: 'x'.repeat(500), labelIngredientsText: 'y'.repeat(5000) });
    expect(long.labelName).toHaveLength(LABEL_NAME_MAX);
    expect(long.labelIngredientsText).toHaveLength(LABEL_TEXT_MAX);
  });
});

describe('the editor’s two label boxes', () => {
  const recipe = normalizeStoredRecipe(STORED)!;

  test('⚠️ untouched, the stored texts go through as they are; typed, the typing goes', () => {
    const working = workingFrom(recipe);
    expect(labelNameText(working)).toBe('TORTA DI|PROVA');
    expect(labelIngredientsBoxText(working)).toBe('INGREDIENTI: farina di GRANO.');
    expect(cleanWorking(working)).toMatchObject({ labelName: 'TORTA DI|PROVA', labelIngredientsText: 'INGREDIENTI: farina di GRANO.' });
    const typed = { ...working, labelName: '', labelText: 'INGREDIENTI: acqua.' };
    expect(labelNameText(typed)).toBe('');
    expect(cleanWorking(typed)).toMatchObject({ labelName: '', labelIngredientsText: 'INGREDIENTI: acqua.' });
  });

  test('a new recipe has empty boxes and hands over no text until something is typed', () => {
    const clean = cleanWorking(workingFrom(null)) as unknown as Record<string, unknown>;
    expect('labelName' in clean).toBe(false);
    expect('labelIngredientsText' in clean).toBe(false);
  });

  test('⚠️ a duplicate takes the ingredients text but NOT the title, which names the original', () => {
    const copy = duplicateWorking(recipe, name => `${name} (copia)`);
    expect(labelIngredientsBoxText(copy)).toBe('INGREDIENTI: farina di GRANO.');
    expect(labelNameText(copy)).toBe('');
    expect('labelName' in cleanWorking(copy)).toBe(false);
  });

  test('the typing survives a trip through the navigation state', () => {
    const typed = { ...workingFrom(recipe), labelName: 'NUOVA', labelText: 'testo' };
    const back = restoreWorking(JSON.parse(JSON.stringify(typed)))!;
    expect(back.labelName).toBe('NUOVA');
    expect(back.labelText).toBe('testo');
    const older = restoreWorking({ name: 'x', rows: [{ row: {} }] })!;
    expect(older.labelName).toBeNull();
    expect(older.labelText).toBeNull();
  });
});

describe('the model chosen in config/labels', () => {
  test('only «logo» is the image label; anything else is the standard one', () => {
    expect(imageLabelChoice({ template: 'logo' }).template).toBe('logo');
    for (const odd of [null, undefined, {}, { template: 'Logo' }, { template: 'standard' }, { template: 1 }]) {
      expect(imageLabelChoice(odd as Record<string, unknown> | null).template).toBe('standard');
    }
  });

  test('⚠️ turned round unless somebody said otherwise (the owner’s script prints ^POI)', () => {
    expect(imageLabelChoice(null).rotate180).toBe(true);
    expect(imageLabelChoice({ rotate180: 'no' }).rotate180).toBe(true);
    expect(imageLabelChoice({ rotate180: false }).rotate180).toBe(false);
  });
});

describe('the stored logo', () => {
  const good = { png: 'data:image/png;base64,iVBORw0KGgo=', width: 1320, height: 331, bakery: 'b', updatedAt: 'x' };

  test('a logo the rules would let in is read with its size', () => {
    expect(asLabelLogo(good)).toEqual({ png: good.png, width: 1320, height: 331 });
  });

  test('⚠️ anything the rules would refuse reads as no logo, never as half a logo', () => {
    const bad: unknown[] = [
      null, 'x', { ...good, png: 'https://example.com/logo.png' }, { ...good, png: 'data:image/jpeg;base64,AAAA' },
      { ...good, png: 'data:image/png;base64,<svg>' }, { ...good, png: `data:image/png;base64,${'A'.repeat(400000)}` },
      { ...good, width: 1000 }, { ...good, height: 0 }, { ...good, height: 1921 }, { ...good, height: 10.5 }, { ...good, height: '9' },
    ];
    for (const value of bad) expect(asLabelLogo(value)).toBeNull();
  });
});
