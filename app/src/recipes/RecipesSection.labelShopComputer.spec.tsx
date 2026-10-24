import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { HEARTBEAT_MS, STALE_AFTER_MS, isSingleLabel } from '@mise/shared/print-queue-model';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';
import { closePrintHost } from './printHost';
import { PRESENCE_RECHECK_MS } from './usePresenceClock';

// The label screen on a Zebra venue (step 3d-4): the shop computer's print queue and the printer code on the
// clipboard. ⚠️ Nobody can see from the app whether the paper came out, so the only thing this road may ever say is
// «sent»; and a screen that offers a queue nobody is reading is a tap that looks like it worked. These specs pin the
// words, the job's exact shape (the rules refuse any other), and the clock that keeps the offer honest.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  act(() => { closePrintHost(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, 'clipboard');
  window.localStorage.clear();
});

const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const declared = (id: string, allergens: string[]): StoredDoc =>
  ({ id, name: id, allergens, allergensCheckedAt: '2026-01-01', nutrition: NUTRITION });
const INGREDIENTS = [declared('flour', ['gluten-wheat']), declared('milk', ['milk']), declared('salt', [])];
const CAKE: StoredDoc = {
  id: 'cake', name: 'Cake',
  ingredients: [
    { label: 'Flour', grams: 500, unit: 'g', refId: 'flour' },
    { label: 'Milk', grams: 300, unit: 'g', refId: 'milk' },
    { label: 'Salt', grams: 10, unit: 'g', refId: 'salt' },
  ],
};

// A roomy Zebra label: the shared ZPL writer's estimate must say it fits.
const ZEBRA = { printerLanguage: 'zpl', widthMm: 102, heightMm: 152 };
// Forty ingredients with long names: more than any 25 × 20 mm label can hold at the legal floor.
const LONG_INGREDIENTS = Array.from({ length: 40 }, (_, i) => declared(`ingredient-number-${i}`, []));
const LONG: StoredDoc = {
  id: 'cake', name: 'Long',
  ingredients: LONG_INGREDIENTS.map(doc => ({ label: doc.name, grams: 10, unit: 'g', refId: doc.id })),
};
const GB = { country: 'GB' };
const IT = { country: 'IT' };

const MIN = 60_000;
const beat = (agoMs: number, id = 'pc'): StoredDoc => ({ id, lastSeenAt: new Date(Date.now() - agoMs).toISOString() });

const main = () => within(screen.getByRole('main'));
const printButton = () => main().getByRole('button', { name: /^(Print|Stampa|Copy the printer code|Copia il codice per la stampante|Print dialog)$/ });
const offline = () => main().queryByText(/^The shop computer is not answering/);

function stubLayout() {
  vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => 400);
  vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(() => 100);
  vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(() => 100);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(() => 287);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => 192);
}

function withClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

// ⚠️ userEvent.setup() (inside renderApp) installs a clipboard of its own on `navigator`, so a spec's clipboard is
// set AFTER the render and a «no clipboard» spec removes that one. The screen asks at draw time, and the data only
// arrives after the render has returned, so the first real draw sees what is set here.
type Clipboard = 'none' | 'works' | 'refuses' | ((text: string) => Promise<void>);

async function openZebra(printAgents: StoredDoc[], options: {
  labelConfig?: Record<string, unknown>; lang?: 'en' | 'it'; location?: Record<string, unknown>; clipboard?: Clipboard;
  recipe?: StoredDoc; ingredients?: StoredDoc[];
} = {}) {
  stubLayout();
  const source = fakeRecipesSource({
    recipes: [options.recipe ?? CAKE], ingredients: options.ingredients ?? INGREDIENTS, labelConfig: options.labelConfig ?? ZEBRA, printAgents,
  });
  const view = renderRecipes('/recipes/cake/label', {
    source, lang: options.lang, session: { location: options.location ?? GB, language: options.lang ?? 'en' },
  });
  const clipboard = options.clipboard ?? 'none';
  Reflect.deleteProperty(navigator, 'clipboard');
  if (clipboard === 'works') withClipboard(() => Promise.resolve());
  else if (clipboard === 'refuses') withClipboard(() => Promise.reject(new Error('no')));
  else if (clipboard !== 'none') withClipboard(clipboard);
  await screen.findByRole('group', { name: /^(What the label shows|Cosa mostra l’etichetta)$/ }, LOAD);
  return { ...view, source };
}

