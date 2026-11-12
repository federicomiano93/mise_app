import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { editorSource } from '../../testing/foodcostEditorFixtures';
import { LOAD, product, renderFoodcost } from '../../testing/renderFoodcost';
import { labDraftKey, serializeDraft } from './labDraft';
import { newDraft, startDraft } from './labModel';

// Lab mode, driven as a person drives it: the card, the door, the steps, the keypad, the clock, the save.

beforeAll(async () => { await import('../FoodcostSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  window.localStorage.clear();
});

const KEY = labDraftKey('bakery', 'Green');
const ITALY = { lang: 'it', session: { language: 'it', location: { country: 'IT' } } } as const;

// A kilo of flour (£2.00) and 20 g of salt in a batch of 10 pieces.
const GREEN = () => product('Green', {
  components: [
    { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' },
    { kind: 'ingredient', ingredientId: 'salt', qty: 20, unit: 'g' },
  ],
  labourMinutes: 30,
  labourPeople: 1,
  model: 3,
});

const source = (fields?: Record<string, unknown>, extra: Parameters<typeof editorSource>[1] = {}) =>
  editorSource([{ ...GREEN(), ...fields }], extra);

async function openCard(fake = source(), options = {}) {
  const view = renderFoodcost('/food-cost/product/Green', { source: fake, ...options });
  await screen.findByRole('button', { name: /^(Edit product|Modifica il prodotto)$/ }, LOAD);
  return { ...view, fake };
}

const enter = () => screen.getByRole('button', { name: /^(Produce in the lab|Produci in laboratorio)$/ });
const lab = () => screen.getByRole('dialog', { name: /^(Produce in the lab|Produci in laboratorio)$/ });

async function openLab(options = {}, fake = source()) {
  const view = await openCard(fake, options);
  await view.user.click(enter());
  await screen.findByRole('dialog', { name: /^(Produce in the lab|Produci in laboratorio)$/ }, LOAD);
  return view;
}

// The pad's key, by what is drawn on it.
const pad = (user: Awaited<ReturnType<typeof openLab>>['user']) => async (keys: string) => {
  for (const key of keys) {
    const name = key === '<' ? 'Delete one digit' : key === ',' ? 'Decimal comma' : key;
    await user.click(within(lab()).getByRole('button', { name }));
  }
};

const next = (user: Awaited<ReturnType<typeof openLab>>['user']) => user.click(within(lab()).getByRole('button', { name: 'Next' }));
const start = (user: Awaited<ReturnType<typeof openLab>>['user']) => user.click(within(lab()).getByRole('button', { name: 'Start' }));

describe('the door on the card', () => {
  it('is a big button right under the summary, and the form has none (so unsaved edits can never be mixed in)', async () => {
    const { user } = await openCard();
    const summary = screen.getByRole('group', { name: 'Summary per piece' });
    expect(enter().compareDocumentPosition(summary) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.queryByText(/^In the lab/)).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit product' }));
    await screen.findByRole('combobox', { name: 'Name' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Produce in the lab' })).not.toBeInTheDocument();
  });

  it('opens the lab full screen on «Inizia»: kicker, the name, the numbers, the start button, the hint; the clock greyed', async () => {
    await openLab();
    const dialog = lab();
    expect(within(dialog).getByText('Produce in the lab', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Green' })).toBeInTheDocument();
    expect(within(dialog).getByText('2 lines · 1,020 g of raw dough · 10 pieces')).toBeInTheDocument();
    expect(within(dialog).getByText('The timer starts.')).toBeInTheDocument();
    expect(within(dialog).getByRole('timer', { name: 'Timer' })).toHaveTextContent('0:00:00');
    expect(within(dialog).queryByRole('navigation', { name: 'Production steps' })).not.toBeInTheDocument();
    // Nothing is stored before the clock runs.
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe('the flow, step by step', () => {
  it('goes from «Inizia» to the saved card, writing the day\'s weights, the cooked weight, the pieces, the time and the people', async () => {
    const { user, fake } = await openLab();
    const press = pad(user);
    await start(user);

    // Ingredienti: tick flour without typing (the planned weight), type 22 g of salt on the keypad.
    const dialog = lab();
    expect(within(dialog).getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument();
    expect(within(dialog).getByText('0 of 2')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Done: Flour' }));
    expect(within(dialog).getByRole('button', { name: 'Done: Flour' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByText('1 of 2')).toBeInTheDocument();
    // The selection moved to the next line: the keypad types into salt.
    await press('22');
    await user.click(within(dialog).getByRole('button', { name: 'Done: Salt' }));
    expect(within(dialog).getByText('2 of 2')).toBeInTheDocument();
    await next(user);

    // Impasto crudo: preset with the total (1,000 + 22 g); typing another number offers «Use the total».
    expect(within(lab()).getByRole('heading', { name: 'Raw dough' })).toBeInTheDocument();
    expect(within(lab()).getByRole('button', { name: /^Raw dough:/ })).toHaveTextContent('1022');
    expect(within(lab()).getByText('It is the total of the ingredients')).toBeInTheDocument();
    await press('1030');
    expect(within(lab()).getByRole('button', { name: 'Use the total (1,022 g)' })).toBeInTheDocument();
    await next(user);

    // In forno: the clock, the hint.
    expect(within(lab()).getByRole('heading', { name: 'In the oven' })).toBeInTheDocument();
    expect(within(lab()).getByText('The timer keeps running. You can leave and come back.')).toBeInTheDocument();
    await next(user);

    // Impasto cotto: 927 g of 1,030 g raw is a 10.00% loss.
    await press('927');
    expect(within(lab()).getByText('Loss 10.00%')).toBeInTheDocument();
    await next(user);

    // Pezzi ottenuti: preset with the card's pieces.
    expect(within(lab()).getByRole('heading', { name: 'Pieces made' })).toBeInTheDocument();
    expect(within(lab()).getByText('On the card: 10')).toBeInTheDocument();
    await press('12');
    await next(user);

    // Tempo e persone: the timer's reading, two people.
    expect(within(lab()).getByText('From the timer')).toBeInTheDocument();
    await user.click(within(lab()).getByRole('button', { name: 'One person more' }));
    await next(user);

    // Risultato.
    expect(within(lab()).getByRole('heading', { name: 'Result' })).toBeInTheDocument();
    expect(within(lab()).getByText('10.00%')).toBeInTheDocument();
    expect(within(lab()).getByText('1 kg cooked')).toBeInTheDocument();
    expect(within(lab()).getByText('1 piece')).toBeInTheDocument();
    expect(within(lab()).getByText(/^Raw 1,030 g · cooked 927 g · 12 pieces · 1 minute · 2 people$/)).toBeInTheDocument();

    // Salva nella scheda: the question lists what changes.
    await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Save to the card of Green?')).toBeInTheDocument();
    expect(within(asked).getByText('Made of: today’s weights, 1 line changes')).toBeInTheDocument();
    expect(within(asked).getByText('Baking: raw 1,030 g, cooked 927 g')).toBeInTheDocument();
    expect(within(asked).getByText('Pieces per batch: 12')).toBeInTheDocument();
    expect(within(asked).getByText('Work: 1 minute, 2 people')).toBeInTheDocument();
    expect(within(asked).getByText('The margin history keeps a record.')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Save' }));

    // «Salvato nella scheda».
    await screen.findByRole('heading', { name: 'Saved to the card' }, LOAD);
    expect(screen.getByText('Loss, costs and time are on the card of Green.')).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).toBeNull();

    // What was written: the card's own save path, with its margin point.
    const write = fake.saved.find(item => item.kind === 'product');
    expect(write?.data).toMatchObject({
      rawGrams: 1030, cookedGrams: 927, piecesPerBatch: 12, labourMinutes: 1, labourPeople: 2, model: 3,
      components: [
        { kind: 'ingredient', ingredientId: 'flour', qty: 1000, unit: 'g' },
        { kind: 'ingredient', ingredientId: 'salt', qty: 22, unit: 'g' },
      ],
    });
    expect(write?.snapshot).toBeTruthy();

    // Back to the card: it follows the saved product.
    await user.click(screen.getByRole('button', { name: 'Back to the card' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Produce in the lab' })).not.toBeInTheDocument(); });
    expect(screen.getByRole('button', { name: 'Edit product' })).toBeInTheDocument();
  });

  it('has no «Pezzi ottenuti» for a product sold by weight', async () => {
    const { user } = await openLab({}, source({ sellingMode: 'weight', piecesPerBatch: null }));
    expect(within(lab()).getByText('2 lines · 1,020 g of raw dough')).toBeInTheDocument();
    await start(user);
    const dots = within(lab()).getByRole('navigation', { name: 'Production steps' });
    expect(within(dots).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(
      ['Ingredients', 'Raw dough', 'In the oven', 'Cooked dough', 'Time and people', 'Result'],
    );
  });

  it('marks the current step with aria-current and lets a dot jump to its step', async () => {
    const { user } = await openLab();
    await start(user);
    const dots = within(lab()).getByRole('navigation', { name: 'Production steps' });
    expect(within(dots).getByRole('button', { name: 'Ingredients' })).toHaveAttribute('aria-current', 'step');
    expect(within(dots).getAllByRole('button')).toHaveLength(7);
    await user.click(within(dots).getByRole('button', { name: 'Cooked dough' }));
    expect(within(lab()).getByRole('heading', { name: 'Cooked dough' })).toBeInTheDocument();
    expect(within(dots).getByRole('button', { name: 'Cooked dough' })).toHaveAttribute('aria-current', 'step');
    expect(within(dots).getByRole('button', { name: 'Ingredients' })).not.toHaveAttribute('aria-current');
  });

  it('shows «Indietro» from the second step on, and the primary becomes «Salva nella scheda» on the last', async () => {
    const { user } = await openLab();
    await start(user);
    expect(within(lab()).queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    await next(user);
    await user.click(within(lab()).getByRole('button', { name: 'Back' }));
    expect(within(lab()).getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument();
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Result' }));
    expect(within(lab()).queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
    expect(within(lab()).getByRole('button', { name: 'Save to the card' })).toBeInTheDocument();
  });

  it('adds an ingredient through the card\'s chooser, shows «new» as planned, and saves it as a line', async () => {
    const { user, fake } = await openLab();
    const press = pad(user);
    await start(user);
    await user.click(within(lab()).getByRole('button', { name: 'Add an ingredient' }));
    const chooser = await screen.findByRole('dialog', { name: 'Choose an ingredient' }, LOAD);
    await user.click(within(chooser).getByRole('button', { name: /^Salt/ }));
    // The same ingredient twice is allowed: this one is a new line.
    expect(within(lab()).getByText('new')).toBeInTheDocument();
    await press('35');
    await user.click(within(lab()).getAllByRole('button', { name: 'Done: Salt' })[1] as HTMLElement);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Result' }));
    await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Made of: today’s weights, 1 line changes')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Saved to the card' }, LOAD);
    const write = fake.saved.find(item => item.kind === 'product');
    expect((write?.data as { components: unknown[] }).components).toHaveLength(3);
    expect((write?.data as { components: unknown[] }).components[2]).toEqual({ kind: 'ingredient', ingredientId: 'salt', qty: 35, unit: 'g' });
  });

  it('says «resta uguale» when nothing changes, and does not touch the card when Cancel is pressed', async () => {
    const { user, fake } = await openLab();
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Result' }));
    await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Made of: stays the same')).toBeInTheDocument();
    expect(within(asked).getByText('Baking: raw 1,020 g, cooked not weighed')).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Cancel' }));
    expect(fake.saved.filter(item => item.kind === 'product')).toHaveLength(0);
    expect(within(lab()).getByRole('heading', { name: 'Result' })).toBeInTheDocument();
  });

  it('warns that the cooked dough weighs more than the raw, and still saves after the question', async () => {
    const { user, fake } = await openLab();
    const press = pad(user);
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Cooked dough' }));
    await press('1500');
    expect(within(lab()).getByText('Weighs more than the raw dough')).toBeInTheDocument();
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Result' }));
    expect(within(lab()).getByText('the cooked dough weighs more than the raw')).toBeInTheDocument();
    await user.click(within(lab()).getByRole('button', { name: 'Save to the card' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText(/Save anyway/)).toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Save' }));
    await screen.findByRole('heading', { name: 'Saved to the card' }, LOAD);
    expect(fake.saved.find(item => item.kind === 'product')?.data).toMatchObject({ cookedGrams: 1500 });
  });
});

describe('the keypad and the keyboard', () => {
  it('draws 7 8 9 / 4 5 6 / 1 2 3 / , 0 and a delete key named «Cancella una cifra»', async () => {
    const { user } = await openLab();
    await start(user);
    const keys = within(within(lab()).getByRole('group', { name: 'Keypad' })).getAllByRole('button');
    expect(keys.map(key => key.textContent || key.getAttribute('aria-label'))).toEqual(
      ['7', '8', '9', '4', '5', '6', '1', '2', '3', ',', '0', 'Delete one digit'],
    );
  });

  it('takes six digits at most and one comma', async () => {
    const { user } = await openLab();
    const press = pad(user);
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Cooked dough' }));
    await press('1234,5,678');
    expect(within(lab()).getByRole('button', { name: /^Cooked dough:/ })).toHaveTextContent('1234,56');
    await press('<<<<<<<<');
    expect(within(lab()).getByRole('button', { name: /^Cooked dough:/ })).toHaveTextContent('—');
  });

  it('types from a physical keyboard: digits, a comma or a point, Backspace', async () => {
    const { user } = await openLab();
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Cooked dough' }));
    await user.keyboard('9.5');
    expect(within(lab()).getByRole('button', { name: /^Cooked dough:/ })).toHaveTextContent('9,5');
    await user.keyboard('{Backspace}8');
    expect(within(lab()).getByRole('button', { name: /^Cooked dough:/ })).toHaveTextContent('9,8');
  });

  it('never opens the tablet\'s keyboard: the boxes are buttons, there is no input or textarea in the lab', async () => {
    const { user } = await openLab();
    await start(user);
    expect(lab().querySelector('input, textarea, select')).toBeNull();
  });

  it('puts the selected box in the accent border, and a tap on another moves it', async () => {
    const { user } = await openLab();
    await start(user);
    const flour = within(lab()).getByRole('button', { name: /^Weighed Flour:/ });
    const salt = within(lab()).getByRole('button', { name: /^Weighed Salt:/ });
    expect(flour).toHaveAttribute('aria-current', 'true');
    await user.click(salt);
    expect(salt).toHaveAttribute('aria-current', 'true');
    expect(flour).not.toHaveAttribute('aria-current');
  });

  it('keeps the comma out of «Pezzi» and the minutes', async () => {
    const { user } = await openLab();
    const press = pad(user);
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Pieces made' }));
    await press('1,2');
    expect(within(lab()).getByRole('button', { name: /^Pieces made:/ })).toHaveTextContent('12');
  });

  it('puts the time back on the timer: «Dal cronometro» appears once a number is typed', async () => {
    const { user } = await openLab();
    const press = pad(user);
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Time and people' }));
    expect(within(lab()).queryByRole('button', { name: 'From the timer' })).not.toBeInTheDocument();
    await press('50');
    expect(within(lab()).getByRole('button', { name: /^Time:/ })).toHaveTextContent('50');
    await user.click(within(lab()).getByRole('button', { name: 'From the timer' }));
    expect(within(lab()).getByRole('button', { name: /^Time:/ })).toHaveTextContent('1');
  });

  it('steps the people between 1 and 20', async () => {
    const { user } = await openLab();
    await start(user);
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Production steps' })).getByRole('button', { name: 'Time and people' }));
    const less = within(lab()).getByRole('button', { name: 'One person less' });
    const more = within(lab()).getByRole('button', { name: 'One person more' });
    await user.click(less);
    expect(within(lab()).getByRole('status', { name: 'People' })).toHaveTextContent('1');
    for (let i = 0; i < 25; i += 1) await user.click(more);
    expect(within(lab()).getByRole('status', { name: 'People' })).toHaveTextContent('20');
  });
});

describe('leaving and coming back', () => {
  it('«Esci» keeps everything and says so; the card then shows the banner with the clock and «Riprendi», which reopens at the same step', async () => {
    const { user } = await openLab();
    const press = pad(user);
    await start(user);
    await press('7');
    await user.click(within(lab()).getByRole('button', { name: 'Exit' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Produce in the lab' })).not.toBeInTheDocument(); });
    expect(await screen.findByText('The production stays open: resume it from the card.')).toBeInTheDocument();
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    expect(screen.getByText(/^In the lab · 0:00:0\d$/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
    expect(within(lab()).getByRole('heading', { name: 'Ingredients' })).toBeInTheDocument();
    expect(within(lab()).getByRole('button', { name: /^Weighed Flour:/ })).toHaveTextContent('7');
  });

  it('«Esci» before «Inizia» stores nothing and says nothing', async () => {
    const { user } = await openLab();
    await user.click(within(lab()).getByRole('button', { name: 'Exit' }));
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'Produce in the lab' })).not.toBeInTheDocument(); });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    expect(screen.queryByText('The production stays open: resume it from the card.')).not.toBeInTheDocument();
  });

  it('Escape does not close the lab: only «Esci» does', async () => {
    const { user } = await openLab();
    await start(user);
    await user.keyboard('{Escape}');
    expect(lab()).toBeInTheDocument();
  });

  it('shows a clock that is right after a reload: it comes from the stored start, an hour ago', async () => {
    const draft = startDraft(newDraft({
      id: 'Green', name: 'Green', components: [], packaging: [], sellingMode: 'piece', piecesPerBatch: 10, packSize: null, packUnit: null,
      sellingPrice: null, vatRate: null, foodCostTarget: null, labourMinutes: null, labourPeople: null, noWeightLoss: false,
      rawGrams: null, cookedGrams: null, model: 3,
    }), Date.now() - (3_600_000 + 12 * 60_000 + 34_000));
    window.localStorage.setItem(KEY, serializeDraft({ ...draft, step: 'oven' }));
    const { user } = await openCard();
    expect(screen.getByText(/^In the lab · 1:12:3\d$/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
    expect(within(lab()).getByRole('heading', { name: 'In the oven' })).toBeInTheDocument();
    expect(within(lab()).getByRole('timer', { name: 'Timer' })).toHaveTextContent(/^1:12:3\d$/);
  });

  it('ignores a corrupt draft: no banner, the door opens a fresh production', async () => {
    window.localStorage.setItem(KEY, '{"v":1,"startedAt":"yesterday"');
    const { user } = await openCard();
    expect(screen.queryByText(/^In the lab/)).not.toBeInTheDocument();
    await user.click(enter());
    await screen.findByRole('dialog', { name: 'Produce in the lab' }, LOAD);
    expect(within(lab()).getByRole('button', { name: 'Start' })).toBeInTheDocument();
  });

  it('keeps the clock honest when the screen sleeps: it repaints from the start instant on waking', async () => {
    const { user } = await openLab();
    await start(user);
    const before = within(lab()).getByRole('timer', { name: 'Timer' }).textContent;
    expect(before).toMatch(/^0:00:0\d$/);
    // The tablet slept for 20 minutes: nothing ticked, then the page woke up.
    const wake = Date.now() + 20 * 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(wake);
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await Promise.resolve(); });
    expect(within(lab()).getByRole('timer', { name: 'Timer' })).toHaveTextContent(/^0:20:0\d$/);
    vi.restoreAllMocks();
  });
});

describe('Italian', () => {
  it('says everything in Italian, with the venue\'s thousands separator', async () => {
    const { user, fake } = await openLab(ITALY);
    const dialog = lab();
    expect(within(dialog).getByText('Produci in laboratorio', { selector: 'p' })).toBeInTheDocument();
    expect(within(dialog).getByText('2 righe · 1.020 g di impasto crudo · 10 pezzi')).toBeInTheDocument();
    expect(within(dialog).getByText('Parte il cronometro.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Inizia' }));
    expect(within(lab()).getByRole('button', { name: 'Fatto: Flour' })).toBeInTheDocument();
    expect(within(lab()).getByText('0 di 2')).toBeInTheDocument();
    await user.click(within(lab()).getByRole('button', { name: 'Avanti' }));
    expect(within(lab()).getByText('È il totale degli ingredienti')).toBeInTheDocument();
    await user.click(within(within(lab()).getByRole('navigation', { name: 'Passi della produzione' })).getByRole('button', { name: 'Risultato' }));
    await user.click(within(lab()).getByRole('button', { name: 'Salva nella scheda' }));
    const asked = await screen.findByRole('alertdialog', undefined, LOAD);
    expect(within(asked).getByText('Salvare nella scheda di Green?')).toBeInTheDocument();
    expect(within(asked).getByText('Composto da: resta uguale')).toBeInTheDocument();
    expect(within(asked).getByText('Cottura: crudo 1.020 g, cotto non pesato')).toBeInTheDocument();
    // Nothing changes, so no margin point will be recorded: the note is not there.
    expect(within(asked).queryByText('Lo Storico dei margini ne tiene traccia.')).not.toBeInTheDocument();
    await user.click(within(asked).getByRole('button', { name: 'Annulla' }));
    expect(fake.saved.filter(item => item.kind === 'product')).toHaveLength(0);
  });
});
