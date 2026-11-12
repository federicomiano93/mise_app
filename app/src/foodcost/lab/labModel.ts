import { currentProduct, productCooking, productionCost } from '@mise/shared/foodcost-model';
import type { CostTables, LineUnit, Product, ProductComponent, SaleUnit } from '@mise/shared/foodcost-model';
import { kilosFromTyped } from '@mise/shared/line-quantity';
import { followsTotal } from '../productEditorModel';
import { summaryExtras } from '../summaryExtras';
import { elapsedMs, timerMinutes } from './labClock';
import { parseTyped, pressKey, typedText } from './keypadRules';

// Lab mode («Modalità laboratorio»): the pure heart of the screen — the draft of a production in progress, how it moves, and the
// product it would make. No DOM, no storage, no React, so every rule is asserted under Node.
//
// ⚠️ NOTHING IS ADDED UP HERE. Every figure the lab shows is read from the SAME shared functions the card reads (productCooking,
// productionCost, summaryExtras), handed a COPY of the product with today's weights laid on it (applyLab). The lab can never
// disagree with the card, because it has no sums of its own.

export const LAB_STEPS = ['start', 'ingredients', 'raw', 'oven', 'cooked', 'pieces', 'time', 'result'] as const;
export type LabStepId = (typeof LAB_STEPS)[number];

// The steps this product goes through: «Pezzi ottenuti» only when it is sold by the piece, or in a pack counted in pieces.
export function soldByPieces(product: Pick<Product, 'sellingMode' | 'packUnit'>): boolean {
  return product.sellingMode === 'piece' || (product.sellingMode === 'pack' && product.packUnit === 'pcs');
}

export function stepsFor(product: Pick<Product, 'sellingMode' | 'packUnit'>): LabStepId[] {
  return LAB_STEPS.filter(step => step !== 'pieces' || soldByPieces(product));
}

export const MAX_PEOPLE = 20;
// The rules' ceiling for the minutes of a batch (shared/product-limits).
export const MAX_MINUTES = 100000;

// A line of «Composto da» as the lab saw it when it started, and which line of the saved product it stands for.
export type LabLineRef =
  | { kind: 'recipe'; recipeId: string }
  | { kind: 'ingredient'; ingredientId: string; unit: LineUnit };

// `planned` is in the line's weighing unit — grams, or pieces for a piece line — and null for a line added in the lab.
export interface LabLine {
  key: string;
  ref: LabLineRef;
  planned: number | null;
  added: boolean;
}

export interface LabDraft {
  // null until «Inizia» is pressed: nothing is stored before the clock runs.
  startedAt: number | null;
  step: LabStepId;
  lines: LabLine[];
  // The text typed in each line's «Pesato» box.
  weighed: Record<string, string>;
  ticked: Record<string, boolean>;
  // The text of the extra-large fields: null = untouched (the box shows its preset).
  raw: string | null;
  cooked: string;
  pieces: string | null;
  minutes: string | null;
  // The labour time as the timer read when the person left «Tempo e persone» without typing one.
  minutesFrozen: number | null;
  people: number;
}

export type FieldId = 'raw' | 'cooked' | 'pieces' | 'minutes' | `line:${string}`;

export const lineField = (key: string): FieldId => `line:${key}`;

export const clampPeople = (value: unknown): number => {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 1;
  return Math.min(MAX_PEOPLE, Math.max(1, n));
};

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// «g» for everything weighed, «pcs» for a line counted in pieces.
export function weighingUnit(line: LabLine): 'g' | 'pcs' {
  return line.ref.kind === 'ingredient' && line.ref.unit === 'pcs' ? 'pcs' : 'g';
}

function plannedOf(component: ProductComponent): number {
  if (component.kind !== 'ingredient') return round4(component.qtyKg * 1000);
  return component.unit === 'kg' ? round4(component.qty * 1000) : component.qty;
}