describe('a fresh heartbeat: the agent road', () => {
  it('offers «Print», and one tap queues exactly one job in the shape the rules accept', async () => {
    const { source, user } = await openZebra([beat(MIN)]);
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(printButton()).toHaveTextContent('Print');
    expect(offline()).toBeNull();
    await user.click(printButton());
    await waitFor(() => { expect(source.jobs).toHaveLength(1); });

    const [job] = source.jobs as [Record<string, unknown>];
    // firestore.rules: keys hasOnly bakery, status, payload, copies, createdAt, createdBy.
    expect(Object.keys(job).sort()).toEqual(['bakery', 'copies', 'createdAt', 'createdBy', 'payload', 'status']);
    expect(job).toMatchObject({ bakery: 'bakery', status: 'queued', copies: 1, createdBy: 'u1' });
    expect(typeof job.createdAt).toBe('string');
    expect(Number.isNaN(Date.parse(job.createdAt as string))).toBe(false);
    expect(typeof job.payload).toBe('string');
    expect(job.payload as string).not.toContain('~');
    expect((job.payload as string).startsWith('^XA')).toBe(true);
    // The agent prints only what it recognises as one label: the job must pass its own check.
    expect(isSingleLabel(job.payload)).toBe(true);
  });

  it('⚠️ says «sent», never «printed», announces the action, and leaves Print usable again', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const { user } = await openZebra([beat(MIN)]);
      await waitFor(() => { expect(printButton()).toBeEnabled(); });
      await user.click(printButton());
      const sentence = await screen.findByText('Sent to the shop computer — it prints it');
      expect(sentence.closest('[role="status"]')).not.toBeNull();
      expect(main().queryByText(/printed/i)).toBeNull();
      expect(actions).toContain('label-printed');
      expect(printButton()).toBeEnabled();
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });

  it('⚠️ forgets its answer when the road changes: «sent» never stands beside «not answering», nor «copied» beside Print', async () => {
    const { source, user } = await openZebra([beat(MIN)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    await user.click(printButton());
    expect(await screen.findByText('Sent to the shop computer — it prints it')).toBeInTheDocument();

    act(() => { source.setPrintAgents([]); });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Copy the printer code'); });
    expect(offline()).toBeVisible();
    expect(main().queryByText('Sent to the shop computer — it prints it')).toBeNull();

    await user.click(printButton());
    expect(await screen.findByText('Copied — paste it onto the printer on the shop computer')).toBeInTheDocument();
    act(() => { source.setPrintAgents([beat(MIN)]); });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    expect(main().queryByText('Copied — paste it onto the printer on the shop computer')).toBeNull();
  });

  it('says it could not send when the queue refuses, records nothing, and lets the person try again', async () => {
    const { source, user } = await openZebra([beat(MIN)]);
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    source.refuse.queue = true;
    await user.click(printButton());
    expect(await screen.findByText('Could not send it — try again')).toBeInTheDocument();
    expect(source.jobs).toHaveLength(0);
    expect(printButton()).toBeEnabled();
    expect(main().queryByText('Sent to the shop computer — it prints it')).toBeNull();

    source.refuse.queue = false;
    await user.click(printButton());
    expect(await screen.findByText('Sent to the shop computer — it prints it')).toBeInTheDocument();
    // The failure sentence went first: a new send never shows the old answer.
    expect(main().queryByText('Could not send it — try again')).toBeNull();
    expect(source.jobs).toHaveLength(1);
  });

  it('⚠️ is dead while the job is in flight: a second tap queues nothing, and the answer comes once it lands', async () => {
    const { source, user } = await openZebra([beat(MIN)]);
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    const release = source.holdQueue();
    await user.click(printButton());
    await waitFor(() => { expect(printButton()).toBeDisabled(); });
    await user.click(printButton());
    expect(main().queryByText('Sent to the shop computer — it prints it')).toBeNull();
    await act(async () => { release(); await Promise.resolve(); });
    expect(await screen.findByText('Sent to the shop computer — it prints it')).toBeInTheDocument();
    expect(source.jobs).toHaveLength(1);
    expect(source.queuePrintJob).toHaveBeenCalledTimes(1);
    expect(printButton()).toBeEnabled();
  });

  it('⚠️ two taps inside ONE frame queue exactly one job: the ref guards, not the disabled button', async () => {
    const { source } = await openZebra([beat(MIN)]);
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    const release = source.holdQueue();
    const button = printButton();
    // React has not re-rendered between the two clicks, so the button is still enabled for the second one.
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(source.jobs).toHaveLength(1); });
    expect(source.queuePrintJob).toHaveBeenCalledTimes(1);
  });

  it('does nothing on a label nobody could measure', async () => {
    const source = fakeRecipesSource({ recipes: [CAKE], ingredients: INGREDIENTS, labelConfig: ZEBRA, printAgents: [beat(MIN)] });
    renderRecipes('/recipes/cake/label', { source, session: { location: GB } });
    await screen.findByRole('group', { name: 'What the label shows' }, LOAD);
    expect(printButton()).toBeDisabled();
    expect(source.jobs).toHaveLength(0);
  });

  it('is the first road even when the clipboard exists too', async () => {
    await openZebra([beat(MIN)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(printButton()).toHaveTextContent('Print');
    expect(main().queryByRole('button', { name: 'Copy the printer code' })).toBeNull();
  });

  it('says it in Italian, on an Italian venue', async () => {
    const { source, user } = await openZebra([beat(MIN)], { lang: 'it', location: IT });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(printButton()).toHaveTextContent('Stampa');
    await user.click(printButton());
    expect(await screen.findByText('Mandata al computer del negozio — la stampa lui')).toBeInTheDocument();
    expect(source.jobs).toHaveLength(1);
  });

  it('says the failure in Italian too', async () => {
    const { source, user } = await openZebra([beat(MIN)], { lang: 'it', location: IT });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    source.refuse.queue = true;
    await user.click(printButton());
    expect(await screen.findByText('Non è riuscita a partire — riprova')).toBeInTheDocument();
  });
});

describe('a silent shop computer: the explanation, and the clipboard as a fallback', () => {
  it.each([
    ['no agent at all', () => []],
    ['a heartbeat three beats old', () => [beat(STALE_AFTER_MS + MIN)]],
    ['a heartbeat from a clock a long way ahead', () => [beat(-(HEARTBEAT_MS + MIN))]],
    ['a heartbeat nobody wrote', () => [{ id: 'pc' } as StoredDoc]],
  ])('%s: «not answering», and Print is off when this device has no clipboard', async (_name, agents) => {
    await openZebra(agents());
    expect(printButton()).toBeDisabled();
    expect(printButton()).toHaveTextContent('Print');
    expect(offline()).toBeVisible();
    expect(main().queryByText(/does not fit/)).toBeNull();
  });

  it('offers «Copy the printer code» when there is a clipboard — and the sentence stays: a fallback never replaces the explanation', async () => {
    await openZebra([beat(STALE_AFTER_MS + MIN)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(printButton()).toHaveTextContent('Copy the printer code');
    expect(offline()).toBeVisible();
  });

  it('copies the printer code (it starts ^XA) and says where to paste it; nothing is queued', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    const { source, user } = await openZebra([], { clipboard: writeText });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    await user.click(printButton());
    expect(await screen.findByText('Copied — paste it onto the printer on the shop computer')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(1);
    const text = writeText.mock.calls[0]![0];
    expect(text.startsWith('^XA')).toBe(true);
    expect(isSingleLabel(text)).toBe(true);
    expect(source.jobs).toHaveLength(0);
    expect(source.queuePrintJob).not.toHaveBeenCalled();
  });

  it('says so when the clipboard refuses', async () => {
    const { user } = await openZebra([], { clipboard: 'refuses' });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    await user.click(printButton());
    expect(await screen.findByText('Could not copy — select the text above instead')).toBeInTheDocument();
  });

  it('⚠️ the screen reads whether a clipboard exists when it is drawn, not once for ever', async () => {
    const { user } = await openZebra([]);
    expect(printButton()).toBeDisabled();
    withClipboard(() => Promise.resolve());
    await user.click(main().getByRole('button', { name: 'Allergens' }));
    expect(printButton()).toBeEnabled();
    expect(printButton()).toHaveTextContent('Copy the printer code');
  });

  it('says the same in Italian', async () => {
    const { user } = await openZebra([], { lang: 'it', location: IT, clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(printButton()).toHaveTextContent('Copia il codice per la stampante');
    expect(main().getByText(/^Il computer del negozio non risponde/)).toBeVisible();
    await user.click(printButton());
    expect(await screen.findByText('Copiato — incollalo sulla stampante dal computer del negozio')).toBeInTheDocument();
  });
});

describe('a label that does not fit the Zebra', () => {
  it('says «does not fit» — never «not answering» — offers no road, and sends nothing, heartbeat or not', async () => {
    const { source } = await openZebra([beat(MIN)], { labelConfig: { printerLanguage: 'zpl', widthMm: 25, heightMm: 20 }, clipboard: 'works', recipe: LONG, ingredients: LONG_INGREDIENTS });
    await waitFor(() => { expect(main().getByText(/^This label does not fit on 25 × 20 mm/)).toBeVisible(); });
    expect(printButton()).toBeDisabled();
    expect(printButton()).toHaveTextContent('Print');
    expect(offline()).toBeNull();
    expect(main().queryByRole('button', { name: 'Copy the printer code' })).toBeNull();
    expect(source.jobs).toHaveLength(0);
  });
});

// The presence clock's own timers, found by their period among everything else the page starts, and the ids that
// are given back.
function watchPresenceClock() {
  const started: unknown[] = [];
  const cleared: unknown[] = [];
  const realSet = globalThis.setInterval.bind(globalThis);
  const realClear = globalThis.clearInterval.bind(globalThis);
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((handler: () => void, ms?: number) => {
    const id = realSet(handler, ms);
    if (ms === PRESENCE_RECHECK_MS) started.push(id);
    return id;
  }) as typeof setInterval);
  vi.spyOn(globalThis, 'clearInterval').mockImplementation(((id?: Parameters<typeof clearInterval>[0]) => {
    cleared.push(id);
    realClear(id);
  }) as typeof clearInterval);
  return { started, cleared };
}

describe('the venue whose printer is not a Zebra', () => {
  it('is unchanged: «Print dialog», no sentence about a shop computer, and no presence clock at all', async () => {
    const clock = watchPresenceClock();
    await openZebra([], { labelConfig: {} });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(printButton()).toHaveTextContent('Print dialog');
    expect(offline()).toBeNull();
    expect(clock.started).toHaveLength(0);
  });
});

describe('the clock that keeps the offer honest', () => {
  const fakeClock = () => vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], now: new Date(2026, 9, 14, 12) });

  it('⚠️ a heartbeat that goes stale while the screen is open flips it to «not answering» within 30 s, with no tap — and a new beat flips it back at once', async () => {
    fakeClock();
    const { source } = await openZebra([beat(STALE_AFTER_MS - 20_000)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    expect(printButton()).toBeEnabled();
    expect(offline()).toBeNull();

    // Only 20 s of freshness are left, so the first tick finds the beat stale.
    act(() => { vi.advanceTimersByTime(PRESENCE_RECHECK_MS); });
    expect(offline()).toBeVisible();
    expect(printButton()).toHaveTextContent('Copy the printer code');

    act(() => { source.setPrintAgents([beat(0)]); });
    expect(offline()).toBeNull();
    expect(printButton()).toHaveTextContent('Print');
  });

  it('keeps asking every 30 s: nothing flips before the beat is really stale, and it flips on the tick that crosses the limit', async () => {
    fakeClock();
    // 45 s of freshness left: the 30 s tick still finds it fresh, the 60 s tick does not.
    await openZebra([beat(STALE_AFTER_MS - 45_000)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    act(() => { vi.advanceTimersByTime(PRESENCE_RECHECK_MS); });
    expect(offline()).toBeNull();
    expect(printButton()).toHaveTextContent('Print');
    act(() => { vi.advanceTimersByTime(PRESENCE_RECHECK_MS); });
    expect(offline()).toBeVisible();
    expect(printButton()).toHaveTextContent('Copy the printer code');
  });

  it('⚠️ re-judges the heartbeat at tap time: a beat that went stale with no tick yet queues nothing and the screen says «not answering»', async () => {
    fakeClock();
    const { source } = await openZebra([beat(STALE_AFTER_MS - 20_000)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    expect(offline()).toBeNull();

    // The phone wakes from sleep: the clock has moved on, the interval has not fired yet.
    vi.setSystemTime(Date.now() + 60_000);
    await act(async () => { fireEvent.click(printButton()); });
    expect(source.queuePrintJob).not.toHaveBeenCalled();
    expect(source.jobs).toHaveLength(0);
    expect(offline()).toBeVisible();
    expect(printButton()).toHaveTextContent('Copy the printer code');
  });

  it('⚠️ a page that becomes visible again re-reads the clock at once', async () => {
    fakeClock();
    await openZebra([beat(STALE_AFTER_MS - 20_000)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    vi.setSystemTime(Date.now() + 60_000);
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(offline()).toBeVisible();
    expect(printButton()).toHaveTextContent('Copy the printer code');
  });

  it('⚠️ a send that never lands does not take the clipboard fallback with it', async () => {
    fakeClock();
    const { source } = await openZebra([beat(STALE_AFTER_MS - 20_000)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Print'); });
    source.holdQueue();
    await act(async () => { fireEvent.click(printButton()); });
    expect(printButton()).toBeDisabled();

    act(() => { vi.advanceTimersByTime(PRESENCE_RECHECK_MS); });
    expect(printButton()).toHaveTextContent('Copy the printer code');
    expect(printButton()).toBeEnabled();
    await act(async () => { fireEvent.click(printButton()); });
    expect(await screen.findByText('Copied — paste it onto the printer on the shop computer')).toBeInTheDocument();
    expect(source.jobs).toHaveLength(0);
  });

  it('⚠️ a send that lands after the road changed does not put «sent» back beside «not answering»', async () => {
    const { source, user } = await openZebra([beat(MIN)], { clipboard: 'works' });
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    const release = source.holdQueue();
    await user.click(printButton());
    act(() => { source.setPrintAgents([]); });
    await waitFor(() => { expect(printButton()).toHaveTextContent('Copy the printer code'); });

    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(source.jobs).toHaveLength(1); });
    expect(main().queryByText('Sent to the shop computer — it prints it')).toBeNull();
    expect(offline()).toBeVisible();
  });

  it('is started once for a Zebra and cleared when the screen is left', async () => {
    const clock = watchPresenceClock();
    const { router } = await openZebra([beat(MIN)]);
    await waitFor(() => { expect(printButton()).toBeEnabled(); });
    expect(clock.started).toHaveLength(1);
    expect(clock.cleared).not.toContain(clock.started[0]);
    await act(async () => { await router.navigate('/recipes'); });
    expect(clock.cleared).toContain(clock.started[0]);
  });
});
