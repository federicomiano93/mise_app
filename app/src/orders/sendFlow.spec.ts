// Sending an order by one road (sendFlow.ts, parity X15–X25): who goes, the message, the links, what counts as sent, and the
// rule that every message goes through the send editor, whose own press opens its window or the share sheet.

import { describe, expect, it, vi } from 'vitest';
import { normalizeSendRoutes } from '@mise/shared/send-routes';
import chooserSource from '../../../shared/src/send-chooser.ts?raw';
import { sendOffers } from '@mise/shared/send-chooser';
import { fallbackSupplierName } from '@mise/shared/order-text';
import { en } from '../i18n/en';
import { it as itWords } from '../i18n/it';
import { format } from '../i18n/i18n';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { buildOrdersLens } from './ordersLens';
import type { StoredDoc } from './ordersSource';
import {
  SEND_KEYS, confirmedSendRows, draftSendRows, jobsFor, openWindow, recordSendRows, sendTranslate, takeRoad,
} from './sendFlow';
import type { RoadInput, SendRow, SendUi } from './sendFlow';
import type { EditQuestion } from './sendEditor';

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
const draftOf = (entries: Record<string, unknown>) => ({ entries: entries as never, days: {}, skipped: {}, awaitingSent: {}, updatedAt: '', exists: true });

const ALL_ON = normalizeSendRoutes({ sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: true, email: true } });
const settings = { grouped: true, locationName: 'Bakery', language: 'en' };
const offer = (route: string, suppliers: StoredDoc[]) => {
  const found = sendOffers({ settings: ALL_ON, canManage: true, suppliers, t }).find(o => o.route === route);
  if (!found) throw new Error(route);
  return found;
};

