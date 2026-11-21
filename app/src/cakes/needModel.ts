import type { ExportModel, ExportRowInput } from '@mise/shared/recipe-export';
import type { CakeNeeds, NeedIngredient } from '@mise/shared/cake-model';
import { fcNumber } from '@mise/shared/fc-number';
import type { Money } from '@mise/shared/currency';
import { localNumber } from '@mise/shared/currency';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

// «What you need», as words and numbers: the dialog, the sheet that prints and the PDF all read THESE rows, so the three can never
// say different things. The sums come from cakeNeeds (shared/cake-model); this file only writes them down.

type Translate = (key: MessageKey, params?: MessageParams) => string;

export type NeedTab = 'semi' | 'ingredients';
export const MIN_CAKES = 1;
export const MAX_CAKES = 99;

export interface SemiRowText {
  key: string;
  name: string;
  ready: string;
  loss: string;
  // «—» while the card's weights say nothing.
  prepare: string;
}

export interface SemiTable {
  rows: SemiRowText[];
  totalReady: string;
  totalPrepare: string;
}

export interface IngredientRowText {
  key: string;
  name: string;
  amount: string;
  // The cards it comes from, «Crema · Pan di Spagna».
  from: string;
}

const gramsOf = (kg: number): number => Math.round(kg * 1000);

// Whole grams, with the venue's own grouping: «1.250 g».
export function gramsText(kg: number, money: Money): string {
  return `${localNumber(String(gramsOf(kg)), money)} g`;
}

function lossText(pct: number | null, money: Money): string {
  if (pct === null || !(pct > 0)) return '—';
  return `${localNumber(String(Math.round(pct * 10) / 10), money)}%`;
}

export function semiTable(needs: CakeNeeds, money: Money): SemiTable {
  const known = needs.semis.filter(semi => semi.prepareKg !== null);
  return {
    rows: needs.semis.map(semi => ({
      key: semi.productId,
      name: semi.name,
      ready: gramsText(semi.readyKg, money),
      loss: lossText(semi.lossPct, money),
      prepare: semi.prepareKg === null ? '—' : gramsText(semi.prepareKg, money),
    })),
    totalReady: gramsText(needs.semis.reduce((sum, semi) => sum + semi.readyKg, 0), money),
    totalPrepare: gramsText(known.reduce((sum, semi) => sum + (semi.prepareKg ?? 0), 0), money),
  };
}

// A weight in kilos as a person weighs it: whole grams under a kilo («750 g»), kilos with two decimals from it («1,25 kg»); a speck
// under one gram says so rather than reading «0 g».
export function kgText(kg: number, money: Money): string {
  if (gramsOf(kg) >= 1000) return `${localNumber(kg.toFixed(2), money)} kg`;
  return kg > 0 && gramsOf(kg) === 0 ? '< 1 g' : gramsText(kg, money);
}

// An ingredient's amount: a weight and/or pieces.
export function ingredientAmount(row: NeedIngredient, t: Translate, money: Money): string {
  const parts: string[] = [];
  if (row.kg !== null) parts.push(kgText(row.kg, money));
  if (row.pcs !== null) parts.push(t('fc.perKg.pieces', { n: fcNumber(row.pcs, money) }));
  return parts.length === 0 ? '—' : parts.join(' · ');
}

export function ingredientTable(needs: CakeNeeds, t: Translate, money: Money): IngredientRowText[] {
  return needs.ingredients.map(row => ({
    key: row.key,
    name: row.name,
    amount: ingredientAmount(row, t, money),
    from: [...row.from, ...(row.unpriced ? [t('cakes.row.noPrice')] : [])].join(' · '),
  }));
}

// «The total leaves out the rows with no weight.»: under the semi-finished total (screen, sheet) when some row has no weight, else null.
export function totalNoteText(tab: NeedTab, needs: CakeNeeds, t: Translate): string | null {
  if (tab !== 'semi' || !needs.semis.some(semi => semi.prepareKg === null)) return null;
  return t('cakes.need.totalLeavesOut');
}

// «Non aperte: A, B — …»: the cards cakeNeeds could not open into ingredients (they have no price yet). Null when there are none.
export function notOpenedText(needs: CakeNeeds, t: Translate): string | null {
  const names = needs.notOpened.map(card => card.name).filter(name => name !== '');
  if (needs.notOpened.length === 0) return null;
  return t('cakes.need.notOpened', { n: needs.notOpened.length, names: names.join(', ') });
}

// «Cosa serve · Torta di prova × 2»: the dialog's title, the sheet's heading and the PDF's name. A cake with no name yet has only the
// words and the count.
export function needTitle(t: Translate, cakeName: string, count: number): string {
  const name = cakeName.trim();
  return `${t('cakes.need.title')}${name === '' ? '' : ` · ${name}`} × ${count}`;
}

// The Total's label in the PDF: the word, and the note when the total leaves rows out (the model has no footnote of its own).
export function totalLabelText(tab: NeedTab, needs: CakeNeeds, t: Translate): string {
  const note = totalNoteText(tab, needs, t);
  return note === null ? t('cat.total') : `${t('cat.total')} · ${note}`;
}

// ⚠️ THE PDF MODEL IS THE ONE TAB THE PERSON SEES. A row prints «name ..... amount»: the semi-finished's name carries what is ready,
// and the amount is what to PREPARE (the Total adds those up); an ingredient weighed in kilos prints in kilos with the screen's own
// number, one under a kilo in whole grams, pieces as pieces (they weigh nothing in the Total).
export function needExportModel(
  tab: NeedTab, needs: CakeNeeds, t: Translate, money: Money, cakeName: string, count: number,
): ExportModel {
  const rows: ExportRowInput[] = [];
  if (tab === 'semi') {
    for (const semi of needs.semis) {
      const ready = `${semi.name} · ${t('cakes.need.readyShort', { g: gramsText(semi.readyKg, money) })}`;
      // ⚠️ A card with no weight prints «—» and counts for nothing, as on screen: the Total says it leaves such rows out.
      rows.push(semi.prepareKg === null
        ? { name: ready, value: 0, unit: '', factor: 1, decimals: 0, text: '—' }
        : { name: ready, value: gramsOf(semi.prepareKg), unit: 'g', factor: 1, decimals: 0 });
    }
  } else {
    for (const row of needs.ingredients) {
      if (row.kg !== null) {
        const whole = gramsOf(row.kg) >= 1000;
        rows.push(whole
          ? { name: row.name, value: row.kg, unit: 'kg', factor: 1000, decimals: 2, text: localNumber(row.kg.toFixed(2), money) }
          : { name: row.name, value: gramsOf(row.kg), unit: 'g', factor: 1, decimals: 0 });
      }
      if (row.pcs !== null) {
        rows.push({ name: row.name, value: row.pcs, unit: t('cakes.pack.pcs'), factor: 0, decimals: 2, text: fcNumber(row.pcs, money) });
      }
    }
  }
  return { name: needTitle(t, cakeName, count), rows };
}
