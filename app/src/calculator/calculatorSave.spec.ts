import { describe, expect, it } from 'vitest';
import { getRecipeById, getTabProducts, normalizeConfig } from '@mise/shared/calculator-config';
import { logTimestamp } from '@mise/shared/log-time';
import { CLIENTS, FOCACCIA, SOURDOUGH } from '../testing/renderCalculator';
import { buildDoughVersion } from './calculatorSave';
import type { DoughInputs } from './calculatorSave';

// The version Confirm saves, without a screen: what is in it and that it is the current app's own text.

const NOW = new Date(2026, 9, 12, 9, 30).getTime();

function inputs(over: Partial<DoughInputs> = {}, extraConfig: Record<string, unknown> = {}): DoughInputs {
  const config = normalizeConfig({ clients: CLIENTS, recipes: [FOCACCIA, SOURDOUGH], ...extraConfig });
  const recipe = getRecipeById(config, 'focaccia')!;
  return {
    config,
    recipe,
    products: getTabProducts(config, 'focaccia'),
    qty: id => (id === 'roma::tray' ? 4 : id === 'sole::cheese' ? 1.5 : 0),
    extra: { enabled: true, text: '0.5', unit: 'kg' },
    totalG: 0,
    trays: 0,
    leaveningPct: 0.5,
    divisorN: 0,
    words: { occasionalClient: 'Occasional client', extraDough: 'Extra dough: ' },
    nowMs: NOW,
    ...over,
  };
}

describe('buildDoughVersion', () => {
  it('has one line per client x product, zeros included, with weight, kind and crate', () => {
    const version = buildDoughVersion(inputs());
    expect(version.items?.map(i => [i.clientName, i.name, i.qty])).toEqual([
      ['Cafe Roma', 'Focaccia tray', 4], ['Cafe Roma', 'Focaccia slab', 0], ['Cafe Roma', 'Brioche roll', 0],
      ['Bar Sole', 'Focaccia tray', 0], ['Bar Sole', 'Cheese by the kilo', 1.5],
    ]);
    expect(version.items?.[0]).toMatchObject({ id: 'tray', weightG: 500, kind: 'number', crate: { show: true, perBox: 10 } });
  });

  it('writes the time as the current app does, in English whatever the language', () => {
    expect(buildDoughVersion(inputs()).at).toEqual(logTimestamp(new Date(NOW)));
    expect(buildDoughVersion(inputs()).at).toEqual({ date: 'Monday 12 October', time: '9:30 AM' });
  });

  it('writes the grouped text with the kilos and the extra dough', () => {
    expect(buildDoughVersion(inputs()).text).toBe(
      'Cafe Roma:\n  Focaccia tray: 4 pz\nBar Sole:\n  Cheese by the kilo: 1.5 kg\nExtra dough: 0.5 kg',
    );
  });

  // The words follow the interface language, as the current app's js/log-model.js builds them with t().
  it('writes the extra dough word in the language it is given', () => {
    const italian = { occasionalClient: 'Cliente occasionale', extraDough: 'Impasto extra: ' };
    expect(buildDoughVersion(inputs({ words: italian })).text).toBe(
      'Cafe Roma:\n  Focaccia tray: 4 pz\nBar Sole:\n  Cheese by the kilo: 1.5 kg\nImpasto extra: 0.5 kg',
    );
  });

  it('builds the sheet from the same maths: the total, the extra dough, the knob', () => {
    const version = buildDoughVersion(inputs({ leaveningPct: 0.8 }));
    expect(version.sheet).toMatchObject({ total_g: 4 * 500 + 1500 + 500, extra_g: 500, param: { label: 'Yeast %', value: 0.8 } });
    const sum = version.sheet?.ingredients.reduce((s, i) => s + i.grams, 0);
    expect(sum).toBe(version.sheet?.total_g);
  });

  it('leaves the extra dough out when the recipe switched it off', () => {
    const version = buildDoughVersion(inputs({ extra: { enabled: false, text: '9', unit: 'kg' } }));
    expect(version.sheet?.extra_g).toBe(0);
    expect(version.text).not.toContain('Extra dough');
  });

  it('records the divisor with the products ticked and the crates picked', () => {
    const version = buildDoughVersion(inputs({ divisorN: 2 }, { divisorIncluded: { focaccia: ['tray'] } }));
    expect(version.sheet?.divisor).toMatchObject({ names: ['Focaccia tray'], total: 2000, n: 2, result: 1000 });
  });

  it('freezes the recipe it was made with', () => {
    const version = buildDoughVersion(inputs());
    expect(version.recipe).toMatchObject({
      id: 'focaccia', name: 'Focaccia', logic: 'orders', leaveningKey: 'yeast', leaveningDefaultPct: 0.5,
    });
    expect(version.recipe?.ingredients.map(i => i.key)).toEqual(['flour', 'water', 'salt', 'yeast']);
  });

  it('for a trays dough records the trays and the tray weight', () => {
    const config = normalizeConfig({ clients: CLIENTS, recipes: [SOURDOUGH] });
    const recipe = getRecipeById(config, 'sourdough')!;
    const version = buildDoughVersion(inputs({ config, recipe, products: [], extra: { enabled: false, text: '0', unit: 'kg' }, trays: '3' }));
    expect(version.sheet).toMatchObject({ total_g: 3600, trays: 3, trayWeight_g: 1200 });
    expect(version.recipe).toMatchObject({ trayWeight: 1200 });
  });

  it('a bad tray count gives a zero dough, never NaN', () => {
    const config = normalizeConfig({ clients: [], recipes: [SOURDOUGH] });
    const recipe = getRecipeById(config, 'sourdough')!;
    const version = buildDoughVersion(inputs({ config, recipe, products: [], trays: 'abc' }));
    expect(version.sheet?.total_g).toBe(0);
  });

  it('is the log version without its kind: the store decides create or edit', () => {
    expect(buildDoughVersion(inputs())).not.toHaveProperty('kind');
    expect(buildDoughVersion(inputs())).toMatchObject({ calculatedBy: '', occasional: [] });
  });
});
