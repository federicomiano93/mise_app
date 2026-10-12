import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { logTimestamp } from '@mise/shared/log-time';
import { fakeCalculatorSource } from '../testing/fakeCalculatorSource';
import {
  BRIOCHE, FOCACCIA, LOAD, configOf, onlyFocaccia, renderCalculator,
} from '../testing/renderCalculator';
import { ACTION_EVENT } from '../telemetry/usage';

// Confirm, Edit and Reset, and where the recipe is while all that happens: shown only once the dough was
// confirmed, then first in the panel, the boxes locked (the divisor not), the log written local-first, the
// current app's keys left as it leaves them.

beforeAll(async () => { await import('./CalculatorSection'); }, 60_000);

const NOW = new Date(2026, 9, 12, 14, 5).getTime();

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const main = () => within(screen.getByRole('main'));
const stored = (key: string) => window.localStorage.getItem(key);
const button = (name: string) => main().queryByRole('button', { name });
const dialogNamed = async (name: string) => within(await screen.findByRole('dialog', { name }, LOAD));
const alertNamed = async (name: RegExp | string) => within(await screen.findByRole('alertdialog', { name }, LOAD));

async function open(config: Record<string, unknown> = onlyFocaccia(), lang: 'en' | 'it' = 'en', source = fakeCalculatorSource({ config })) {
  const view = renderCalculator('/calculator/focaccia', { source, lang });
  await screen.findByRole('heading', { level: 1 }, LOAD);
  await waitFor(() => { expect(screen.queryByText('Loading…')).not.toBeInTheDocument(); }, LOAD);
  return { ...view, source };
}

const roma = () => within(main().getByRole('region', { name: 'Cafe Roma' }));

// Four trays of 500 g for Cafe Roma: a 2,000 g dough.
async function fourTrays(user: Awaited<ReturnType<typeof open>>['user']) {
  await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
  await user.click(roma().getByLabelText('Focaccia tray (500g)'));
  await user.keyboard('4');
}

async function confirmFor(user: Awaited<ReturnType<typeof open>>['user'], day: 'Today' | 'Tomorrow') {
  await user.click(main().getByRole('button', { name: 'Confirm' }));
  const picker = await dialogNamed('Save this dough for:');
  await user.click(picker.getByRole('button', { name: day }));
}

describe('before the dough is confirmed', () => {
  it('shows no recipe, however much there is to make', async () => {
    const { user } = await open();
    await fourTrays(user);
    expect(main().queryByRole('region', { name: 'Focaccia dough' })).not.toBeInTheDocument();
  });

  it('offers Confirm only when there is something to make, and never Edit', async () => {
    const { user } = await open();
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    expect(button('Confirm')).not.toBeInTheDocument();
    expect(button('Edit')).not.toBeInTheDocument();
    await fourTrays(user);
    expect(button('Confirm')).toBeInTheDocument();
    expect(button('Edit')).not.toBeInTheDocument();
  });

  it('always offers «Reset all fields»', async () => {
    await open();
    expect(await main().findByRole('button', { name: 'Reset all fields' }, LOAD)).toBeInTheDocument();
  });
});