function refOf(component: ProductComponent): LabLineRef {
  return component.kind === 'ingredient'
    ? { kind: 'ingredient', ingredientId: component.ingredientId, unit: component.unit }
    : { kind: 'recipe', recipeId: component.recipeId };
}

function matches(ref: LabLineRef, component: ProductComponent): boolean {
  if (ref.kind === 'recipe') return component.kind !== 'ingredient' && component.recipeId === ref.recipeId;
  return component.kind === 'ingredient' && component.ingredientId === ref.ingredientId && component.unit === ref.unit;
}

export function newDraft(product: Product): LabDraft {
  return {
    startedAt: null,
    step: 'start',
    lines: product.components.map((component, index) => ({ key: `l${index}`, ref: refOf(component), planned: plannedOf(component), added: false })),
    weighed: {},
    ticked: {},
    raw: null,
    cooked: '',
    pieces: null,
    minutes: null,
    minutesFrozen: null,
    people: clampPeople(product.labourPeople ?? 1),
  };
}

export function startDraft(draft: LabDraft, now: number): LabDraft {
  return { ...draft, startedAt: now, step: 'ingredients' };
}

// ── Ticks and typing ────────────────────────────────────────────────────────────────────────────

// Ticking a line without typing means «I put the planned weight»: the planned value is filled in, so what is saved is what is shown.
// A line added in the lab has no planned weight: ticking it with nothing typed does nothing (there is nothing to confirm).
export function toggleTick(draft: LabDraft, key: string): LabDraft {
  const line = draft.lines.find(candidate => candidate.key === key);
  if (!line) return draft;
  if (draft.ticked[key] === true) return { ...draft, ticked: { ...draft.ticked, [key]: false } };
  let weighed = draft.weighed;
  if (parseTyped(weighed[key]) === null) {
    if (line.planned === null) return draft;
    weighed = { ...weighed, [key]: typedText(line.planned) };
  }
  return { ...draft, weighed, ticked: { ...draft.ticked, [key]: true } };
}

// The next line still to do after `key` (wrapping to the first one), or null when every line is ticked.
export function nextUnticked(draft: LabDraft, key: string): string | null {
  const from = draft.lines.findIndex(line => line.key === key);
  const order = [...draft.lines.slice(from + 1), ...draft.lines.slice(0, Math.max(0, from))];
  return order.find(line => draft.ticked[line.key] !== true)?.key ?? null;
}

export function addLine(draft: LabDraft, ref: LabLineRef): { draft: LabDraft; key: string } {
  const used = draft.lines.map(line => Number(line.key.slice(1))).filter(Number.isFinite);
  const key = `a${(used.length === 0 ? 0 : Math.max(...used)) + 1}`;
  return { draft: { ...draft, lines: [...draft.lines, { key, ref, planned: null, added: true }] }, key };
}

// What the boxes show when untouched. The keypad's «back» edits this text; a digit starts afresh.
export interface Presets { raw: string; pieces: string; minutes: string }

const textOf = (draft: LabDraft, field: FieldId): string | null => {
  if (field === 'raw') return draft.raw;
  if (field === 'cooked') return draft.cooked;
  if (field === 'pieces') return draft.pieces;
  if (field === 'minutes') return draft.minutes;
  return draft.weighed[field.slice(5)] ?? null;
};

export function typeInto(draft: LabDraft, field: FieldId, key: string, presets: Presets): LabDraft {
  const line = field.startsWith('line:') ? draft.lines.find(candidate => candidate.key === field.slice(5)) : undefined;
  // Pieces, minutes and a line counted in pieces are whole numbers: the comma does nothing there.
  const whole = field === 'pieces' || field === 'minutes' || (line !== undefined && weighingUnit(line) === 'pcs');
  const current = textOf(draft, field);
  const preset = field === 'raw' ? presets.raw : field === 'pieces' ? presets.pieces : field === 'minutes' ? presets.minutes : '';
  // An untouched box showing a preset: a digit REPLACES it (the keypad is for typing what was weighed), «back» eats from it.
  const base = current ?? (key === 'back' ? preset : '');
  const next = pressKey(base, key, !whole);
  if (next === current) return draft;
  if (field === 'raw') return { ...draft, raw: next };
  if (field === 'cooked') return { ...draft, cooked: next };
  if (field === 'pieces') return { ...draft, pieces: next };
  if (field === 'minutes') return { ...draft, minutes: next };
  return { ...draft, weighed: { ...draft.weighed, [field.slice(5)]: next } };
}