function ui(over: Partial<SendUi> = {}): SendUi & { said: string[]; asked: string[] } {
  const said: string[] = [];
  return {
    said,
    asked: [],
    alert: async message => { said.push(message); },
    canSharePhotos: () => false,
    render: async text => ({ text }) as unknown as File,
    askEdit: async question => ({ outcome: question.open(question.job.text) ? 'opened' : 'blocked', text: question.job.text }),
    confirmText: async () => true,
    sendList: async () => 'sent',
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

describe('taking a road (every message through the send editor, the current app\'s PR #554)', () => {
  const rows: SendRow[] = [{ id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '25kg', qty: 2 }] }];
  const input = (over: Partial<RoadInput> = {}): RoadInput => ({
    offer: offer('whatsapp', [mill]), rows, settings, unitRefusal: () => '', open: () => true, t, ...over,
  });

  it('opens nothing by itself: the editor\'s own «Send» press opens the window, with the EDITED text', async () => {
    const open = vi.fn(() => true);
    const asked: EditQuestion[] = [];
    const result = await takeRoad(input({ open }), ui({
      askEdit: async question => {
        asked.push(question);
        expect(open).not.toHaveBeenCalled();
        const edited = `${question.job.text}\n- Salt: 1`;
        return { outcome: question.open(edited) ? 'opened' : 'blocked', text: edited };
      },
    }));
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'text' });
    expect(asked).toHaveLength(1);
    expect(asked[0]!.photo).toBe(false);
    expect(decodeURIComponent(String((open.mock.calls[0] as unknown[])[0]))).toContain('- Salt: 1');
  });

  it('⚠️ email counts only a window that really opened (F-3), and never goes as a picture', async () => {
    const asked: EditQuestion[] = [];
    const result = await takeRoad(input({ offer: offer('email', [mill]), open: () => false }), ui({
      canSharePhotos: () => true,
      askEdit: async question => { asked.push(question); return { outcome: question.open(question.job.text) ? 'opened' : 'blocked', text: question.job.text }; },
    }));
    expect(result).toStrictEqual({ kind: 'sent', ids: [], blocked: true, handOff: 'text' });
    expect(asked[0]!.photo).toBe(false);
    expect(asked[0]!.job.plain).toBe(true);
  });

  it('⚠️ a unit clash is said and NO editor opens', async () => {
    const screen = ui({ askEdit: vi.fn() });
    expect(await takeRoad(input({ unitRefusal: () => 'Already ordered' }), screen)).toStrictEqual({ kind: 'refused' });
    expect(screen.askEdit).not.toHaveBeenCalled();
    expect(screen.said).toStrictEqual(['Already ordered']);
  });

  it('a unit check that throws never kills the send', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await takeRoad(input({ unitRefusal: () => { throw new Error('boom'); } }), ui());
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'text' });
    error.mockRestore();
  });

  it('⚠️ where the phone can share a file, WhatsApp goes AS A PICTURE: no «photo or text?» question any more', async () => {
    const asked: EditQuestion[] = [];
    const result = await takeRoad(input(), ui({
      canSharePhotos: () => true,
      askEdit: async question => { asked.push(question); return { outcome: 'shared', text: question.job.text }; },
    }));
    expect(asked[0]!.photo).toBe(true);
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'share' });
  });

  it('a picture that could not be drawn or shared offers the text: OK opens it, Cancel sends nothing', async () => {
    const failed = { canSharePhotos: () => true, askEdit: async (question: EditQuestion) => ({ outcome: 'failed' as const, text: question.job.text }) };
    expect(await takeRoad(input(), ui(failed))).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'text' });
    expect(await takeRoad(input(), ui({ ...failed, confirmText: async () => false })))
      .toStrictEqual({ kind: 'sent', ids: [], blocked: false, handOff: 'text' });
  });

  it('the in-app list opens no editor, skips the unit check and answers how the list went', async () => {
    const unitRefusal = vi.fn(() => 'clash');
    const screen = ui({ askEdit: vi.fn(), sendList: async list => { screen.asked.push(list.map(row => row.id).join()); return 'queued'; } });
    const result = await takeRoad(input({ offer: offer('manager', [mill]), unitRefusal }), screen);
    expect(result).toStrictEqual({ kind: 'list', outcome: 'queued' });
    expect(screen.asked).toStrictEqual(['mill']);
    expect(screen.askEdit).not.toHaveBeenCalled();
    expect(unitRefusal).not.toHaveBeenCalled();
  });

  it('backing out of the «nobody will be told» question is a cancelled road', async () => {
    expect(await takeRoad(input({ offer: offer('manager', [mill]) }), ui({ sendList: async () => null }))).toStrictEqual({ kind: 'cancelled' });
  });

  it('by email, each supplier gets an editor of its own, «1 of 2» then «2 of 2», each opening its own mail', async () => {
    const open = vi.fn(() => true);
    const asked: Array<[string, number, number]> = [];
    const two: SendRow[] = [
      { id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '', qty: 1 }] },
      { id: 'twin', name: 'Mill', items: [{ name: 'Salt', weight: '', qty: 1 }] },
    ];
    const result = await takeRoad({
      offer: offer('email', [mill, { ...twin, email: 'twin@example.test' }]), rows: two, settings, unitRefusal: () => '', open, t,
    }, ui({ askEdit: async question => { asked.push([question.job.ids[0]!, question.i, question.n]); return { outcome: question.open(question.job.text) ? 'opened' : 'blocked', text: question.job.text }; } }));
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill', 'twin'], blocked: false, handOff: 'text' });
    expect(asked).toStrictEqual([['mill', 0, 2], ['twin', 1, 2]]);
    expect(open).toHaveBeenCalledTimes(2);
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

describe('recordSendRows — a recorded order sent again from History (step 3f-4)', () => {
  const ingredients = [{ id: 'flour', name: 'Farina', weight: '25kg' }, { id: 'yeast', name: 'Lievito' }];

  it('one row per record, by its supplier, with the lines as recorded and only the frozen units', () => {
    const rows = recordSendRows([
      { id: '2026-10-27_mill', supplierId: 'mill', supplierName: 'Mill', quantities: { yeast: 2, flour: 1, gone: 3, zero: 0 },
        names: { gone: 'Ricotta 1.5kg' }, units: { yeast: 'busta' } },
      { id: '2026-10-27_dairy', supplierId: 'dairy', supplierName: 'Dairy', quantities: {} },
    ], ingredients, 'it');
    expect(rows).toStrictEqual([{
      id: 'mill', name: 'Mill',
      items: [
        { name: 'Farina', weight: '25kg', qty: 1 },
        { name: 'Lievito', weight: '', qty: 2, unit: 'busta' },
        { name: 'Ricotta 1.5kg', weight: '', qty: 3 },
      ],
    }]);
  });

  it('the legacy weekly record has no supplier: its own id, and the stand-in name in the venue\'s language', () => {
    const [row] = recordSendRows([{ id: '2026-W28', weekStart: '2026-07-06', quantities: { flour: 1 } }], ingredients, 'it');
    expect(row?.id).toBe('2026-W28');
    expect(row?.name).toBe(fallbackSupplierName('it'));
  });
});
