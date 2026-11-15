import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { fakeOrdersSource } from '../testing/fakeOrdersSource';
import type { FakeOrdersSource } from '../testing/fakeOrdersSource';
import { LOAD, ingredient, renderOrders, supplier } from '../testing/renderOrders';
import { localeOf } from '../i18n/i18n';

// There is no canvas in jsdom: the order picture is a stand-in file.
vi.mock('./orderImage', async importOriginal => ({
  ...await importOriginal<typeof import('./orderImage')>(),
  renderOrderImage: vi.fn((text: string) => Promise.resolve(new File([text], 'order.png', { type: 'image/png' }))),
}));

// «Orders», port of v1.145.0 (piece 4): «Order to X sent at 10:42: did it go?» — the banners on both views, the sender's own dialog,
// and the sends that write the question. What the STORE does with an answer is ordersStore.awaiting.spec.ts.

beforeAll(async () => { await import('./OrdersSection'); }, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'canShare');
  Reflect.deleteProperty(navigator, 'share');
  Reflect.deleteProperty(document, 'visibilityState');
  document.querySelectorAll('[data-test-dialog]').forEach(node => { node.remove(); });
});

const TODAY = todayISO();
const STAFF = { session: { canManage: false, role: 'staff', isOwner: false } } as const;
const WHATSAPP_ONLY = { sendRoutes: { manager: false, whatsapp: true, whatsappSupplier: false, email: false } };

