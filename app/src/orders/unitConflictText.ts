// unitConflictText.ts — what the unit-conflict notice says (parity X7; js/orders/orders-main.js unitConflictMessage and
// unitConflictText). Pure: the translator and «now» are handed in.
//
// A line was already ordered from this supplier today in one unit, and the new order has it in another that cannot be added
// to it. Nothing is recorded; the notice names the lines and the unit each must stay in.
import { daySpoken, dayWhen } from '@mise/shared/day';
import { unitConflictList } from '@mise/shared/archive';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { dayTranslate } from './dayWords';

type Say = (key: MessageKey, params?: MessageParams) => string;

export interface ConflictLine {
  readonly name: string;
  // The unit already recorded: what the person must stay in.
  readonly unit: string;
  // Would writing «how many packs one case holds» on the card make the two addable? Then the notice says so.
  readonly fixable?: boolean;
}

// One supplier's clash with the record of one day.
export interface ConflictGroup {
  readonly supplierName: string;
  readonly date: string;
  readonly conflicts: readonly ConflictLine[];
}

// The refusal, plus — only when it would help — how to make the two units addable. Advice that cannot fix the line is worse
// than none.
function sentence(t: Say, day: string, list: string, conflicts: readonly ConflictLine[]): string {
  const text = t('ord.unitConflict', { day, list });
  return conflicts.some(c => c.fixable === true) ? `${text} ${t('ord.unitConflictHint')}` : text;
}

// The notice for what the confirm screen checked before it opened. `several`: more than one supplier was being recorded, so
// each clash is prefixed with WHO it is about (and with its day when the days differ) and, when `recording`, the notice says
// that nothing has been recorded yet. '' when nothing clashes.
export function unitConflictText(
  { groups, several, recording, now, t }:
  { groups: readonly ConflictGroup[]; several: boolean; recording: boolean; now: Date; t: Say },
): string {
  const found = groups.filter(group => group.conflicts.length > 0);
  const first = found[0];
  if (!first) return '';
  const dt = dayTranslate(t);
  const mixedDays = new Set(found.map(group => group.date)).size > 1;
  const list = !several
    ? unitConflictList(first.conflicts)
    : found.map(group => {
      const who = group.supplierName + (mixedDays ? ` (${daySpoken(group.date, now, dt)})` : '');
      return group.conflicts.map(c => `${who}: ${c.name} — ${c.unit}`).join(', ');
    }).join('; ');
  const text = sentence(t, dayWhen(first.date, now, dt), list, found.flatMap(group => group.conflicts));
  return several && recording ? `${text} ${t('ord.unitConflictNothingRecorded')}` : text;
}

// The notice when the write itself refused (another phone recorded in between): the store knows the lines' ids, not their
// units, so it names the lines only.
export function unitConflictOfLines({ date, names, now, t }: { date: string; names: readonly string[]; now: Date; t: Say }): string {
  return sentence(t, dayWhen(date, now, dayTranslate(t)), names.join(', '), []);
}
