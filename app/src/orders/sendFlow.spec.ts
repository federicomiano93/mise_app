// Sending an order by one road (sendFlow.ts, parity X15–X25, plus the send editor of v1.145.0): who goes, the message, the links
// built from the edited text, what counts as sent, and the rule that a window opens only in its own editor's press.

import { describe, expect, it, vi } from 'vitest';
import { normalizeSendRoutes } from '@mise/shared/send-routes';
import chooserSource from '../../../shared/src/send-chooser.ts?raw';
import editorSource from '../../../shared/src/send-editor.ts?raw';
import { sendOffers } from '@mise/shared/send-chooser';
import { fallbackSupplierName } from '@mise/shared/order-text';
import type { EditorAnswer, EditorJob } from '@mise/shared/send-editor';
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

type Question = { job: EditorJob; i: number; n: number; photo: boolean };

// A screen whose editor presses «Send» unchanged (the text road, as the dialog does: the press opens the window).
function ui(over: Partial<SendUi> = {}): SendUi & { said: string[]; asked: string[]; editors: Question[] } {
  const said: string[] = [];
  const editors: Question[] = [];
  return {
    said,
    asked: [],
    editors,
    alert: async message => { said.push(message); },
    canSharePhotos: () => false,
    confirmText: async () => true,
    askEditor: async question => {
      editors.push(question);
      const answer: EditorAnswer = { outcome: question.job.open(question.job.text) ? 'opened' : 'blocked', text: question.job.text };
      return answer;
    },
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
    const texts = (rows: SendRow[]) => jobsFor(offer('whatsapp', [mill]), rows, settings).map(job => [job.ids, job.text]);
    expect(texts(fromConfirm)).toStrictEqual(texts(fromDraft));
  });
});

