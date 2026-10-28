// Sending an order by one road (sendFlow.ts, parity X15–X25): who goes, the message, the links, what counts as sent, and the
// rule that every text window opens INSIDE the tap — before the first await.

import { describe, expect, it, vi } from 'vitest';
import { normalizeSendRoutes } from '@mise/shared/send-routes';
import chooserSource from '../../../shared/src/send-chooser.ts?raw';
import { sendOffers } from '@mise/shared/send-chooser';
import type { SendJob } from '@mise/shared/send-chooser';
import { en } from '../i18n/en';
import { it as itWords } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { buildOrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import {
  SEND_KEYS, confirmedSendRows, draftSendRows, jobsFor, openWindow, sendTranslate, takeRoad,
} from './sendFlow';
import type { RoadInput, SendRow, SendUi } from './sendFlow';

const tEn = (key: MessageKey, params?: MessageParams) => format('en', en[key], params);
const t = sendTranslate(tEn);

const mill: StoredDoc = { id: 'mill', name: 'Mill', phone: '+44 7700 900123', email: 'mill@example.test' };
const dairy: StoredDoc = { id: 'dairy', name: 'Dairy' };
const twin: StoredDoc = { id: 'twin', name: 'Mill', phone: '111' };

function lensOf(entries: Record<string, unknown>) {
  return buildOrdersLens({
    suppliers: [mill, dairy, twin],
    suppliersLoaded: true,
    ingredients: [
      { id: 'flour', name: 'Flour', weight: '25kg', supplierId: 'mill' },
      { id: 'semola', name: 'Semola', supplierId: 'mill', active: false },
      { id: 'milk', name: 'Milk', supplierId: 'dairy' },
      { id: 'salt', name: 'Salt', supplierId: 'twin' },
      { id: 'yeast', name: 'Yeast', supplierId: 'mill', unit: 'cartone', packUnit: 'busta' },
    ],
    entries: entries as never,
    supplierOrder: ['mill', 'dairy', 'twin'],
    noSupplierName: 'No supplier',
  });
}
const draftOf = (entries: Record<string, unknown>) => ({ entries: entries as never, days: {}, updatedAt: '', exists: true });

const ALL_ON = normalizeSendRoutes({ sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: true, email: true } });
const settings = { grouped: true, locationName: 'Bakery', language: 'en' };
const offer = (route: string, suppliers: StoredDoc[]) => {
  const found = sendOffers({ settings: ALL_ON, canManage: true, suppliers, t }).find(o => o.route === route);
  if (!found) throw new Error(route);
  return found;
};

function ui(over: Partial<SendUi> = {}): SendUi & { said: string[] } {
  const said: string[] = [];
  return {
    said,
    alert: async message => { said.push(message); },
    canSharePhotos: () => false,
    askFormat: async () => 'text',
    render: async text => ({ text }) as unknown as File,
    askPhoto: async () => 'shared',
    confirmText: async () => true,
    ...over,
  };
}

describe('the rows of a send', () => {
  it('only the suppliers with a quantity, in the list\'s order, a switched-off line with a quantity included (T10)', () => {
    const entries = { milk: { qty: 6 }, flour: { qty: 2 }, semola: { qty: 1 } };
    const rows = draftSendRows(lensOf(entries), draftOf(entries));
    expect(rows.map(row => row.id)).toStrictEqual(['mill', 'dairy']);
    expect(rows[0]!.items.map(item => item.name)).toStrictEqual(['Flour', 'Semola']);
  });

  it('only the ticked ones when asked', () => {
    const entries = { milk: { qty: 6 }, flour: { qty: 2 } };
    expect(draftSendRows(lensOf(entries), draftOf(entries), ['dairy']).map(row => row.id)).toStrictEqual(['dairy']);
  });

  it('⚠️ «Send it now» writes the message the send screen would write for the same numbers', () => {
    const entries = { flour: { qty: 3 }, yeast: { qty: 4, unit: 'busta' } };
    const lens = lensOf(entries);
    const fromDraft = draftSendRows(lens, draftOf(entries));
    const fromConfirm = confirmedSendRows(lens,
      [{ supplierId: 'mill', date: '2026-10-28', quantities: { flour: 3, yeast: 4 }, units: { flour: '', yeast: 'busta' } }],
      { mill: 'Mill' });
    expect(jobsFor(offer('whatsapp', [mill]), fromConfirm, settings)).toStrictEqual(jobsFor(offer('whatsapp', [mill]), fromDraft, settings));
  });
});

