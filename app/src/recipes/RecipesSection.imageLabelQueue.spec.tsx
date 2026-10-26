import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { STALE_AFTER_MS, isSingleLabel } from '@mise/shared/print-queue-model';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, renderRecipes } from '../testing/renderRecipes';
import type { StoredDoc } from './recipesSource';
import { closePrintHost } from './printHost';

// The «with logo» label's Print button (step 1b): the road is the shop computer's heartbeat. A fresh beat from an agent
// that knows the image label queues the job; a stale or old one, or none, keeps the system's print dialog and says why
// (except «none», which says nothing). jsdom has no 2D canvas, so the drawing is a stand-in, as in the image label spec.

const canvas = vi.hoisted(() => ({
  bitmap: null as unknown,
  render: vi.fn(),
  paint: vi.fn(),
  png: vi.fn(),
  load: vi.fn(),
}));
vi.mock('./labelCanvas', () => ({
  renderLogoLabelBitmap: (...args: unknown[]) => canvas.render(...args) as unknown,
  paintBitmap: (...args: unknown[]) => canvas.paint(...args) as unknown,
  bitmapPng: (...args: unknown[]) => canvas.png(...args) as unknown,
  loadLogoImage: (...args: unknown[]) => canvas.load(...args) as unknown,
}));

vi.mock('./labelFonts', async importOriginal => {
  const original = await importOriginal<typeof import('./labelFonts')>();
  return { ...original, useLabelFonts: () => 'ready' as const };
});

const PNG = 'data:image/png;base64,PNGPNG';
const emptyBitmap = () => ({ width: 640, height: 480, bytesPerRow: 80, bits: new Uint8Array(80 * 480) });

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => {
  window.localStorage.clear();
  canvas.bitmap = emptyBitmap();
  canvas.render.mockImplementation(() => canvas.bitmap);
  canvas.paint.mockImplementation(() => undefined);
  canvas.png.mockImplementation(() => PNG);
  canvas.load.mockImplementation(() => Promise.resolve({}));
});

afterEach(() => {
  act(() => { closePrintHost(); });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  canvas.render.mockReset();
  canvas.paint.mockReset();
  canvas.png.mockReset();
  canvas.load.mockReset();
  window.localStorage.clear();
});

const NUTRITION = { kj: 1000, kcal: 240, fat: 2, saturates: 1, carbs: 50, sugars: 3, protein: 8, salt: 0.5 };
const declared = (id: string, allergens: string[]): StoredDoc =>
  ({ id, name: id, allergens, allergensCheckedAt: '2026-01-01', nutrition: NUTRITION });
const INGREDIENTS = [declared('flour', ['gluten-wheat']), declared('milk', ['milk'])];
const row = (label: string, refId: string) => ({ label, grams: 100, unit: 'g', refId });
const CLEAN_TEXT = 'farina di GRANO, LATTE, zucchero';
const cake = (text = CLEAN_TEXT): StoredDoc =>
  ({ id: 'cake', name: 'Cake', ingredients: [row('Flour', 'flour'), row('Milk', 'milk')], labelIngredientsText: text });

const LOGO = { png: 'data:image/png;base64,AAAA', width: 1320, height: 300 };
const MIN = 60_000;
const beat = (agoMs: number, version?: string): StoredDoc =>
  ({ id: 'pc', lastSeenAt: new Date(Date.now() - agoMs).toISOString(), ...(version === undefined ? {} : { version }) });
const READY = () => [beat(MIN, '1.1.0')];

function open(printAgents: StoredDoc[], { lang = 'en', text }: { lang?: 'en' | 'it'; text?: string } = {}) {
  const source = fakeRecipesSource({
    recipes: [cake(text)], ingredients: INGREDIENTS, labelConfig: { template: 'logo' }, logo: LOGO, printAgents,
  });
  const view = renderRecipes('/recipes/cake/label', { source, lang, session: { location: { country: 'IT' }, language: lang } });
  return { ...view, source };
}

const main = () => within(screen.getByRole('main'));
const preview = (name = 'Label preview, 80 × 60 mm') => main().findByRole('img', { name }, LOAD);
const printButton = (name: string | RegExp = /^(Print|Print dialog|Stampa|Finestra di stampa)$/) => main().getByRole('button', { name });
const READY_SENTENCE = 'Printer ready: Print sends the label to the shop computer.';
const OFFLINE = /^The shop computer is not answering, so labels print through this device’s print dialog/;
const OUTDATED = /^The printing program on the shop computer is too old for this label/;
const QUEUED = 'Sent to the shop computer — it prints it';
const COPIES_QUEUE = 'Counts for Print and for the printer code.';
const COPIES_DIALOG = 'For the printer code. When printing from this screen, choose the copies in the print window.';

