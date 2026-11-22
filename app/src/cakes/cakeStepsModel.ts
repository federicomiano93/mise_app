// cakeStepsModel.ts — the guided steps of a cake's editor, pure (no React): which step is open, what a part's figures are for its label
// and its closed row, how a typed search matches a name. It is UI state only: the editor keeps it in the form and NEVER saves it.
//
// The order is the order a cake is built in (base first, decoration last), the reverse of CAKE_PARTS (which runs top to bottom, like the
// drawing's labels). A sixth step, «Cost and price», comes after the five.

import { CAKE_PARTS } from '@mise/shared/cake-model';
import type { CakeLineCost, CakePart } from '@mise/shared/cake-model';
import { normalizeSearchText } from '@mise/shared/catalogue-model';

export const STEP_PARTS: readonly CakePart[] = [...CAKE_PARTS].reverse();

export type StepKey = CakePart | 'cost';
export const STEP_KEYS: readonly StepKey[] = [...STEP_PARTS, 'cost'];

// «1» to «6».
export function stepNumber(key: StepKey): number {
  return STEP_KEYS.indexOf(key) + 1;
}

// A new cake starts on the first step; a saved one opens with every step closed (its closed rows already say what is in it).
export function startStep(saved: boolean): StepKey | null {
  return saved ? null : (STEP_PARTS[0] ?? null);
}

// A tap on a step's title: it opens, and only one is open at a time; a tap on the open one closes it.
export function toggleStep(open: StepKey | null, key: StepKey): StepKey | null {
  return open === key ? null : key;
}

// ── What a part of one tier holds, for its label and its closed row ───────────────────────────────

export interface PartFigures {
  // The grams the part uses (typed, or the rule's), all its cards together.
  grams: number;
  // The raw-material cost of all its cards; null when any of them has no price (a partial sum would be too low).
  materials: number | null;
  // A card with no grams yet (no rule, nothing typed): the screen asks for them instead of showing «0 g».
  missingGrams: boolean;
}

export const partKey = (tier: number, part: CakePart): string => `${String(tier)}|${part}`;

// The figures of every (tier, part) that has a card, from the cake's line costs.
export function partFigures(costs: readonly CakeLineCost[]): Map<string, PartFigures> {
  const out = new Map<string, PartFigures>();
  for (const cost of costs) {
    const key = partKey(cost.line.tier, cost.line.part);
    const before = out.get(key);
    out.set(key, {
      grams: (before?.grams ?? 0) + cost.line.grams,
      materials: before === undefined ? cost.materials : before.materials === null || cost.materials === null ? null : before.materials + cost.materials,
      missingGrams: (before?.missingGrams ?? false) || cost.line.missing,
    });
  }
  return out;
}

// ── Searching a name ──────────────────────────────────────────────────────────────────────────────

// A letter as the search compares it: without accents, lower case. One character in, one string out, so a position in the result is
// a position in the name.
const fold = (char: string): string => char.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export interface Span { text: string; match: boolean }

// The name cut into the stretches that are the typed letters (match) and the rest, accents and capitals ignored — what the search
// box highlights. An empty search, or letters the name does not hold, is one stretch with no match.
export function matchSpans(name: string, query: string): Span[] {
  const wanted = normalizeSearchText(query);
  if (wanted === '' || name === '') return [{ text: name, match: false }];
  let folded = '';
  const from: number[] = [];
  [...name].forEach((char, index) => {
    const letters = fold(char);
    for (let i = 0; i < letters.length; i += 1) from.push(index);
    folded += letters;
  });
  const at = folded.indexOf(wanted);
  if (at < 0) return [{ text: name, match: false }];
  const chars = [...name];
  const start = from[at] as number;
  const end = (from[at + wanted.length - 1] as number) + 1;
  const spans: Span[] = [
    { text: chars.slice(0, start).join(''), match: false },
    { text: chars.slice(start, end).join(''), match: true },
    { text: chars.slice(end).join(''), match: false },
  ];
  return spans.filter(span => span.text !== '');
}

// The options a search leaves: the ones whose name holds the typed letters (all of them for an empty search), in their order.
export function filterByName<T extends { name: string }>(options: readonly T[], query: string): T[] {
  const wanted = normalizeSearchText(query);
  return wanted === '' ? [...options] : options.filter(option => normalizeSearchText(option.name).includes(wanted));
}