describe('the windows of each road', () => {
  const rows: SendRow[] = [
    { id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '25kg', qty: 2 }] },
    { id: 'dairy', name: 'Dairy', items: [{ name: 'Milk', weight: '', qty: 6 }] },
  ];

  it('the chat I choose: ONE message for every row, no number', () => {
    const jobs = jobsFor(offer('whatsapp', [mill, dairy]), rows, settings);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.ids).toStrictEqual(['mill', 'dairy']);
    expect(jobs[0]!.url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(jobs[0]!.text).toContain('Mill');
    expect(jobs[0]!.text).toContain('Dairy');
  });

  it('straight to the supplier: one chat per supplier it can reach, digits only, matched by ID', () => {
    const jobs = jobsFor(offer('whatsappSupplier', [mill, dairy]), rows, settings);
    expect(jobs.map(job => job.ids)).toStrictEqual([['mill']]);
    expect(jobs[0]!.url.startsWith('https://wa.me/447700900123?text=')).toBe(true);
    expect(jobs[0]!.text).not.toContain('Milk');
  });

  it('two suppliers with the same name never get each other\'s order', () => {
    const sameName: SendRow[] = [
      { id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '', qty: 2 }] },
      { id: 'twin', name: 'Mill', items: [{ name: 'Salt', weight: '', qty: 1 }] },
    ];
    const jobs = jobsFor(offer('whatsappSupplier', [mill, twin]), sameName, settings);
    expect(jobs.find(job => job.ids[0] === 'twin')!.text).toContain('Salt');
    expect(jobs.find(job => job.ids[0] === 'twin')!.text).not.toContain('Flour');
  });

  it('email: the mail app with a subject and the text, one per supplier with an address', () => {
    const jobs = jobsFor(offer('email', [mill, dairy]), rows, settings);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.url.startsWith('mailto:mill%40example.test?subject=')).toBe(true);
  });

  it('nothing to say opens nothing', () => {
    expect(jobsFor(offer('whatsapp', [mill]), [], settings)).toStrictEqual([]);
  });
});

describe('taking a road', () => {
  const rows: SendRow[] = [{ id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '25kg', qty: 2 }] }];
  const input = (over: Partial<RoadInput> = {}): RoadInput => ({
    offer: offer('whatsapp', [mill]), rows, settings, unitRefusal: () => '', open: () => true, t, ...over,
  });

  it('⚠️ every text window opens BEFORE the first await — inside the tap', () => {
    const open = vi.fn(() => true);
    void takeRoad(input({ open }), ui());
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('⚠️ email too, and it counts only a window that really opened (F-3)', async () => {
    const open = vi.fn(() => false);
    const pending = takeRoad(input({ offer: offer('email', [mill]), open }), ui());
    expect(open).toHaveBeenCalledTimes(1);
    expect(await pending).toStrictEqual({ kind: 'sent', ids: [], blocked: true });
  });

  it('⚠️ a unit clash is said and NOTHING opens', async () => {
    const open = vi.fn(() => true);
    const screen = ui();
    expect(await takeRoad(input({ open, unitRefusal: () => 'Already ordered' }), screen)).toStrictEqual({ kind: 'refused' });
    expect(open).not.toHaveBeenCalled();
    expect(screen.said).toStrictEqual(['Already ordered']);
  });

  it('a unit check that throws never kills the send', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await takeRoad(input({ unitRefusal: () => { throw new Error('boom'); } }), ui());
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false });
    error.mockRestore();
  });

  it('where a picture can be shared it asks first; Cancel sends nothing', async () => {
    const open = vi.fn(() => true);
    const result = await takeRoad(input({ open }), ui({ canSharePhotos: () => true, askFormat: async () => null }));
    expect(result).toStrictEqual({ kind: 'cancelled' });
    expect(open).not.toHaveBeenCalled();
  });

  it('«Text» opens the chat; «Photo» shares one picture per job and records what was shared', async () => {
    expect(await takeRoad(input(), ui({ canSharePhotos: () => true, askFormat: async () => 'text' })))
      .toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false });
    const asked: SendJob[] = [];
    const result = await takeRoad(input(), ui({
      canSharePhotos: () => true, askFormat: async () => 'photo',
      askPhoto: async ({ job }) => { asked.push(job); return 'shared'; },
    }));
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false });
    expect(asked).toHaveLength(1);
  });

  it('a picture that cannot be drawn offers the text: OK opens it, Cancel sends nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken = { canSharePhotos: () => true, askFormat: async () => 'photo' as const, render: async () => { throw new Error('no canvas'); } };
    expect(await takeRoad(input(), ui(broken))).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false });
    expect(await takeRoad(input(), ui({ ...broken, confirmText: async () => false }))).toStrictEqual({ kind: 'cancelled' });
    error.mockRestore();
  });

  it('the in-app list is not a road of this slice: it opens nothing', async () => {
    expect(await takeRoad(input({ offer: offer('manager', [mill]) }), ui())).toStrictEqual({ kind: 'cancelled' });
  });
});

describe('the links and the words', () => {
  it('⚠️ openWindow answers whether a window opened, and cuts its link back to this page', () => {
    const opened = { opener: 'me' as unknown };
    const spy = vi.spyOn(window, 'open').mockReturnValueOnce(opened as Window).mockReturnValueOnce(null);
    expect(openWindow('https://wa.me/?text=x')).toBe(true);
    expect(opened.opener).toBeNull();
    expect(openWindow('https://wa.me/?text=x')).toBe(false);
    expect(spy).toHaveBeenCalledWith('https://wa.me/?text=x', '_blank');
    spy.mockRestore();
  });

  it('every word the send-chooser port asks for is in Mise 2\'s dictionary, in both languages', () => {
    const asked = [...chooserSource.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]);
    expect(asked.length).toBeGreaterThan(0);
    for (const key of asked) {
      const mapped = SEND_KEYS[key!];
      expect(mapped, key).toBeDefined();
      expect(en[mapped!], key).toBeDefined();
      expect(itWords[mapped!], key).toBeDefined();
    }
  });

  it('the port\'s plural words come out of the dictionary', () => {
    expect(t('orders.send.onePerSupplier', { n: 3 })).toBe('one message each — 3 chats');
    expect(() => t('orders.unknown')).toThrow();
  });
});