describe('Confirm', () => {
  it('asks which day in a dialog, and Cancel saves nothing', async () => {
    const { user, source } = await open();
    await fourTrays(user);
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    const picker = await dialogNamed('Save this dough for:');
    expect(picker.getAllByRole('button').map(b => b.textContent)).toEqual(['Cancel', 'Today', 'Tomorrow']);
    await user.click(picker.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(source.saved).toEqual([]);
    expect(stored('lock-focaccia')).toBeNull();
    expect(button('Confirm')).toBeInTheDocument();
  });

  it('writes the log for today: one line per client x product (zeros too), the sheet, the text, the time', async () => {
    const { user, source } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await waitFor(() => { expect(source.saved).toHaveLength(1); });

    const log = source.saved[0] as Record<string, any>;
    expect(log).toMatchObject({ dough: 'Focaccia', recipeId: 'focaccia', forDay: 'today', origin: 'calculator', createdAtMs: NOW });
    expect(String(log.id)).toMatch(/^log-/);
    expect(log.versions).toHaveLength(1);
    const version = log.versions[0];
    expect(version.kind).toBe('create');
    expect(version.calculatedBy).toBe('');
    expect(version.at).toEqual(logTimestamp(new Date(NOW)));
    expect(version.at.time).toBe('2:05 PM');
    // Every active product, the paused one not, zeros included (the brioche roll is re-homed onto the only recipe
    // left, as a product whose recipe is gone always is).
    expect(version.items.map((i: any) => [i.clientName, i.name, i.qty, i.weightG, i.kind])).toEqual([
      ['Cafe Roma', 'Focaccia tray', 4, 500, 'number'],
      ['Cafe Roma', 'Focaccia slab', 0, 800, 'dropdown'],
      ['Cafe Roma', 'Brioche roll', 0, 60, 'number'],
      ['Bar Sole', 'Focaccia tray', 0, 500, 'number'],
      ['Bar Sole', 'Cheese by the kilo', 0, 1000, 'kg'],
    ]);
    expect(version.items[0].crate).toEqual({ show: true, perBox: 10 });
    expect(version.text).toBe('Cafe Roma:\n  Focaccia tray: 4 pz');
    expect(version.sheet).toMatchObject({
      dough: 'Focaccia', recipeId: 'focaccia', total_g: 2000, extra_g: 0, param: { label: 'Yeast %', value: 0.5 },
    });
    expect(version.sheet.ingredients.reduce((s: number, i: any) => s + i.grams, 0)).toBe(2000);
    expect(version.sheet.crates).toEqual([{ name: 'Focaccia tray', count: 0.4, eachBoxG: 5000 }]);
    expect(version.recipe).toMatchObject({ id: 'focaccia', name: 'Focaccia', logic: 'orders', leaveningKey: 'yeast' });
  });

  it('writes the log for tomorrow', async () => {
    const { user, source } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Tomorrow');
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect(source.saved[0]).toMatchObject({ forDay: 'tomorrow' });
  });

  it('saves the extra dough, the knob and the divisor with the dough', async () => {
    const config = onlyFocaccia({ divisorIncluded: { focaccia: ['tray'] } });
    const { user, source } = await open(config);
    await fourTrays(user);
    await user.click(main().getByLabelText('Extra dough'));
    await user.keyboard('0.5');
    const knob = main().getByLabelText('Yeast %');
    await user.clear(knob);
    await user.type(knob, '1');
    await confirmFor(user, 'Today');
    await user.selectOptions(await screen.findByLabelText('Number of crates', undefined, LOAD), '2');
    // Edit and confirm again: the divisor box is not locked, and the new version carries its number.
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Edit' }));
    await confirmFor(user, 'Today');
    await waitFor(() => { expect(source.saved).toHaveLength(2); });
    const version = (source.saved[1] as any).versions[1];
    expect(version.kind).toBe('edit');
    expect(version.sheet).toMatchObject({ extra_g: 500, total_g: 2500, param: { value: 1 } });
    expect(version.sheet.divisor).toMatchObject({ names: ['Focaccia tray'], total: 2000, n: 2, result: 1000 });
    expect(version.text).toBe('Cafe Roma:\n  Focaccia tray: 4 pz\nExtra dough: 0.5 kg');
  });

  it('says it was confirmed to the usage record', async () => {
    const heard: string[] = [];
    const listener = (event: Event) => { heard.push(String((event as CustomEvent).detail)); };
    window.addEventListener(ACTION_EVENT, listener);
    try {
      const { user, source } = await open();
      await fourTrays(user);
      await confirmFor(user, 'Today');
      await waitFor(() => { expect(source.saved).toHaveLength(1); });
      expect(heard).toEqual(['dough-confirmed']);
    } finally {
      window.removeEventListener(ACTION_EVENT, listener);
    }
  });

  it('saves for today at once, with no question, when the venue switched the question off', async () => {
    const { user, source } = await open(onlyFocaccia({ askDoughDay: false }));
    await fourTrays(user);
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect(source.saved[0]).toMatchObject({ forDay: 'today' });
  });

  it('keeps the tab in the current app\'s keys: revealed, the lock with the log\'s id, and the stamp', async () => {
    const { user, source } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect(stored('revealed-focaccia')).toBe('1');
    expect(JSON.parse(stored('lock-focaccia') ?? 'null')).toEqual({ locked: true, logId: (source.saved[0] as any).id });
    expect(stored('touched-focaccia')).toBe(String(NOW));
  });

  it('shows the recipe, FIRST in the panel, and swaps Confirm for Edit', async () => {
    const { user } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Today');
    const card = await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    expect(within(card).getByText('2,000 g raw')).toBeInTheDocument();
    // In the document before the entries: the reading order is the visual order.
    const orders = main().getByRole('heading', { level: 2, name: 'Orders' });
    expect(card.compareDocumentPosition(orders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(button('Edit')).toBeInTheDocument();
    expect(button('Confirm')).not.toBeInTheDocument();
  });

  it('locks every box and select of the tab but the divisor', async () => {
    const { user } = await open(onlyFocaccia({ divisorIncluded: { focaccia: ['tray'] } }));
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    const entries = main().getByRole('heading', { level: 2, name: 'Orders' }).parentElement!;
    const fields = [...entries.querySelectorAll('input, select')] as HTMLInputElement[];
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields) expect(field, field.id || field.getAttribute('aria-label') || '').toBeDisabled();
    expect(main().getByLabelText('Number of crates')).toBeEnabled();
  });

  it('scrolls to the top when the recipe first appears', async () => {
    const { user } = await open();
    await fourTrays(user);
    const area = screen.getByRole('main');
    area.scrollTop = 420;
    await confirmFor(user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    expect(area.scrollTop).toBe(0);
  });

  it('is in Italian: the button, the question, the days', async () => {
    const { user } = await open(onlyFocaccia(), 'it');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(roma().getByLabelText('Focaccia tray (500g)'));
    await user.keyboard('4');
    await user.click(main().getByRole('button', { name: 'Conferma' }));
    const picker = await dialogNamed('Salva questo impasto per:');
    expect(picker.getAllByRole('button').map(b => b.textContent)).toEqual(['Annulla', 'Oggi', 'Domani']);
  });

  it('writes the time in English whatever the language: both apps read the same log', async () => {
    const { user, source } = await open(onlyFocaccia(), 'it');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(roma().getByLabelText('Focaccia tray (500g)'));
    await user.keyboard('4');
    await user.click(main().getByRole('button', { name: 'Conferma' }));
    await user.click((await dialogNamed('Salva questo impasto per:')).getByRole('button', { name: 'Oggi' }));
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect((source.saved[0] as any).versions[0].at).toEqual({ date: 'Monday 12 October', time: '2:05 PM' });
    expect((source.saved[0] as any).versions[0].text).toBe('Cafe Roma:\n  Focaccia tray: 4 pz');
  });
});

// The button that was pressed unmounts when the tab changes state, so the focus is sent on, not left to fall to the
// page.
describe('where the focus goes', () => {
  const recipeHeading = () => main().getByRole('heading', { level: 2, name: 'Focaccia dough' });

  it('to the recipe\'s heading after a Confirm through the day dialog', async () => {
    const { user } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    await waitFor(() => { expect(recipeHeading()).toHaveFocus(); });
    expect(recipeHeading()).toHaveAttribute('tabindex', '-1');
  });

  it('to the recipe\'s heading after a Confirm with no question asked', async () => {
    const { user } = await open(onlyFocaccia({ askDoughDay: false }));
    await fourTrays(user);
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    await waitFor(() => { expect(recipeHeading()).toHaveFocus(); });
  });

  it('stays where it is when the day dialog is cancelled: back on Confirm', async () => {
    const { user } = await open();
    await fourTrays(user);
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    await user.click((await dialogNamed('Save this dough for:')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(main().getByRole('button', { name: 'Confirm' })).toHaveFocus(); });
  });

  it('to the Confirm button after Edit', async () => {
    const { user } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click((await alertNamed('Edit')).getByRole('button', { name: 'Edit' }));
    await waitFor(() => { expect(main().getByRole('button', { name: 'Confirm' })).toHaveFocus(); });
  });

  it('nowhere when Edit is cancelled: the tab is unchanged', async () => {
    const { user } = await open();
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click((await alertNamed('Edit')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(main().getByRole('button', { name: 'Edit' })).toHaveFocus(); });
  });
});

describe('the words of the saved text', () => {
  // The current app's js/log-model.js builds «Extra dough: » with t(), so an Italian venue stores «Impasto extra: ».
  it('follow the interface language at the moment of saving', async () => {
    const { user, source } = await open(onlyFocaccia(), 'it');
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(main().getByLabelText('Impasto extra'));
    await user.keyboard('2');
    await user.click(main().getByRole('button', { name: 'Conferma' }));
    await user.click((await dialogNamed('Salva questo impasto per:')).getByRole('button', { name: 'Oggi' }));
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect((source.saved[0] as any).versions[0].text).toBe('Impasto extra: 2 kg');
  });

  it('are English in an English venue', async () => {
    const { user, source } = await open();
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(main().getByLabelText('Extra dough'));
    await user.keyboard('2');
    await confirmFor(user, 'Today');
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect((source.saved[0] as any).versions[0].text).toBe('Extra dough: 2 kg');
  });
});

describe('a tab the current app left confirmed', () => {
  function leftConfirmed() {
    window.localStorage.setItem('qty-roma::tray', '4');
    window.localStorage.setItem('revealed-focaccia', '1');
    window.localStorage.setItem('lock-focaccia', JSON.stringify({ locked: true, logId: 'log-old' }));
  }

  it('is shown as it was: the recipe first, Edit, the boxes locked', async () => {
    leftConfirmed();
    await open();
    const card = await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    expect(within(card).getByText('2,000 g raw')).toBeInTheDocument();
    expect(button('Edit')).toBeInTheDocument();
    expect(roma().getByLabelText('Focaccia tray (500g)')).toBeDisabled();
  });

  it('shows the recipe from `revealed` alone, and an unlocked tab keeps its boxes open', async () => {
    window.localStorage.setItem('qty-roma::tray', '4');
    window.localStorage.setItem('revealed-focaccia', '1');
    await open();
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    expect(roma().getByLabelText('Focaccia tray (500g)')).toBeEnabled();
    expect(button('Confirm')).toBeInTheDocument();
  });

  it('reads a damaged lock as no lock', async () => {
    window.localStorage.setItem('qty-roma::tray', '4');
    window.localStorage.setItem('lock-focaccia', '{not json');
    await open();
    expect(await main().findByRole('button', { name: 'Confirm' }, LOAD)).toBeInTheDocument();
  });

  it('updates the SAME log when it is edited and confirmed again, and may move it to the other day', async () => {
    leftConfirmed();
    const log = {
      id: 'log-old', bakery: 'bakery', dough: 'Focaccia', recipeId: 'focaccia', forDay: 'today', origin: 'calculator',
      createdAtMs: NOW - 3600_000, versions: [{ kind: 'create', items: [], occasional: [], text: '' }],
    };
    const source = fakeCalculatorSource({ config: onlyFocaccia(), logs: [log] });
    const { user } = await open(onlyFocaccia(), 'en', source);
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Edit' }));
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    await user.click((await dialogNamed('Save this dough for:')).getByRole('button', { name: 'Tomorrow' }));
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    const saved = source.saved[0] as any;
    expect(saved.id).toBe('log-old');
    expect(saved.forDay).toBe('tomorrow');
    expect(saved.versions.map((v: any) => v.kind)).toEqual(['create', 'edit']);
    expect(JSON.parse(stored('lock-focaccia') ?? 'null')).toEqual({ locked: true, logId: 'log-old' });
  });

  it('makes a new log when the linked one no longer exists', async () => {
    leftConfirmed();
    const { user, source } = await open();
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Edit' }));
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    await user.click((await dialogNamed('Save this dough for:')).getByRole('button', { name: 'Today' }));
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    expect((source.saved[0] as any).id).not.toBe('log-old');
    expect((source.saved[0] as any).versions[0].kind).toBe('create');
  });
});

describe('Edit', () => {
  async function confirmed() {
    const view = await open();
    await fourTrays(view.user);
    await confirmFor(view.user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    return view;
  }

  it('asks first, and No leaves the tab confirmed', async () => {
    const { user } = await confirmed();
    await user.click(main().getByRole('button', { name: 'Edit' }));
    const ask = await alertNamed('Edit');
    expect(ask.getByText('Edit these quantities? The recipe updates only after you save it again.')).toBeInTheDocument();
    await user.click(ask.getByRole('button', { name: 'Cancel' }));
    expect(main().getByRole('region', { name: 'Focaccia dough' })).toBeInTheDocument();
    expect(roma().getByLabelText('Focaccia tray (500g)')).toBeDisabled();
    expect(stored('revealed-focaccia')).toBe('1');
  });

  it('unlocks keeping the link to the log, hides the recipe and drops `revealed`', async () => {
    const { user, source } = await confirmed();
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click((await alertNamed('Edit')).getByRole('button', { name: 'Edit' }));
    await waitFor(() => { expect(main().queryByRole('region', { name: 'Focaccia dough' })).not.toBeInTheDocument(); });
    expect(roma().getByLabelText('Focaccia tray (500g)')).toBeEnabled();
    expect(button('Confirm')).toBeInTheDocument();
    expect(stored('revealed-focaccia')).toBeNull();
    expect(JSON.parse(stored('lock-focaccia') ?? 'null')).toEqual({ locked: false, logId: (source.saved[0] as any).id });
  });

  it('puts the recipe back where it was, after the entries, once it is hidden', async () => {
    const { user } = await confirmed();
    await user.click(main().getByRole('button', { name: 'Edit' }));
    await user.click((await alertNamed('Edit')).getByRole('button', { name: 'Edit' }));
    await waitFor(() => { expect(button('Confirm')).toBeInTheDocument(); });
    await user.click(button('Confirm')!);
    await user.click((await dialogNamed('Save this dough for:')).getByRole('button', { name: 'Today' }));
    const card = await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    const orders = main().getByRole('heading', { level: 2, name: 'Orders' });
    expect(card.compareDocumentPosition(orders) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('Reset all fields', () => {
  async function confirmed() {
    const view = await open(onlyFocaccia({ divisorIncluded: { focaccia: ['tray'] } }));
    await fourTrays(view.user);
    await view.user.click(main().getByLabelText('Extra dough'));
    await view.user.keyboard('3');
    await view.user.selectOptions(main().getByLabelText('Extra dough unit'), 'g');
    const knob = main().getByLabelText('Yeast %');
    await view.user.clear(knob);
    await view.user.type(knob, '0.9');
    await confirmFor(view.user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    return view;
  }

  it('asks first, in danger, and Cancel changes nothing', async () => {
    const { user } = await confirmed();
    await user.click(main().getByRole('button', { name: 'Reset all fields' }));
    const ask = await alertNamed('Reset all fields?');
    await user.click(ask.getByRole('button', { name: 'Cancel' }));
    expect(stored('qty-roma::tray')).toBe('4');
    expect(stored('lock-focaccia')).not.toBeNull();
  });

  it('empties the boxes, the knob goes back to its default, the selects to 0 and kg', async () => {
    const { user } = await confirmed();
    await user.click(main().getByRole('button', { name: 'Reset all fields' }));
    await user.click((await alertNamed('Reset all fields?')).getByRole('button', { name: 'Reset' }));
    await waitFor(() => { expect(roma().getByLabelText('Focaccia tray (500g)')).toBeEnabled(); });
    expect(roma().getByLabelText('Focaccia tray (500g)')).toHaveValue(0);
    expect(main().getByLabelText('Yeast %')).toHaveValue(0.5);
    expect(main().getByLabelText('Extra dough')).toHaveValue(0);
    expect(main().getByLabelText('Extra dough unit')).toHaveValue('kg');
    expect(main().queryByRole('region', { name: 'Focaccia dough' })).not.toBeInTheDocument();
    expect(button('Confirm')).not.toBeInTheDocument();
  });

  it('forgets the lock with the numbers: the next Confirm makes a NEW log, never yesterday\'s', async () => {
    const { user, source } = await confirmed();
    await waitFor(() => { expect(source.saved).toHaveLength(1); });
    const first = (source.saved[0] as any).id;
    await user.click(main().getByRole('button', { name: 'Reset all fields' }));
    await user.click((await alertNamed('Reset all fields?')).getByRole('button', { name: 'Reset' }));
    for (const key of ['lock-focaccia', 'revealed-focaccia', 'qty-roma::tray', 'param-focaccia', 'extra-focaccia', 'extra-unit-focaccia', 'touched-focaccia']) {
      expect(stored(key), key).toBeNull();
    }
    await waitFor(() => { expect(roma().getByLabelText('Focaccia tray (500g)')).toBeEnabled(); });
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await waitFor(() => { expect(source.saved).toHaveLength(2); });
    expect((source.saved[1] as any).id).not.toBe(first);
    expect((source.saved[1] as any).versions).toHaveLength(1);
  });

  it('puts the divisor back to 0 crates', async () => {
    const { user } = await confirmed();
    await user.selectOptions(main().getByLabelText('Number of crates'), '3');
    await user.click(main().getByRole('button', { name: 'Reset all fields' }));
    await user.click((await alertNamed('Reset all fields?')).getByRole('button', { name: 'Reset' }));
    await waitFor(() => { expect(roma().getByLabelText('Focaccia tray (500g)')).toBeEnabled(); });
    await fourTrays(user);
    await confirmFor(user, 'Today');
    expect(await main().findByLabelText('Number of crates', undefined, LOAD)).toHaveValue('0');
  });

  it('asks in Italian', async () => {
    const { user } = await open(onlyFocaccia(), 'it');
    await user.click(await main().findByRole('button', { name: 'Azzera tutti i campi' }, LOAD));
    expect(await alertNamed('Vuoi azzerare tutti i campi?')).toBeDefined();
  });
});

describe('a dough that cannot be saved', () => {
  const LINKED = { ...BRIOCHE, id: 'linked', name: 'Linked', catalogueId: 'cat-1', ingredients: [] };

  it('is refused in a dialog with the same sentence the screen would give, and nothing is saved', async () => {
    window.localStorage.setItem('total-linked', '1000');
    const config = configOf({ recipes: [LINKED], clients: [] });
    window.localStorage.setItem('calculator-config', JSON.stringify(config));
    const source = fakeCalculatorSource({
      config, recipes: [{ id: 'cat-1', name: 'C', ingredients: [{ rid: 'r', label: 'Pinch', grams: 0, unit: 'pinch' }] }],
    });
    const view = renderCalculator('/calculator/linked', { source });
    await user_confirm(view.user);
    const refusal = await alertNamed(/“Pinch” has no weight/);
    expect(refusal).toBeDefined();
    await view.user.click(refusal.getByRole('button', { name: 'OK' }));
    expect(source.saved).toEqual([]);
    expect(stored('revealed-linked')).toBeNull();
    expect(stored('lock-linked')).toBeNull();
    expect(main().queryByRole('region', { name: 'Linked dough' })).not.toBeInTheDocument();
  });

  async function user_confirm(user: ReturnType<typeof renderCalculator>['user']) {
    await user.click(await main().findByRole('button', { name: 'Confirm' }, LOAD));
    await user.click((await dialogNamed('Save this dough for:')).getByRole('button', { name: 'Today' }));
  }

  it('is refused while the linked recipe is still loading', async () => {
    window.localStorage.setItem('total-linked', '1000');
    const config = configOf({ recipes: [LINKED], clients: [] });
    window.localStorage.setItem('calculator-config', JSON.stringify(config));
    const source = fakeCalculatorSource({ config, recipes: [] });
    source.hold();
    const view = renderCalculator('/calculator/linked', { source });
    await user_confirm(view.user);
    expect(await alertNamed(/still loading/)).toBeDefined();
    expect(source.saved).toEqual([]);
  });

  it('leaves the tab OPEN and says so when the log is full', async () => {
    window.localStorage.setItem('qty-roma::tray', '4');
    window.localStorage.setItem('lock-focaccia', JSON.stringify({ locked: false, logId: 'log-full' }));
    const log = {
      id: 'log-full', bakery: 'bakery', dough: 'Focaccia', recipeId: 'focaccia', forDay: 'today', origin: 'calculator',
      createdAtMs: NOW, versions: Array.from({ length: 100 }, () => ({ kind: 'edit', items: [], occasional: [], text: '' })),
    };
    const source = fakeCalculatorSource({ config: onlyFocaccia(), logs: [log] });
    const { user } = await open(onlyFocaccia(), 'en', source);
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(main().getByRole('button', { name: 'Confirm' }));
    await user.click((await dialogNamed('Save this dough for:')).getByRole('button', { name: 'Today' }));
    expect(await screen.findByText('Focaccia’s log is full. Reset the fields to start a new one.', undefined, LOAD)).toBeInTheDocument();
    expect(source.saved).toEqual([]);
    expect(button('Confirm')).toBeInTheDocument();
    expect(stored('revealed-focaccia')).toBeNull();
  });

  it('says the database refused it, in the person\'s language, while the tab stays confirmed here', async () => {
    const { user, source } = await open(onlyFocaccia(), 'it');
    source.refuse.save = true;
    await main().findByRole('region', { name: 'Cafe Roma' }, LOAD);
    await user.click(roma().getByLabelText('Focaccia tray (500g)'));
    await user.keyboard('4');
    await user.click(main().getByRole('button', { name: 'Conferma' }));
    await user.click((await dialogNamed('Salva questo impasto per:')).getByRole('button', { name: 'Oggi' }));
    expect(await screen.findByText(
      'Focaccia non è stato salvato nello storico impasti. Controlla la connessione e conferma di nuovo.', undefined, LOAD,
    )).toBeInTheDocument();
    // Local-first: the tab is confirmed on this phone whatever the server said.
    expect(stored('revealed-focaccia')).toBe('1');
  });

  it('keeps FOCACCIA out of it: a second recipe\'s tab is not touched by the first one\'s Confirm', async () => {
    const { user } = await open(configOf({ recipes: [FOCACCIA, BRIOCHE] }));
    await fourTrays(user);
    await confirmFor(user, 'Today');
    await main().findByRole('region', { name: 'Focaccia dough' }, LOAD);
    expect(stored('lock-brioche')).toBeNull();
    expect(stored('revealed-brioche')).toBeNull();
  });
});
