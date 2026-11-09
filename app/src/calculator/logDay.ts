import type { DayLabelParts } from '@mise/shared/log-model';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';

type Say = (key: MessageKey, params?: MessageParams) => string;

// A day, named by how far it is from today (0 today, 1 tomorrow, -1 yesterday, then «in N days» / «N days ago»).
// `inSentence` is the form that sits inside a sentence («today», «in 3 days»): never a lower-cased first form —
// whether a word loses its capital is the translator's business (the current app's `dayName`).
function dayName(say: Say, diff: number, inSentence = false): string {
  if (diff === 0) return say(inSentence ? 'day.today.inSentence' : 'day.today');
  if (diff === 1) return say(inSentence ? 'day.tomorrow.inSentence' : 'day.tomorrow');
  if (diff === -1) return say(inSentence ? 'day.yesterday.inSentence' : 'day.yesterday');
  if (diff > 1) return say(inSentence ? 'day.inNDays.inSentence' : 'day.inNDays', { n: diff });
  return say(inSentence ? 'day.nDaysAgo.inSentence' : 'day.nDaysAgo', { n: -diff });
}

// The words of a log's day badge, from the pure half in shared/log-model (`dayLabelParts`). A log with no usable
// creation time says the literal day it was saved for. A log made on another day than the one it is for says both
// («Yesterday for today»); the colour (the tone) follows the day the dough is FOR.
export function dayText(say: Say, parts: DayLabelParts): string {
  if (parts.text.kind === 'stored') return say(parts.text.forDay === 'tomorrow' ? 'day.tomorrow' : 'day.today');
  const { made, target } = parts.text;
  return made === target
    ? dayName(say, made)
    : say('day.madeFor', { made: dayName(say, made), target: dayName(say, target, true) });
}
