import { describe, expect, it } from 'vitest';
import { normalizeConfig } from '@mise/shared/calculator-config';
import { en } from '../i18n/en';
import { it as italian } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { changedOrder, orderOf, usedOrder } from '../testing/clientOrderFixtures';
import { NOW } from '../testing/logFixtures';
import { configOf } from '../testing/renderCalculator';
import { arrivedLabel, bannerCounts, dayLabel, inspectPatch, joinList, liveNameOf, needsAttention } from './clientOrdersView';

const say = (lang: 'en' | 'it') => (key: MessageKey, params?: MessageParams) => format(lang, (lang === 'it' ? italian : en)[key], params);
const sayEn = say('en');

describe('what needs attention', () => {
  it('is an order never used, or one changed since it was used — never one used and untouched', () => {
    expect(needsAttention(orderOf())).toBe(true);
    expect(needsAttention(changedOrder())).toBe(true);
    expect(needsAttention(usedOrder())).toBe(false);
  });

  it('counts the waiting orders and, of those, the changed ones', () => {
    expect(bannerCounts([])).toEqual({ waiting: 0, changed: 0 });
    expect(bannerCounts([orderOf(), changedOrder({ clientId: 'sole' }), usedOrder({ date: '2026-10-14' })]))
      .toEqual({ waiting: 2, changed: 1 });
  });
});

describe('the live name of a product', () => {
  const client = normalizeConfig(configOf()).clients[0] ?? null;
  it('is the address book\'s name, or empty for a product the client no longer has', () => {
    expect(liveNameOf(client)('tray')).toBe('Focaccia tray');
    expect(liveNameOf(client)('gone')).toBe('');
    expect(liveNameOf(null)('tray')).toBe('');
  });
});

describe('dayLabel', () => {
  const full = (d: number) => new Date(2026, 9, d).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  it('names today and tomorrow, and writes any other day plainly', () => {
    expect(dayLabel(sayEn, 'en-GB', '2026-10-12', NOW)).toBe(`Today · ${full(12)}`);
    expect(dayLabel(sayEn, 'en-GB', '2026-10-13', NOW)).toBe(`Tomorrow · ${full(13)}`);
    expect(dayLabel(sayEn, 'en-GB', '2026-10-15', NOW)).toBe(full(15));
    expect(dayLabel(sayEn, 'en-GB', '2026-10-09', NOW)).toBe(full(9));
  });
  it('gives an unreadable date back as it came', () => {
    expect(dayLabel(sayEn, 'en-GB', 'nonsense', NOW)).toBe('nonsense');
    expect(dayLabel(sayEn, 'en-GB', undefined, NOW)).toBe('');
  });
});

describe('arrivedLabel', () => {
  const at = (minutes: number) => orderOf({ updatedAt: new Date(NOW - minutes * 60_000).toISOString() });
  it('says just now, minutes, hours and then the date', () => {
    expect(arrivedLabel(sayEn, 'en-GB', at(0), NOW)).toBe('just now');
    expect(arrivedLabel(sayEn, 'en-GB', at(5), NOW)).toBe('5 min ago');
    expect(arrivedLabel(sayEn, 'en-GB', at(60), NOW)).toBe('1 hour ago');
    expect(arrivedLabel(sayEn, 'en-GB', at(60 * 5), NOW)).toBe('5 hours ago');
    expect(arrivedLabel(sayEn, 'en-GB', at(60 * 30), NOW))
      .toBe(new Date(NOW - 60 * 30 * 60_000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }));
  });
  it('says nothing for a time that cannot be read', () => {
    expect(arrivedLabel(sayEn, 'en-GB', orderOf({ updatedAt: 'x' }), NOW)).toBe('');
  });
  it('uses the Italian words', () => {
    expect(arrivedLabel(say('it'), 'it-IT', at(5), NOW)).toBe('5 min fa');
    expect(arrivedLabel(say('it'), 'it-IT', at(0), NOW)).toBe('adesso');
  });
});

describe('joinList', () => {
  it('writes the grammar of the list in the interface language', () => {
    expect(joinList(sayEn, [])).toBe('');
    expect(joinList(sayEn, ['Focaccia'])).toBe('Focaccia');
    expect(joinList(sayEn, ['Focaccia', 'Brioche'])).toBe('Focaccia and Brioche');
    expect(joinList(sayEn, ['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinList(say('it'), ['A', 'B'])).toBe('A e B');
  });
});

describe('inspectPatch', () => {
  const config = normalizeConfig(configOf());
  const none = () => null;

  it('answers a row for every product with a box on a visible tab, and none for the rest', () => {
    const rows = inspectPatch(config, { 'roma::tray': 5, 'roma::roll': 0, 'roma::paused': 3, 'roma::nowhere': 1 }, none);
    expect(rows.map(row => row.qtyId)).toEqual(['roma::tray', 'roma::roll']);
    expect(rows[0]).toMatchObject({ recipeId: 'focaccia', recipeName: 'Focaccia', productName: 'Focaccia tray', current: 0, next: 5, locked: false });
  });

  it('reads the current number from what the tab holds, never below zero or NaN', () => {
    const held: Record<string, string> = { 'qty-roma::tray': '3', 'qty-roma::roll': '-2', 'qty-roma::slab': 'abc' };
    const rows = inspectPatch(config, { 'roma::tray': 5, 'roma::roll': 1, 'roma::slab': 1 }, key => held[key] ?? null);
    expect(rows.map(row => row.current)).toEqual([3, 0, 0]);
  });

  it('knows a confirmed tab by its lock', () => {
    const read = (key: string) => (key === 'lock-brioche' ? '{"locked":true,"logId":null}' : key === 'lock-focaccia' ? '{"locked":false,"logId":"l"}' : null);
    const rows = inspectPatch(config, { 'roma::tray': 5, 'roma::roll': 1 }, read);
    expect(rows.map(row => row.locked)).toEqual([false, true]);
  });

  it('leaves out a recipe that is not a visible tab', () => {
    const hidden = normalizeConfig(configOf({ recipes: [{ id: 'focaccia', name: 'Focaccia', logic: 'orders', order: 1, visible: false, ingredients: [] }] }));
    expect(inspectPatch(hidden, { 'roma::tray': 5 }, none)).toEqual([]);
  });
});
