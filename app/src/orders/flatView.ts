// flatView.ts — what the flat view («by ingredient», step 3f-8b) draws, from the lens. Pure: no React, no Firebase.
//
// The rows are the shared `flatRows` (ingredient-search.ts, the port of the current app's), run on the lines AS THEY ARE ORDERED NOW
// (`lens.lines`, overrides applied), so each ingredient appears once, under the supplier it is ordered from this time. The one
// difference from the current app (decision F-2, docs/parity/orders.md): the lines switched off are not left out; `notInUseLines`
// returns them, for a folded group at the foot, found and ordered by the very same rules.

import { flatRows } from '@mise/shared/ingredient-search';
import { wholeNumber } from '@mise/shared/archive';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { DraftEntries } from './draftSync';
import type { LensIngredient, OrderRow, OrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';

export interface FlatLine {
  // The same row type a supplier's screen draws, so the line is the same component. Never `elsewhere` here.
  readonly row: OrderRow;
  // The supplier whose order the line is in now: what an edit is written for.
  readonly supplier: StoredDoc;
  readonly supplierName: string;
  // The letter of the divider drawn before this row ('' when the row continues a run). Only on the main rows.
  readonly letter: string;
}

export interface FlatView {
  readonly rows: readonly FlatLine[];
  // Every orderable line in use: the «All (N)» count and what the count line says it is a share of.
  readonly total: number;
}

interface Scope {
  readonly query: string;
  // A FROZEN set of ingredient ids (the «Ordering» filter), or null for everything.
  readonly only: ReadonlySet<string> | null;
}

function lineOf(lens: OrdersLens, ingredient: LensIngredient, supplierName: string, letter: string): FlatLine | null {
  const supplier = lens.supplierById(ingredient.supplierId ?? '');
  if (supplier === undefined) return null;
  const usual = ingredient.usualSupplierId;
  return {
    row: { ingredient, elsewhere: false, elsewhereLabel: '', usualLabel: usual ? supplierLabel(lens.supplierById(usual)) || '' : '' },
    supplier,
    supplierName,
    letter,
  };
}

export function flatView(lens: OrdersLens, { query, only }: Scope): FlatView {
  const { rows, total } = flatRows({ ingredients: lens.lines, suppliers: lens.suppliers, query, only });
  const byId = new Map(lens.lines.map(line => [line.id, line]));
  const out: FlatLine[] = [];
  for (const row of rows) {
    const ingredient = byId.get(row.ingredient.id as string);
    const line = ingredient === undefined ? null : lineOf(lens, ingredient, row.supplierName, row.letter ?? '');
    if (line !== null) out.push(line);
  }
  return { rows: out, total };
}

// The lines switched off («Not in use»), found by the same search and the same frozen set, A→Z by the same label and tie-break.
// `flatRows` leaves them out, so they are handed to it as if they were in use and mapped back to the real line afterwards.
export function notInUseLines(lens: OrdersLens, { query, only }: Scope): readonly FlatLine[] {
  const off = lens.lines.filter(line => (line as { active?: unknown }).active === false);
  if (off.length === 0) return [];
  const byId = new Map(off.map(line => [line.id, line]));
  const { rows } = flatRows({ ingredients: off.map(line => ({ ...line, active: true })), suppliers: lens.suppliers, query, only });
  const out: FlatLine[] = [];
  for (const row of rows) {
    const ingredient = byId.get(row.ingredient.id as string);
    const line = ingredient === undefined ? null : lineOf(lens, ingredient, row.supplierName, '');
    if (line !== null) out.push(line);
  }
  return out;
}

// The ids of the lines with a quantity now, switched-off ones included (a line switched off with a quantity is in the order,
// decision T10). The «Ordering» filter freezes this set when it is chosen.
export function orderedIds(lens: OrdersLens, entries: DraftEntries): ReadonlySet<string> {
  return new Set(lens.lines.filter(line => wholeNumber(entries[line.id]?.qty) > 0).map(line => line.id));
}
