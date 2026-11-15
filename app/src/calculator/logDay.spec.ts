import { describe, expect, it } from 'vitest';
import type { DayLabelParts } from '@mise/shared/log-model';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { it as italian } from '../i18n/it';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { dayText } from './logDay';

const english = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const italiano = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);
const relative = (made: number, target: number): DayLabelParts => ({ tone: 'today', text: { kind: 'relative', made, target } });

describe('the words of a log\'s day badge', () => {
  it.each([
    [0, 0, 'Today'],
    [1, 1, 'Tomorrow'],
    [-1, -1, 'Yesterday'],
    [3, 3, 'In 3 days'],
    [1, 1, 'Tomorrow'],
    [-4, -4, '4 days ago'],
    [-1, 0, 'Yesterday for today'],
    [-2, 0, '2 days ago for today'],
    [0, 1, 'Today for tomorrow'],
    [-1, 1, 'Yesterday for tomorrow'],
    [0, 3, 'Today for in 3 days'],
  ])('made %i, for %i → %s', (made, target, expected) => {
    expect(dayText(english, relative(made, target))).toBe(expected);
  });

  it('says one day, not «1 days»', () => {
    expect(dayText(english, relative(-3, 1))).toBe('3 days ago for tomorrow');
    expect(dayText(english, relative(1, 2))).toBe('Tomorrow for in 2 days');
  });

  it('says the literal day when the log has no usable creation time', () => {
    expect(dayText(english, { tone: 'today', text: { kind: 'stored', forDay: 'today' } })).toBe('Today');
    expect(dayText(english, { tone: 'tomorrow', text: { kind: 'stored', forDay: 'tomorrow' } })).toBe('Tomorrow');
  });

  it('speaks Italian, the day inside the sentence in its own form', () => {
    expect(dayText(italiano, relative(0, 0))).toBe('Oggi');
    expect(dayText(italiano, relative(-1, 0))).toBe('Ieri per oggi');
    expect(dayText(italiano, relative(0, 1))).toBe('Oggi per domani');
    expect(dayText(italiano, relative(2, 2))).toBe('Fra 2 giorni');
    expect(dayText(italiano, relative(-1, 5))).toBe('Ieri per fra 5 giorni');
    expect(dayText(italiano, relative(-5, -5))).toBe('5 giorni fa');
  });
});