const SUPPLIERS = [
  supplier('s-alp', { name: 'Alpine Mills' }),
  supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed', phone: '+44 7700 900123' }),
];
const ITEMS = [
  ingredient('i-flour', { name: 'Flour 00', weight: '25kg', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-rye', { name: 'Rye', supplierId: 's-alp', unit: 'kg' }),
  ingredient('i-milk', { name: 'Whole milk', shortName: 'Milk', supplierId: 's-zed', unit: 'l' }),
];
const DRAFT = { entries: { 'i-flour': { qty: 2 }, 'i-rye': { qty: 3 }, 'i-milk': { qty: 4 } }, days: { 's-alp': TODAY, 's-zed': TODAY } };

// A moment of today (or `daysAgo` days before), by the clock on the wall.
function when(hour: number, minute: number, daysAgo = 0): string {
  const day = new Date();
  day.setDate(day.getDate() - daysAgo);
  day.setHours(hour, minute, 0, 0);
  return day.toISOString();
}
const clock = (iso: string, lang = 'en') => new Intl.DateTimeFormat(localeOf(lang as 'en'), { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
const question = (at: string, quantities: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({ at, date: TODAY, quantities, units: {}, ...extra });

function seeded(over: Partial<Parameters<typeof fakeOrdersSource>[0]> = {}): FakeOrdersSource {
  return fakeOrdersSource({ suppliers: SUPPLIERS, ingredients: ITEMS, ordersConfig: WHATSAPP_ONLY, ...over });
}
const withQuestions = (awaitingSent: Record<string, unknown>, draft: Record<string, unknown> = DRAFT) =>
  seeded({ draft: { ...draft, awaitingSent } });

type Options = NonNullable<Parameters<typeof renderOrders>[1]>;
async function atList(source: FakeOrdersSource, options: Options = {}, path = '/orders') {
  const view = renderOrders(path, { source, ...options });
  await screen.findAllByRole('listitem', undefined, LOAD);
  return view;
}

const yesFor = (sentence: string | RegExp) => screen.getByRole('button', { name: /^(Yes|Sì)$/, description: sentence });
const noFor = (sentence: string | RegExp) => screen.getByRole('button', { name: 'No', description: sentence });
const asking = (source: FakeOrdersSource) => (source.draft?.awaitingSent ?? {}) as Record<string, { at: string }>;

describe('the banners', () => {
  it('is one row per waiting supplier, the OLDEST first, with the time it was sent', async () => {
    const alp = when(10, 42);
    const zed = when(9, 10);
    await atList(withQuestions({ 's-alp': question(alp, { 'i-flour': 2 }), 's-zed': question(zed, { 'i-milk': 4 }) }));
    const sentences = await screen.findAllByText(/: did it go\?$/);
    expect(sentences.map(node => node.textContent)).toEqual([
      `Order to Zed sent at ${clock(zed)}: did it go?`,
      `Order to Alpine Mills sent at ${clock(alp)}: did it go?`,
    ]);
    // Each row has its own two answers.
    expect(screen.getAllByRole('button', { name: 'Yes' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'No' })).toHaveLength(2);
  });

  it('is also on the flat view, above everything else', async () => {
    const alp = when(10, 42);
    await atList(withQuestions({ 's-alp': question(alp, { 'i-flour': 2 }) }), {}, '/orders/ingredients');
    expect(await screen.findByText(`Order to Alpine Mills sent at ${clock(alp)}: did it go?`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
  });

  it('says the DAY when it was not today', async () => {
    await atList(withQuestions({ 's-alp': question(when(18, 5, 1), { 'i-flour': 2 }, { date: TODAY }) }));
    expect(await screen.findByText(new RegExp(`^Order to Alpine Mills sent yesterday at ${clock(when(18, 5, 1))}: did it go\\?$`))).toBeInTheDocument();
  });

  it('speaks Italian, with the time in the interface language', async () => {
    const alp = when(10, 42);
    await atList(withQuestions({ 's-alp': question(alp, { 'i-flour': 2 }) }), { lang: 'it' });
    expect(await screen.findByText(`Ordine a Alpine Mills inviato alle ${clock(alp, 'it')}: è partito?`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sì' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'No' })).toBeInTheDocument();
  });

  it('names each button by its own word AND describes it by the question, so a screen reader hears which order «Yes» is about', async () => {
    const alp = when(10, 42);
    const zed = when(9, 10);
    await atList(withQuestions({ 's-alp': question(alp, { 'i-flour': 2 }), 's-zed': question(zed, { 'i-milk': 4 }) }));
    await screen.findAllByText(/: did it go\?$/);
    expect(yesFor(`Order to Alpine Mills sent at ${clock(alp)}: did it go?`)).toBeInTheDocument();
    expect(noFor(`Order to Zed sent at ${clock(zed)}: did it go?`)).toBeInTheDocument();
  });

  it('is there, empty, before a question arrives — the same region then holds it (a region inserted already filled is not announced)', async () => {
    const source = seeded({ draft: DRAFT });
    await atList(source);
    const before = screen.getAllByRole('status');
    act(() => { source.remoteMerge({ awaitingSent: { 's-alp': question(when(10, 42), { 'i-flour': 2 }) } }); });
    const sentence = await screen.findByText(/^Order to Alpine Mills sent at/);
    expect(before).toContain(sentence.closest('[role="status"]'));
  });

  it('shows no question for a supplier that is switched off', async () => {
    const source = fakeOrdersSource({
      suppliers: [SUPPLIERS[0]!, { ...SUPPLIERS[1]!, active: false }],
      ingredients: ITEMS,
      draft: { ...DRAFT, awaitingSent: { 's-zed': question(when(9, 10), { 'i-milk': 4 }) } },
    });
    await atList(source);
    expect(screen.queryByText(/did it go\?/)).not.toBeInTheDocument();
  });
});

describe('answering on a banner', () => {
  const ALP = when(10, 42);
  const ZED = when(9, 10);
  const alpSentence = `Order to Alpine Mills sent at ${clock(ALP)}: did it go?`;
  const zedSentence = `Order to Zed sent at ${clock(ZED)}: did it go?`;

  it('while it answers both buttons wait (aria-disabled, never disabled), the focus stays, a second press is ignored', async () => {
    const source = withQuestions({ 's-alp': question(ALP, { 'i-flour': 2 }) });
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const claim = source.claimAwaitingSent.bind(source);
    const claimed = vi.fn(async (id: string, at: string) => { await gate; return claim(id, at); });
    source.claimAwaitingSent = claimed;
    const view = await atList(source);
    await screen.findByText(alpSentence);
    const yes = yesFor(alpSentence);
    await view.user.click(yes);
    await waitFor(() => { expect(yes).toHaveAttribute('aria-disabled', 'true'); });
    expect(noFor(alpSentence)).toHaveAttribute('aria-disabled', 'true');
    expect(yes).not.toBeDisabled();
    expect(yes).toHaveFocus();
    await view.user.click(yes);
    await view.user.click(noFor(alpSentence));
    release();
    await waitFor(() => { expect(source.records.has(`${TODAY}_s-alp`)).toBe(true); });
    expect(claimed).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Alpine Mills — order saved to history ✓')).toBeInTheDocument();
  });

  it('moves the focus to the NEXT row’s «Yes» when the answered row goes, and to the search box after the last', async () => {
    const source = withQuestions({ 's-alp': question(ALP, { 'i-flour': 2 }), 's-zed': question(ZED, { 'i-milk': 4 }) });
    const view = await atList(source);
    await screen.findByText(zedSentence);
    await view.user.click(noFor(zedSentence));
    await waitFor(() => { expect(screen.queryByText(zedSentence)).not.toBeInTheDocument(); });
    expect(yesFor(alpSentence)).toHaveFocus();
    expect(await screen.findByText('Not recorded: the quantities for Zed stay in the order.')).toBeInTheDocument();
    await view.user.click(noFor(alpSentence));
    await waitFor(() => { expect(screen.queryByText(alpSentence)).not.toBeInTheDocument(); });
    expect(screen.getByRole('searchbox', { name: /Search/ })).toHaveFocus();
    // «No» keeps the quantities in the order.
    expect(source.records.size).toBe(0);
    expect(Object.keys(asking(source))).toEqual([]);
    expect((source.draft?.entries as Record<string, { qty: number }>)['i-flour']?.qty).toBe(2);
  });

  it('asks «It may already be recorded» only when History holds the order; «Don’t record» says so and drops the question', async () => {
    const source = withQuestions({ 's-alp': question(ALP, { 'i-flour': 2 }) });
    source.records.set(`${TODAY}_s-alp`, {
      date: TODAY, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 2 }, stock: {}, names: { 'i-flour': 'Flour 00' },
      createdAt: `${TODAY}T07:00:00.000Z`, updatedAt: `${TODAY}T07:00:00.000Z`,
    });
    const view = await atList(source);
    await screen.findByText(alpSentence);
    await view.user.click(yesFor(alpSentence));
    const dialog = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(dialog.getByText('It may already be recorded')).toBeInTheDocument();
    expect(dialog.getByText('History already has this order to Alpine Mills for that day: another device may have recorded it. Record it again?')).toBeInTheDocument();
    await view.user.click(dialog.getByRole('button', { name: 'Don’t record' }));
    expect(await screen.findByText('Not recorded.')).toBeInTheDocument();
    await waitFor(() => { expect(Object.keys(asking(source))).toEqual([]); });
    expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2 });
  });

  it('⚠️ words a unit clash by the day the order was FOR, not today', async () => {
    const day = new Date();
    day.setDate(day.getDate() - 2);
    const date = new Intl.DateTimeFormat('en-CA').format(day);
    const source = withQuestions({ 's-alp': { at: when(10, 42, 2), date, quantities: { 'i-flour': 2 }, units: { 'i-flour': 'sack' } } });
    // The day's record already holds the same line in another unit, and fewer: no «may already be recorded» question, a refusal.
    source.records.set(`${date}_s-alp`, {
      date, supplierId: 's-alp', supplierName: 'Alpine Mills', quantities: { 'i-flour': 1 }, stock: {}, names: {}, units: { 'i-flour': 'box' },
      createdAt: when(9, 0, 2), updatedAt: when(9, 0, 2),
    });
    // A real database takes a round trip to put the refused question back: until then it is not on the page, and the notice must still
    // know its day.
    vi.spyOn(source, 'restoreAwaitingSentIfAbsent').mockImplementation(() => new Promise<boolean>(() => {}));
    const view = await atList(source);
    await view.user.click(await screen.findByRole('button', { name: /^(Yes|Sì)$/, description: /^Order to Alpine Mills sent/ }));
    const notice = within(await screen.findByRole('alertdialog', undefined, LOAD));
    expect(notice.getByText(/Already ordered from this supplier/)).toBeInTheDocument();
    expect(notice.queryByText(/today/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Order to Alpine Mills sent/)).not.toBeInTheDocument();
  });

  it('says «Already answered on another device.» when the question is gone by the time «Yes» is pressed', async () => {
    const source = withQuestions({ 's-alp': question(ALP, { 'i-flour': 2 }) });
    const view = await atList(source);
    await screen.findByText(alpSentence);
    const yes = yesFor(alpSentence);
    // Another device answers first: the banner is still on screen for a moment, with a claim that now fails.
    source.claimAwaitingSent = () => Promise.resolve(false);
    await view.user.click(yes);
    expect(await screen.findByText('Already answered on another device.')).toBeInTheDocument();
    expect(source.records.size).toBe(0);
  });
});

describe('the sender’s own dialog', () => {
  async function toSupplier(source: FakeOrdersSource) {
    const view = renderOrders('/orders/supplier/s-alp', { source, ...STAFF });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    return view;
  }
  const sendIcon = () => screen.getByRole('button', { name: 'Send the order to Alpine Mills' });
  async function pressEditorSend(view: Awaited<ReturnType<typeof toSupplier>>) {
    const editor = within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD));
    await waitFor(() => { expect(editor.getByRole('button', { name: 'Send' })).toBeEnabled(); }, LOAD);
    await view.user.click(editor.getByRole('button', { name: 'Send' }));
  }
  function allowShare() {
    Object.defineProperty(navigator, 'canShare', { value: vi.fn(() => true), configurable: true });
    Object.defineProperty(navigator, 'share', { value: vi.fn(() => Promise.resolve()), configurable: true });
  }
  const visibility = (state: 'visible' | 'hidden') => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const askedDialog = () => screen.findByRole('alertdialog', { name: /^Order to Alpine Mills sent at .+: did it go\?$/ }, LOAD);

  it('after the share sheet answered, asks at once: «Yes» / «No», and NO cancel', async () => {
    allowShare();
    const source = seeded({ draft: DRAFT });
    const view = await toSupplier(source);
    await view.user.click(sendIcon());
    await pressEditorSend(view);
    const dialog = within(await askedDialog());
    expect(dialog.getByRole('button', { name: 'Yes' })).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'No' })).toBeInTheDocument();
    expect(dialog.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
    // The order was written whole, with what was typed when «Send» was pressed.
    expect(asking(source)['s-alp']).toMatchObject({ quantities: { 'i-flour': 2, 'i-rye': 3 }, date: TODAY });
    await view.user.click(dialog.getByRole('button', { name: 'Yes' }));
    await waitFor(() => { expect(source.records.get(`${TODAY}_s-alp`)?.quantities).toEqual({ 'i-flour': 2, 'i-rye': 3 }); });
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
  });

  it('after a window was opened, waits for the page to come back', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const source = seeded({ draft: DRAFT });
    const view = await toSupplier(source);
    await view.user.click(sendIcon());
    await pressEditorSend(view);
    await waitFor(() => { expect(Object.keys(asking(source))).toEqual(['s-alp']); });
    // The banner asks meanwhile; the dialog does not.
    expect(await screen.findByText(/^Order to Alpine Mills sent at/)).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    act(() => { visibility('hidden'); });
    act(() => { visibility('visible'); });
    expect(await askedDialog()).toBeInTheDocument();
  });

  it('CLOSES ITSELF when another device answered, and says so', async () => {
    allowShare();
    const source = seeded({ draft: DRAFT });
    const view = await toSupplier(source);
    await view.user.click(sendIcon());
    await pressEditorSend(view);
    await askedDialog();
    act(() => {
      const next = structuredClone(source.draft ?? {}) as { awaitingSent?: Record<string, unknown> };
      delete next.awaitingSent?.['s-alp'];
      source.draft = next;
      source.emit();
    });
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(await screen.findByText('Already answered on another device.')).toBeInTheDocument();
  });

  it('⚠️ stays open while the page is hidden: the store stops asking then, and nobody has answered', async () => {
    allowShare();
    const source = seeded({ draft: DRAFT });
    const view = await toSupplier(source);
    await view.user.click(sendIcon());
    await pressEditorSend(view);
    await askedDialog();
    act(() => { visibility('hidden'); });
    // Any snapshot while hidden makes the store drop its wish to ask.
    act(() => {
      const next = structuredClone(source.draft ?? {}) as { entries?: Record<string, unknown> };
      next.entries = { ...next.entries, 'i-milk': { qty: 9 } };
      source.draft = next;
      source.emit();
    });
    await new Promise(resolve => { setTimeout(resolve, 50); });
    expect(screen.queryByText('Already answered on another device.')).not.toBeInTheDocument();
    expect(screen.getByRole('alertdialog', { name: /did it go\?$/ })).toBeInTheDocument();
  });

  it('is never opened over another dialog; it asks when the way is clear', async () => {
    const source = withQuestions({}, DRAFT);
    const view = await toSupplier(source);
    // Some other dialog is already up when the question arrives.
    const other = document.createElement('div');
    other.setAttribute('role', 'dialog');
    other.setAttribute('data-test-dialog', '');
    document.body.appendChild(other);
    allowShare();
    await view.user.click(sendIcon());
    // The editor is a dialog too: wait for it to be on screen and send; the question must not stack on the other dialog.
    await pressEditorSend(view);
    await waitFor(() => { expect(Object.keys(asking(source))).toEqual(['s-alp']); });
    expect(screen.queryByRole('alertdialog', { name: /did it go\?/ })).not.toBeInTheDocument();
    other.remove();
    expect(await askedDialog()).toBeInTheDocument();
  });

  it('is left to the banner by Escape: the question stays on the page', async () => {
    allowShare();
    const source = seeded({ draft: DRAFT });
    const view = await toSupplier(source);
    await view.user.click(sendIcon());
    await pressEditorSend(view);
    await askedDialog();
    await view.user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument(); });
    expect(Object.keys(asking(source))).toEqual(['s-alp']);
    expect(screen.getAllByText(/^Order to Alpine Mills sent at/).length).toBeGreaterThan(0);
  });
});

describe('«Send» on a supplier’s own screen', () => {
  it('writes the question with exactly what was typed at the press', async () => {
    vi.spyOn(window, 'open').mockImplementation(() => ({ opener: null }) as unknown as Window);
    const source = seeded({ draft: DRAFT });
    const view = renderOrders('/orders/supplier/s-alp', { source, ...STAFF });
    await screen.findAllByRole('spinbutton', undefined, LOAD);
    await view.user.click(screen.getByRole('button', { name: 'Send the order to Alpine Mills' }));
    const editor = within(await screen.findByRole('dialog', { name: 'Check the order' }, LOAD));
    await waitFor(() => { expect(editor.getByRole('button', { name: 'Send' })).toBeEnabled(); }, LOAD);
    await view.user.click(editor.getByRole('button', { name: 'Send' }));
    await waitFor(() => { expect(Object.keys(asking(source))).toEqual(['s-alp']); });
    expect(asking(source)['s-alp']).toMatchObject({ quantities: { 'i-flour': 2, 'i-rye': 3 } });
    expect(source.records.size).toBe(0);
  });
});