export function setPeople(draft: LabDraft, people: number): LabDraft {
  return { ...draft, people: clampPeople(people) };
}

// Moving between steps. Leaving «Tempo e persone» with no minutes typed freezes the timer's reading there (the figure the person
// saw), so the Result and the Save do not keep growing under their eyes; coming back to the step lets the timer run again.
export function goToStep(draft: LabDraft, step: LabStepId, now: number): LabDraft {
  if (step === draft.step) return draft;
  let next: LabDraft = { ...draft, step };
  if (draft.step === 'time' && draft.minutes === null && draft.startedAt !== null) {
    next = { ...next, minutesFrozen: timerMinutes(elapsedMs(draft.startedAt, now)) };
  }
  if (step === 'time') next = { ...next, minutesFrozen: null };
  return next;
}

// ── The product with today's weights ────────────────────────────────────────────────────────────

function withGrams(component: ProductComponent, value: number): ProductComponent {
  if (component.kind !== 'ingredient') return { ...component, qtyKg: kilosFromTyped(value, 'g') };
  // A kilo line gets kilos (6 decimals at most), a gram or piece line keeps its own unit.
  return { ...component, qty: component.unit === 'kg' ? kilosFromTyped(value, 'g') : round4(value) };
}

// The labour minutes in force: typed, else the frozen reading, else the timer now. Whole minutes, 1 to the rules' ceiling.
export function minutesOf(draft: LabDraft, now: number): number {
  const typed = parseTyped(draft.minutes);
  const value = typed !== null && typed > 0 ? typed : (draft.minutesFrozen ?? timerMinutes(elapsedMs(draft.startedAt, now)));
  return Math.min(MAX_MINUTES, Math.max(1, Math.round(value)));
}

// The raw weight as the box shows it: the text typed, else the lines' total at one decimal.
export function rawShown(draft: LabDraft, totalGrams: number): string {
  if (draft.raw !== null && draft.raw !== '') return draft.raw;
  return totalGrams > 0 ? typedText(Math.round(totalGrams * 10) / 10) : '';
}

// The LATEST saved product with the lab's weights laid on it. Used for the live figures AND for the save, so they are the same thing.
//  - lines are matched by what they are (the recipe, or the ingredient and its unit; the nth of a kind to the nth), because a saved
//    line has no id of its own: a line deleted elsewhere meanwhile is simply not there to receive its weight (the other change wins);
//    a line added elsewhere keeps its saved amount;
//  - a line never weighed (not ticked, nothing typed) keeps its saved amount;
//  - a line added in the lab with nothing weighed is dropped (a line of 0 means nothing);
//  - «Crudo» is stored only when it differs from the lines' total (the card's own rule: empty = follows the total);
//  - «Pezzi» only when entered, and only for a product sold by the piece or in pieces;
//  - «Cotto» empty = not weighed = no loss (an old cooked weight against a new raw one would make a false loss).
export function applyLab(latest: Product, draft: LabDraft, tables: CostTables, now: number): Product {
  const components = [...latest.components];
  const taken = new Set<number>();
  const added: ProductComponent[] = [];
  for (const line of draft.lines) {
    const value = parseTyped(draft.weighed[line.key]);
    if (line.added) {
      if (value !== null && value > 0 && line.ref.kind === 'ingredient') {
        added.push({
          kind: 'ingredient',
          ingredientId: line.ref.ingredientId,
          qty: line.ref.unit === 'kg' ? kilosFromTyped(value, 'g') : round4(value),
          unit: line.ref.unit,
        });
      }
      continue;
    }
    const index = components.findIndex((component, i) => !taken.has(i) && matches(line.ref, component));
    if (index < 0) continue;
    taken.add(index);
    const saved = components[index];
    if (value !== null && saved) components[index] = withGrams(saved, value);
  }
  const base: Product = { ...latest, components: [...components, ...added] };

  const total = productCooking(base, tables).rawTotalKg * 1000;
  const typedRaw = parseTyped(draft.raw);
  const rawApart = typedRaw !== null && typedRaw > 0 && !followsTotal(draft.raw ?? '', total);
  const cooked = parseTyped(draft.cooked);
  const pieces = parseTyped(draft.pieces);
  return {
    ...base,
    rawGrams: rawApart ? typedRaw : null,
    cookedGrams: cooked !== null && cooked > 0 ? cooked : null,
    piecesPerBatch: soldByPieces(latest) && pieces !== null && pieces > 0 ? pieces : latest.piecesPerBatch,
    labourMinutes: minutesOf(draft, now),
    labourPeople: clampPeople(draft.people),
  };
}