describe('a fresh beat from an agent that knows the image label: the queue', () => {
  it('says the printer is ready, and one tap queues one job that the agent would accept, without the print dialog', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { source, user } = open(READY());
    await preview();
    const sentence = main().getByText(READY_SENTENCE);
    expect(sentence.closest('[role="status"]')).not.toBeNull();
    expect(printButton()).toHaveTextContent('Print');
    expect(printButton()).not.toHaveTextContent('Print dialog');
    expect(main().getByText(COPIES_QUEUE)).toBeInTheDocument();

    await user.click(printButton());
    expect(await main().findByText(QUEUED)).toBeInTheDocument();
    expect(source.jobs).toHaveLength(1);
    const [job] = source.jobs as [Record<string, unknown>];
    expect(job).toMatchObject({ bakery: 'bakery', status: 'queued', copies: 1, createdBy: 'u1' });
    expect(isSingleLabel(job.payload)).toBe(true);
    expect(job.payload as string).toContain('^GFA');
    expect(print).not.toHaveBeenCalled();
    expect(document.getElementById('labelPrint')).toBeNull();
  });

  it('⚠️ the job carries the Copies box twice: the job and the payload\'s ^PQ', async () => {
    const { source, user } = open(READY());
    await preview();
    const copies = main().getByRole('spinbutton', { name: 'Copies' });
    await user.clear(copies);
    await user.type(copies, '3');
    await user.click(printButton());
    await waitFor(() => { expect(source.jobs).toHaveLength(1); });
    const [job] = source.jobs as [Record<string, unknown>];
    expect(job.copies).toBe(3);
    expect(job.payload as string).toContain('^PQ3');
  });

  it('says «sent», never «printed», and announces the action', async () => {
    const actions: string[] = [];
    const listen = (event: Event) => { actions.push(String((event as CustomEvent).detail)); };
    window.addEventListener('mise:action', listen);
    try {
      const { user } = open(READY());
      await preview();
      await user.click(printButton());
      const note = await main().findByText(QUEUED);
      expect(note.closest('[role="status"]')).not.toBeNull();
      expect(main().queryByText(/printed/i)).toBeNull();
      expect(actions).toContain('label-printed');
      expect(printButton()).toBeEnabled();
    } finally {
      window.removeEventListener('mise:action', listen);
    }
  });

  it('says it could not send when the queue refuses, records nothing, and lets the person try again', async () => {
    const { source, user } = open(READY());
    await preview();
    source.refuse.queue = true;
    await user.click(printButton());
    expect(await main().findByText('Could not send it — try again')).toBeInTheDocument();
    expect(source.jobs).toHaveLength(0);
    expect(printButton()).toBeEnabled();
  });

  it('⚠️ two taps inside one frame queue exactly one job, and Print is dead while it is in flight', async () => {
    const { source } = open(READY());
    await preview();
    const release = source.holdQueue();
    const button = printButton();
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    expect(printButton()).toBeDisabled();
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => { expect(source.jobs).toHaveLength(1); });
    expect(source.queuePrintJob).toHaveBeenCalledTimes(1);
    expect(await main().findByText(QUEUED)).toBeInTheDocument();
    expect(printButton()).toBeEnabled();
  });

  it('⚠️ a text with check errors keeps Print off and queues nothing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { source } = open(READY(), { text: 'farina di grano, LATTE' });
    await preview();
    expect(printButton()).toBeDisabled();
    fireEvent.click(printButton());
    await new Promise(resolve => { setTimeout(resolve, 20); });
    expect(source.jobs).toHaveLength(0);
    expect(source.queuePrintJob).not.toHaveBeenCalled();
    expect(print).not.toHaveBeenCalled();
  });

  it('⚠️ re-judges the beat at tap time: one gone stale since the draw queues nothing and the screen says so', async () => {
    const { source } = open(READY());
    await preview();
    expect(main().queryByText(OFFLINE)).toBeNull();
    const realNow = Date.now.bind(Date);
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + STALE_AFTER_MS + MIN);
    await act(async () => { fireEvent.click(printButton()); });
    expect(source.queuePrintJob).not.toHaveBeenCalled();
    expect(source.jobs).toHaveLength(0);
    expect(await main().findByText(OFFLINE)).toBeVisible();
    expect(printButton()).toHaveTextContent('Print dialog');
    expect(main().queryByText(READY_SENTENCE)).toBeNull();
  });

  it('forgets «sent» when the road changes', async () => {
    const { source, user } = open(READY());
    await preview();
    await user.click(printButton());
    expect(await main().findByText(QUEUED)).toBeInTheDocument();
    act(() => { source.setPrintAgents([beat(STALE_AFTER_MS + MIN, '1.1.0')]); });
    expect(await main().findByText(OFFLINE)).toBeVisible();
    expect(main().queryByText(QUEUED)).toBeNull();
  });

  // ⚠️ Code review, 26 Oct 2026: an offline tablet's queue write never lands; once the beat goes stale the button is the
  // print dialog, and a send still hanging must not keep it off.
  it('⚠️ a send that hangs does not keep the print dialog off once the beat has gone stale', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { source } = open(READY());
    await preview();
    source.holdQueue();
    await act(async () => { fireEvent.click(printButton()); });
    expect(printButton()).toBeDisabled();
    act(() => { source.setPrintAgents([beat(STALE_AFTER_MS + MIN, '1.1.0')]); });
    expect(await main().findByText(OFFLINE)).toBeVisible();
    expect(printButton()).toHaveTextContent('Print dialog');
    expect(printButton()).toBeEnabled();
    fireEvent.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
  });
});

