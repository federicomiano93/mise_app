import { describe, expect, it } from 'vitest';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { unitConflictOfLines, unitConflictText } from './unitConflictText';

const sayEn = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const sayIt = (key: MessageKey, params?: MessageParams) => format('it', italian[key], params);

const NOW = new Date(2026, 9, 28, 10, 0, 0);
const TODAY = '2026-10-28';
const YESTERDAY = '2026-10-27';
const FLOUR = { name: 'Flour 25kg', unit: 'carton', fixable: false };
const YEAST = { name: 'Yeast', unit: 'bag', fixable: false };

describe('unitConflictText', () => {
  it('names one supplier’s lines with the unit each must stay in, and the day', () => {
    const text = unitConflictText({
      groups: [{ supplierName: 'Alpine', date: TODAY, conflicts: [FLOUR, YEAST] }],
      several: false, recording: true, now: NOW, t: sayEn,
    });
    expect(text).toBe('Already ordered from this supplier today: Flour 25kg — carton, Yeast — bag. To add more, order it in the same unit.');
  });

  it('says it in Italian', () => {
    const text = unitConflictText({
      groups: [{ supplierName: 'Alpine', date: TODAY, conflicts: [FLOUR] }],
      several: false, recording: true, now: NOW, t: sayIt,
    });
    expect(text).toBe('Già ordinato a questo fornitore oggi: Flour 25kg — carton. Per aggiungerne, ordinalo nella stessa unità.');
  });

  it('adds the hint only when a line can be fixed on its card', () => {
    const fixable = { ...FLOUR, fixable: true };
    const group = (c: typeof FLOUR) => ({ supplierName: 'Alpine', date: TODAY, conflicts: [c] });
    expect(unitConflictText({ groups: [group(fixable)], several: false, recording: false, now: NOW, t: sayEn }))
      .toContain('Or write on the ingredient card how many packs one case holds');
    expect(unitConflictText({ groups: [group(FLOUR)], several: false, recording: false, now: NOW, t: sayEn }))
      .not.toContain('Or write on the ingredient card');
  });

  it('prefixes each line with its supplier when several are recorded, and says nothing has been recorded', () => {
    const text = unitConflictText({
      groups: [
        { supplierName: 'Alpine', date: TODAY, conflicts: [FLOUR] },
        { supplierName: 'Zed', date: TODAY, conflicts: [YEAST] },
      ],
      several: true, recording: true, now: NOW, t: sayEn,
    });
    expect(text).toBe('Already ordered from this supplier today: Alpine: Flour 25kg — carton; Zed: Yeast — bag. '
      + 'To add more, order it in the same unit. Nothing has been recorded yet.');
  });

  it('adds each supplier’s day when the days differ', () => {
    const text = unitConflictText({
      groups: [
        { supplierName: 'Alpine', date: TODAY, conflicts: [FLOUR] },
        { supplierName: 'Zed', date: YESTERDAY, conflicts: [YEAST] },
      ],
      several: true, recording: false, now: NOW, t: sayEn,
    });
    expect(text).toContain('Alpine (today): Flour 25kg — carton; Zed (yesterday): Yeast — bag');
    expect(text).not.toContain('Nothing has been recorded yet');
  });

  it('skips a supplier with no clash, and is empty when nobody clashes', () => {
    const groups = [{ supplierName: 'Alpine', date: TODAY, conflicts: [] }];
    expect(unitConflictText({ groups, several: true, recording: true, now: NOW, t: sayEn })).toBe('');
    expect(unitConflictText({ groups: [], several: false, recording: true, now: NOW, t: sayEn })).toBe('');
  });
});

describe('unitConflictOfLines', () => {
  it('names the lines the write refused, with no hint', () => {
    expect(unitConflictOfLines({ date: YESTERDAY, names: ['Flour 25kg', 'Yeast'], now: NOW, t: sayEn }))
      .toBe('Already ordered from this supplier yesterday: Flour 25kg, Yeast. To add more, order it in the same unit.');
  });
});
