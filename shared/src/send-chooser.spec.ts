// Tests for what the send chooser OFFERS, the two links it builds and how a batch of order pictures is delivered (P15), run
// against BOTH implementations: the TypeScript port in shared/ and js/orders/send-chooser.js, which the live app uses today.
// Ported from tests/send-chooser.test.mjs (all 10 tests) and the pure tests of tests/order-image.test.mjs that call the
// chooser (12: the text road, the photo batch, settleOnce, afterShare).
//
// send-chooser.ts is a PARTIAL port (it leaves out chooseAndSend, the screen), so parity.spec.ts does not pair it: the last
// describe compares what IS ported with the js/ file itself. The words are handed to the port as `t`; the original reads
// the same dictionary itself, so both are run with the original's own `t` and must say the same thing.

import { describe, expect, test } from 'vitest';
import * as ported from './send-chooser';
import * as legacyJs from '../../js/orders/send-chooser.js';
import { normalizeSendRoutes } from './send-routes';
import { setLanguage, t } from '../../js/i18n.js';

const legacy = legacyJs as unknown as typeof ported;

const ALL_ON = normalizeSendRoutes({
  sendRoutes: { manager: true, whatsapp: true, whatsappSupplier: true, email: true },
});
type Sup = { id: string; name: string; phone?: string; email?: string };
const S = (id: string, over: Partial<Sup> = {}): Sup => ({ id, name: id.toUpperCase(), ...over });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  setLanguage('en');
  const offers = (settings: unknown, canManage: boolean, suppliers: readonly Sup[]) =>
    m.offerFor({ settings, canManage, suppliers, t });
  const by = (list: ReturnType<typeof offers>, route: string) => list.find(o => o.route === route);
  const routeNames = (list: ReturnType<typeof offers>) => list.map(o => o.route);

  test('⚠️ a supplier with no number is named, not silently dropped', () => {
    const o = by(offers(ALL_ON, true, [S('a', { phone: '447700900123' }), S('b', { phone: '' })]), 'whatsappSupplier');
    expect(o?.reachable.map(s => s.id)).toStrictEqual(['a']);
    expect(o?.cannot.map(s => s.id)).toStrictEqual(['b']);
    expect(o?.note).toMatch(/B/);
  });

  test('⚠️ "one message per supplier" is said BEFORE the road is taken', () => {
    const o = by(offers(ALL_ON, true, [S('a', { phone: '1' }), S('b', { phone: '2' }), S('c', { phone: '3' })]), 'whatsappSupplier');
    expect(o?.note).toBe('one message each — 3 chats');
  });

  test('both notes together are joined with a dot, in the dictionary\'s words', () => {
    setLanguage('it');
    try {
      const o = by(offers(ALL_ON, true, [S('a', { phone: '1' }), S('b', { phone: '2' }), S('c')]), 'whatsappSupplier');
      expect(o?.note).toBe(`${t('orders.send.onePerSupplier', { n: 2 })} · ${t('orders.send.noContact', { n: 1, names: 'C' })}`);
    } finally {
      setLanguage('en');
    }
  });

  test('with ONE supplier there is no such warning — it would be noise', () => {
    expect(by(offers(ALL_ON, true, [S('a', { phone: '1' })]), 'whatsappSupplier')?.note).toBe('');
  });

  test('⚠️ a road that can reach nobody is not usable', () => {
    const list = offers(ALL_ON, true, [S('a', { phone: '' }), S('b', { phone: '' })]);
    expect(by(list, 'whatsappSupplier')?.usable).toBe(false);
    expect(by(list, 'whatsapp')?.usable).toBe(true);
    expect(by(list, 'manager')?.usable).toBe(true);
  });

  test('an employee is offered only the open roads; a manager gets all four', () => {
    const limited = normalizeSendRoutes({ sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } });
    const suppliers = [S('a', { phone: '1', email: 'a@b.test' })];
    expect(routeNames(offers(limited, false, suppliers))).toStrictEqual(['manager']);
    expect(routeNames(offers(limited, true, suppliers))).toStrictEqual(['manager', 'whatsapp', 'whatsappSupplier', 'email']);
  });

  test('the two indirect roads never depend on a supplier having contacts', () => {
    const list = offers(ALL_ON, true, [S('a')]);
    expect(by(list, 'manager')?.usable).toBe(true);
    expect(by(list, 'whatsapp')?.usable).toBe(true);
  });

  test('no suppliers at all is answered without throwing', () => {
    const list = offers(ALL_ON, true, []);
    expect(by(list, 'manager')?.usable).toBe(false);
    expect(list.length).toBe(4);
  });

  test('sendOffers keeps the usable roads; «Send it now» keeps only those that reach a supplier', () => {
    const suppliers = [S('a', { phone: '1' })];
    expect(m.sendOffers({ settings: ALL_ON, canManage: true, suppliers, t }).map(o => o.route))
      .toStrictEqual(['manager', 'whatsapp', 'whatsappSupplier']);
    expect(m.sendOffers({ settings: ALL_ON, canManage: true, suppliers, supplierRoadsOnly: true, t }).map(o => o.route))
      .toStrictEqual(['whatsapp', 'whatsappSupplier']);
  });

  test('⚠️ a phone number is reduced to digits, whatever it was typed as', () => {
    expect(m.digitsOf('+44 7700 900123')).toBe('447700900123');
    expect(m.digitsOf('(0044) 7700-900123')).toBe('00447700900123');
    expect(m.digitsOf('')).toBe('');
    expect(m.digitsOf(null)).toBe('');
  });

  test('⚠️ the mail link escapes the whole message, so nothing is truncated', () => {
    const url = m.mailto('a@b.test', 'Order from Mise', 'Flour 25kg: 2\nSalt & pepper: 1');
    expect(url.startsWith('mailto:a%40b.test?subject=')).toBe(true);
    expect(url).not.toContain('Salt & pepper');
    expect(url).toContain('%26');
    expect(url).toContain('%0A');
  });

  test('a blank address still produces a well-formed link rather than junk', () => {
    expect(m.mailto('  ', 's', 'b').startsWith('mailto:?subject=')).toBe(true);
  });

  // ── delivering ──────────────────────────────────────────────────────────────

  const JOBS = [
    { ids: ['a'], name: 'Alfa', text: 'ta', url: 'url-a' },
    { ids: ['b'], name: 'Beta', text: 'tb', url: 'url-b' },
    { ids: ['c'], name: 'Gamma', text: 'tc', url: 'url-c' },
  ];
  const FILES = ['fa', 'fb', 'fc'];
  const batch = async (answers: string[], jobs = JOBS, { okTap = true, windowOpens = true } = {}) => {
    const asked: [string | undefined, number, number][] = [];
    const said: string[] = [];
    const opened: string[] = [];
    const sent = await m.runPhotoBatch({
      jobs, files: FILES,
      ask: async ({ job, i, n }) => { asked.push([job.ids[0], i, n]); return answers[i] ?? 'cancelled'; },
      notify: async (message: string) => { said.push(message); },
      confirmText: async () => okTap,
      open: (u: string) => { opened.push(u); return windowOpens ? {} : null; },
      t,
    });
    return { sent, asked, said, opened };
  };

  test('text road: every url opened, every id sent, synchronously', () => {
    const opened: string[] = [];
    expect(m.sendTexts(JOBS, u => opened.push(u))).toStrictEqual(['a', 'b', 'c']);
    expect(opened).toStrictEqual(['url-a', 'url-b', 'url-c']);
  });

  test('⚠️ the text road counts only the windows that really opened', () => {
    expect(m.sendTexts(JOBS, u => (u === 'url-b' ? null : {}))).toStrictEqual(['a', 'c']);
  });

  test('one tap per picture: each job is asked in turn, with its number and the total', async () => {
    const r = await batch(['shared', 'shared', 'shared']);
    expect(r.asked).toStrictEqual([['a', 0, 3], ['b', 1, 3], ['c', 2, 3]]);
    expect(r.sent).toStrictEqual(['a', 'b', 'c']);
    expect(r.said).toStrictEqual([]);
    expect(r.opened).toStrictEqual([]);
  });

  test('⚠️ skip: that one is not sent, the next is still asked, and the not-sent one is named', async () => {
    const r = await batch(['shared', 'skipped', 'shared']);
    expect(r.sent).toStrictEqual(['a', 'c']);
    expect(r.asked.length).toBe(3);
    expect(r.said).toStrictEqual(['Not sent: Beta']);
  });

  test('⚠️ cancel stops the whole batch: it and everything after are named, none sent', async () => {
    const r = await batch(['shared', 'cancelled', 'shared']);
    expect(r.sent).toStrictEqual(['a']);
    expect(r.asked.length).toBe(2);
    expect(r.said).toStrictEqual(['Not sent: Beta, Gamma']);
  });

  test('⚠️ a failed share, then OK: THAT supplier\'s text is opened and counted as sent', async () => {
    const r = await batch(['failed', 'shared', 'skipped']);
    expect(r.opened).toStrictEqual(['url-a']);
    expect(r.sent).toStrictEqual(['a', 'b']);
    expect(r.said[0]).toMatch(/Gamma/);
  });

  test('⚠️ a failed share, then Cancel or Escape: nothing opened, nothing counted, named', async () => {
    const r = await batch(['failed', 'shared', 'shared'], JOBS, { okTap: false });
    expect(r.opened).toStrictEqual([]);
    expect(r.sent).toStrictEqual(['b', 'c']);
    expect(r.said[0]).toMatch(/Alfa/);
  });

  test('⚠️ a fallback text whose window was blocked is not counted as sent', async () => {
    const r = await batch(['failed', 'shared', 'shared'], JOBS, { windowOpens: false });
    expect(r.opened).toStrictEqual(['url-a']);
    expect(r.sent).toStrictEqual(['b', 'c']);
    expect(r.said[0]).toMatch(/Alfa/);
  });

  test('one grouped chat: cancelled sends nothing and shows no «not sent» list', async () => {
    const r = await batch(['cancelled'], [{ ids: ['a', 'b'], text: 't', url: 'u' }] as typeof JOBS);
    expect(r.sent).toStrictEqual([]);
    expect(r.said).toStrictEqual([]);
  });

  test('⚠️ a dialog settles once: a late share() after Skip or Cancel is ignored', () => {
    const answers: string[] = [];
    let cleaned = 0;
    const done = m.settleOnce((v: string) => answers.push(v), () => { cleaned++; });
    expect(done('skipped')).toBe(true);
    expect(done('shared')).toBe(false);
    expect(answers).toStrictEqual(['skipped']);
    expect(cleaned).toBe(1);
  });

  test('afterShare: shared is done, a closed sheet keeps the dialog open, the rest failed', () => {
    expect(m.afterShare('shared')).toBe('shared');
    expect(m.afterShare('cancelled')).toBe('again');
    expect(m.afterShare('failed')).toBe('failed');
  });
});

describe('what is ported, compared with the original', () => {
  const port = ported as unknown as Record<string, unknown>;
  const original = legacyJs as unknown as Record<string, unknown>;
  const shared = ['offerFor', 'sendOffers', 'sendTexts', 'settleOnce', 'afterShare', 'runPhotoBatch', 'digitsOf', 'mailto'];
  const LEFT_OUT = ['chooseAndSend'];

  test('the original still exports everything this port leaves out', () => {
    for (const name of LEFT_OUT) expect(name in original, name).toBe(true);
  });

  test('the port and the original together export exactly the ported names and the left-out ones', () => {
    expect(Object.keys(original).sort()).toStrictEqual([...shared, ...LEFT_OUT].sort());
    expect(Object.keys(port).sort()).toStrictEqual([...shared].sort());
  });

  test('every function has the same name and the same number of required parameters', () => {
    for (const name of shared) {
      const mine = port[name] as (...args: unknown[]) => unknown;
      const theirs = original[name] as (...args: unknown[]) => unknown;
      expect(mine.name, name).toBe(theirs.name);
      expect(mine.length, `${name}: arity`).toBe(theirs.length);
    }
  });
});