describe('the messages of each road', () => {
  const rows: SendRow[] = [
    { id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '25kg', qty: 2 }] },
    { id: 'dairy', name: 'Dairy', items: [{ name: 'Milk', weight: '', qty: 6 }] },
  ];
  // The jobs of a road, and the link the chosen job opens for a given (edited) text.
  const opened = (route: string, suppliers: StoredDoc[], edited?: string) => {
    const urls: string[] = [];
    const jobs = jobsFor(offer(route, suppliers), rows, settings, url => { urls.push(url); return true; });
    const job = jobs[0];
    if (!job) throw new Error('no job');
    job.open(edited ?? job.text);
    return { jobs, url: urls[0] ?? '' };
  };

  it('the chat I choose: ONE message for every row, no number', () => {
    const { jobs, url } = opened('whatsapp', [mill, dairy]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.ids).toStrictEqual(['mill', 'dairy']);
    expect(url.startsWith('https://wa.me/?text=')).toBe(true);
    expect(jobs[0]!.text).toContain('Mill');
    expect(jobs[0]!.text).toContain('Dairy');
  });

  it('straight to the supplier: one chat per supplier it can reach, digits only, matched by ID', () => {
    const { jobs, url } = opened('whatsappSupplier', [mill, dairy]);
    expect(jobs.map(job => job.ids)).toStrictEqual([['mill']]);
    expect(url.startsWith('https://wa.me/447700900123?text=')).toBe(true);
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

  it('email: the mail app with a subject and the text, one per supplier with an address, shown plain', () => {
    const { jobs, url } = opened('email', [mill, dairy]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.plain).toBe(true);
    expect(url.startsWith('mailto:mill%40example.test?subject=')).toBe(true);
  });

  it('⚠️ the link is built from the EDITED text, not from the message as written', () => {
    const edited = 'Flour 3 — and one more thing';
    for (const route of ['whatsapp', 'whatsappSupplier', 'email']) {
      const { jobs, url } = opened(route, [mill], edited);
      expect(decodeURIComponent(url), route).toContain(edited);
      expect(decodeURIComponent(url), route).not.toContain(jobs[0]!.text);
    }
  });

  it('open answers what the window did', () => {
    const [job] = jobsFor(offer('whatsapp', [mill]), rows, settings, () => false);
    expect(job!.open('x')).toBe(false);
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
  const two: SendRow[] = [
    { id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '', qty: 1 }] },
    { id: 'twin', name: 'Mill', items: [{ name: 'Salt', weight: '', qty: 1 }] },
  ];
  const both = [mill, { ...twin, email: 'twin@example.test' }];

  it('⚠️ nothing opens in takeRoad itself: every window waits for its own editor\'s press', async () => {
    const open = vi.fn(() => true);
    let press: (answer: EditorAnswer) => void = () => undefined;
    const screen = ui({ askEditor: () => new Promise<EditorAnswer>(resolve => { press = resolve; }) });
    const pending = takeRoad(input({ open }), screen);
    await Promise.resolve();
    expect(open).not.toHaveBeenCalled();
    press({ outcome: 'skipped', text: '' });
    expect(await pending).toMatchObject({ kind: 'sent', ids: [] });
    expect(open).not.toHaveBeenCalled();
  });

  it('the editor is asked for each message with its place in the batch, and a picture only on the WhatsApp roads that can share one', async () => {
    const direct = ui({ canSharePhotos: () => true });
    await takeRoad(input({ offer: offer('whatsappSupplier', both), rows: two }), direct);
    expect(direct.editors.map(question => [question.job.ids[0], question.i, question.n, question.photo]))
      .toStrictEqual([['mill', 0, 2, true], ['twin', 1, 2, true]]);
    const grouped = ui({ canSharePhotos: () => true });
    await takeRoad(input({ rows: two }), grouped);
    expect(grouped.editors.map(question => [question.i, question.n, question.photo])).toStrictEqual([[0, 1, true]]);
    const mail = ui({ canSharePhotos: () => true });
    await takeRoad(input({ offer: offer('email', both), rows: two }), mail);
    expect(mail.editors.every(question => !question.photo)).toBe(true);
    const text = ui();
    await takeRoad(input(), text);
    expect(text.editors[0]!.photo).toBe(false);
  });

  it('⚠️ email counts only a window that really opened (his decision C)', async () => {
    const screen = ui({ askEditor: async ({ job }) => ({ outcome: job.open(job.text) ? 'opened' : 'blocked', text: job.text }) });
    expect(await takeRoad(input({ offer: offer('email', [mill]), open: () => false }), screen))
      .toStrictEqual({ kind: 'sent', ids: [], blocked: true, handOff: 'text' });
  });

  it('⚠️ the window opens from the EDITED text, in the editor\'s press', async () => {
    const urls: string[] = [];
    const screen = ui({ askEditor: async ({ job }) => ({ outcome: job.open('Flour 3 (edited)') ? 'opened' : 'blocked', text: 'Flour 3 (edited)' }) });
    const result = await takeRoad(input({ open: url => { urls.push(url); return true; } }), screen);
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'text' });
    expect(decodeURIComponent(urls[0] ?? '')).toContain('Flour 3 (edited)');
  });

  it('⚠️ a unit clash is said and NO editor opens', async () => {
    const screen = ui();
    expect(await takeRoad(input({ unitRefusal: () => 'Already ordered' }), screen)).toStrictEqual({ kind: 'refused' });
    expect(screen.editors).toHaveLength(0);
    expect(screen.said).toStrictEqual(['Already ordered']);
  });

  it('a unit check that throws never kills the send', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await takeRoad(input({ unitRefusal: () => { throw new Error('boom'); } }), ui());
    expect(result).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'text' });
    error.mockRestore();
  });

  it('handOff: «share» when the LAST message went by the share sheet, «text» when a window opened after it', async () => {
    const answers = (outcomes: Array<'shared' | 'opened'>) => {
      let at = 0;
      return ui({ askEditor: async ({ job }) => {
        const outcome = outcomes[at++]!;
        if (outcome === 'opened') job.open(job.text);
        return { outcome, text: job.text };
      } });
    };
    const road = offer('whatsappSupplier', [mill, twin]);
    expect(await takeRoad(input({ offer: road, rows: two }), answers(['opened', 'shared']))).toMatchObject({ handOff: 'share' });
    expect(await takeRoad(input({ offer: road, rows: two }), answers(['shared', 'opened']))).toMatchObject({ handOff: 'text' });
  });

  it('Skip leaves one unsent and names it; Cancel stops the batch and names the rest', async () => {
    const three: SendRow[] = [
      { id: 'mill', name: 'Mill', items: [{ name: 'Flour', weight: '', qty: 1 }] },
      { id: 'dairy', name: 'Dairy', items: [{ name: 'Milk', weight: '', qty: 1 }] },
      { id: 'twin', name: 'Twin', items: [{ name: 'Salt', weight: '', qty: 1 }] },
    ];
    const all = offer('whatsappSupplier', [mill, { ...dairy, phone: '222' }, { ...twin, name: 'Twin' }]);
    const skip = ui({ askEditor: async ({ job, i }) => ({ outcome: i === 1 ? 'skipped' : 'shared', text: job.text }) });
    expect(await takeRoad(input({ offer: all, rows: three }), skip)).toMatchObject({ ids: ['mill', 'twin'] });
    expect(skip.said).toStrictEqual(['Not sent: Dairy']);
    const cancel = ui({ askEditor: async ({ job, i }) => ({ outcome: i === 1 ? 'cancelled' : 'shared', text: job.text }) });
    expect(await takeRoad(input({ offer: all, rows: three }), cancel)).toMatchObject({ ids: ['mill'] });
    expect(cancel.said).toStrictEqual(['Not sent: Dairy, Twin']);
  });

  it('a picture that failed offers the text: OK opens the EDITED text, Cancel sends nothing and carries on', async () => {
    const urls: string[] = [];
    const failed = (confirm: boolean) => ui({ confirmText: async () => confirm, askEditor: async () => ({ outcome: 'failed', text: 'edited text' }) });
    const yes = await takeRoad(input({ open: url => { urls.push(url); return true; } }), failed(true));
    expect(yes).toStrictEqual({ kind: 'sent', ids: ['mill'], blocked: false, handOff: 'text' });
    expect(decodeURIComponent(urls[0] ?? '')).toContain('edited text');
    expect(await takeRoad(input(), failed(false))).toStrictEqual({ kind: 'sent', ids: [], blocked: false, handOff: 'text' });
  });

  it('every window blocked is «blocked», with no second notice: the screen says «Nothing was opened»', async () => {
    const screen = ui({ askEditor: async ({ job }) => ({ outcome: job.open(job.text) ? 'opened' : 'blocked', text: job.text }) });
    expect(await takeRoad(input({ open: () => false }), screen)).toStrictEqual({ kind: 'sent', ids: [], blocked: true, handOff: 'text' });
    expect(screen.said).toStrictEqual([]);
  });

  it('the in-app list opens no editor, skips the unit check and answers how the list went', async () => {
    const unitRefusal = vi.fn(() => 'clash');
    const screen = ui({ sendList: async listed => { screen.asked.push(listed.map(row => row.id).join()); return 'queued'; } });
    const result = await takeRoad(input({ offer: offer('manager', [mill]), unitRefusal }), screen);
    expect(result).toStrictEqual({ kind: 'list', outcome: 'queued' });
    expect(screen.asked).toStrictEqual(['mill']);
    expect(screen.editors).toHaveLength(0);
    expect(unitRefusal).not.toHaveBeenCalled();
    expect(screen.said).toStrictEqual([]);
  });

  it('backing out of the «nobody will be told» question is a cancelled road', async () => {
    expect(await takeRoad(input({ offer: offer('manager', [mill]) }), ui({ sendList: async () => null }))).toStrictEqual({ kind: 'cancelled' });
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
    const asked = [chooserSource, editorSource].flatMap(source => [...source.matchAll(/\bt\('([^']+)'/g)].map(m => m[1]));
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