describe('no queue: the system print dialog', () => {
  it('a stale beat: the sentence, «Print dialog», and a tap opens the dialog and queues nothing', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { source, user } = open([beat(STALE_AFTER_MS + MIN, '1.1.0')]);
    await preview();
    const sentence = main().getByText(OFFLINE);
    expect(sentence.closest('[role="status"]')).not.toBeNull();
    expect(sentence).toHaveClass('lab-nofit');
    expect(printButton()).toHaveTextContent('Print dialog');
    expect(printButton()).toBeEnabled();
    expect(main().getByText(COPIES_DIALOG)).toBeInTheDocument();
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
    expect(source.jobs).toHaveLength(0);
    expect(source.queuePrintJob).not.toHaveBeenCalled();
  });

  it('an agent that is too old: its own sentence, «Print dialog», and the dialog opens', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { source, user } = open([beat(MIN, '1.0.1')]);
    await preview();
    expect(main().getByText(OUTDATED)).toBeVisible();
    expect(main().queryByText(OFFLINE)).toBeNull();
    expect(printButton()).toHaveTextContent('Print dialog');
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
    expect(source.jobs).toHaveLength(0);
  });

  it('no agent at all: nothing is said, «Print» opens the dialog as it always did', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const { source, user } = open([]);
    await preview();
    expect(main().queryByText(READY_SENTENCE)).toBeNull();
    expect(main().queryByText(OFFLINE)).toBeNull();
    expect(main().queryByText(OUTDATED)).toBeNull();
    expect(printButton()).toHaveTextContent(/^Print$/);
    expect(main().getByText(COPIES_DIALOG)).toBeInTheDocument();
    await user.click(printButton());
    expect(print).toHaveBeenCalledTimes(1);
    expect(source.jobs).toHaveLength(0);
  });

  it('keeps the status region for the sentence even when there is nothing to say', async () => {
    open([]);
    await preview();
    const regions = Array.from(document.querySelectorAll('main [role="status"]'));
    expect(regions.some(region => region.nextElementSibling?.contains(printButton()))).toBe(true);
    expect(regions.find(region => region.nextElementSibling?.contains(printButton()))?.textContent).toBe('');
  });
});

describe('in Italian', () => {
  it('says «Stampante pronta…» and calls the button «Stampa»', async () => {
    const { source, user } = open(READY(), { lang: 'it' });
    await preview('Anteprima dell’etichetta, 80 × 60 mm');
    expect(main().getByText('Stampante pronta: Stampa manda l’etichetta al computer del negozio.')).toBeInTheDocument();
    expect(printButton()).toHaveTextContent('Stampa');
    await user.click(printButton());
    expect(await main().findByText('Mandata al computer del negozio — la stampa lui')).toBeInTheDocument();
    expect(source.jobs).toHaveLength(1);
  });
});