// How many lines of «Composto da» the save changes: a different amount, or a line added.
export function changedLineCount(before: Product, after: Product): number {
  let changed = Math.max(0, after.components.length - before.components.length);
  before.components.forEach((component, index) => {
    const now = after.components[index];
    if (!now) return;
    const was = component.kind === 'ingredient' ? component.qty : component.qtyKg;
    const is = now.kind === 'ingredient' ? now.qty : now.qtyKg;
    if (Math.abs(was - is) > 1e-9) changed += 1;
  });
  return changed;
}

export interface LabNumbers {
  product: Product;
  // The lines' total, in grams (what «Impasto crudo» is preset with).
  totalGrams: number;
  // The raw weight in force: the one typed apart, else the total.
  rawGrams: number;
  cookedGrams: number | null;
  lossPct: number | null;
  heavier: boolean;
  // 1 kg of cooked dough, the dough only, as the card's summary reads it.
  perKg: number | null;
  perKgPartial: boolean;
  // What one unit sold costs to make, without and with the work.
  unit: SaleUnit | null;
  unitCost: number | null;
  totalUnitCost: number | null;
  // A line has no cost: every figure above is too LOW.
  partial: boolean;
  pieces: number | null;
  minutes: number;
  people: number;
  changedLines: number;
}

// Every figure of the lab for the draft as it stands: the lines' total, the loss, the cost of a kilo and of a unit.
export function labNumbers(latest: Product, draft: LabDraft, tables: CostTables, now: number): LabNumbers {
  const product = applyLab(latest, draft, tables, now);
  const cooking = productCooking(product, tables);
  const cost = productionCost(product, tables);
  const extras = summaryExtras(product, tables);
  return {
    product,
    totalGrams: cooking.rawTotalKg * 1000,
    rawGrams: cooking.rawKg * 1000,
    cookedGrams: product.cookedGrams,
    lossPct: cooking.lossPct,
    heavier: cooking.heavier,
    perKg: extras?.perKg ?? null,
    perKgPartial: extras?.perKgPartial ?? false,
    unit: cost.unit,
    unitCost: cost.unitCost,
    totalUnitCost: cost.totalUnitCost,
    partial: cost.partial,
    pieces: soldByPieces(product) ? product.piecesPerBatch : null,
    minutes: product.labourMinutes ?? 1,
    people: product.labourPeople ?? 1,
    changedLines: changedLineCount(latest, product),
  };
}

// The saved product the lab works from: the SAME converted view the card reads (a product saved before the switch is read in its new
// shape, and the save writes it so).
export function baseProduct(stored: Product | null | undefined, tables: CostTables): Product | null {
  return stored ? currentProduct(stored, tables) : null;
}
