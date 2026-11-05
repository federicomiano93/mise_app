import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { isBusy } from '../session/busy';
import { fakeRecipesSource } from '../testing/fakeRecipesSource';
import { LOAD, recipe, renderRecipes, split } from '../testing/renderRecipes';
import { SIZE_SETTLE_MS } from './LabelSettings';

// The label Settings (step 3d-5): the paper, the printer and what else goes on a printed label, for whoever runs the place.
// Every control saves on the tap; the screen is drawn from the store, which changes at once and puts a refused change back.

beforeAll(async () => { await import('./RecipesSection'); }, 60_000);

beforeEach(() => { window.localStorage.clear(); });

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const GB = { country: 'GB' };
const FIRST = { timeout: 3000 };

type Options = {
  labelConfig?: Record<string, unknown> | null;
  session?: Record<string, unknown>;
  lang?: 'en' | 'it';
  source?: ReturnType<typeof fakeRecipesSource>;
  path?: string;
};

async function openSettings({ labelConfig = null, session = {}, lang = 'en', source, path = '/recipes/settings' }: Options = {}) {
  const src = source ?? fakeRecipesSource({ recipes: [recipe('r1')], labelConfig });
  const view = renderRecipes(path, { source: src, lang, session: { location: GB, language: lang, ...session } });
  await screen.findByRole('region', { name: lang === 'it' ? 'Impostazioni' : 'Settings' }, LOAD);
  return { ...view, source: src };
}

const settings = () => within(screen.getByRole('region', { name: 'Settings' }));
const group = (name: string) => settings().getByRole('radiogroup', { name });
const choice = (groupName: string, text: string) => within(group(groupName)).getByRole('radio', { name: text });
const toggle = (name: string) => settings().getByRole('switch', { name });
const box = (name: string) => settings().getByRole('textbox', { name });

describe('the door and the address', () => {
  it.each([
    ['owner', { role: 'owner' as const, canManage: true, isOwner: true }],
    ['manager', { role: 'manager' as const, canManage: true, isOwner: false }],
  ])('is a button at the foot of the list for the %s, and opens Settings one level down', async (_who, session) => {
    const { router, user } = renderRecipes('/recipes', { source: fakeRecipesSource({ recipes: [recipe('r1')] }), session: { location: GB, ...session } });
    await user.click(await screen.findByRole('button', { name: 'Settings' }, LOAD));
    expect(router.state.location.pathname).toBe('/recipes/settings');
    expect(await screen.findByRole('heading', { level: 2, name: 'Settings' })).toBeInTheDocument();
  });

  it('⚠️ is not there for an employee', async () => {
    const employee = { role: 'staff' as const, canManage: false, isOwner: false };
    renderRecipes('/recipes', { source: fakeRecipesSource({ recipes: [recipe('r1')] }), session: { location: GB, ...employee } });
    await screen.findByRole('button', { name: 'r1' }, LOAD);
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('⚠️ sends an employee to the list when she types the address', async () => {
    const employee = { role: 'staff' as const, canManage: false, isOwner: false };

    const { router } = renderRecipes('/recipes/settings', { source: fakeRecipesSource({ recipes: [recipe('r1')] }), session: { location: GB, ...employee } });
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(router.state.historyAction).toBe('REPLACE');
    expect(await screen.findByRole('button', { name: 'r1' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('steps back up to the list with Back and hands the focus to the door', async () => {
    const { router, user } = renderRecipes('/recipes', { source: fakeRecipesSource({ recipes: [recipe('r1')] }), session: { location: GB } });
    await user.click(await screen.findByRole('button', { name: 'Settings' }, LOAD));
    await screen.findByRole('region', { name: 'Settings' });
    await user.click(settings().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Settings' })).toHaveFocus(); });
  });

  it('is drawn in the right-hand pane on the split, the list staying beside it', async () => {
    split();
    await openSettings();
    expect(screen.getByRole('button', { name: 'r1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'true');
  });

  it('replaces itself with the list when it was opened by its address, with nothing behind it', async () => {
    const { router, user } = await openSettings();
    await user.click(settings().getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(router.state.location.pathname).toBe('/recipes'); });
    expect(router.state.historyAction).toBe('REPLACE');
  });

  it('waits for the paper: «Loading…» and no controls until the profile is known', async () => {
    const source = fakeRecipesSource({ recipes: [recipe('r1')] });
    source.holdLabelConfig();
    renderRecipes('/recipes/settings', { source, session: { location: GB } });
    const region = await screen.findByRole('region', { name: 'Settings' }, LOAD);
    expect(within(region).getByText('Loading…')).toBeInTheDocument();
    expect(within(region).queryByRole('switch')).not.toBeInTheDocument();
    act(() => { source.releaseLabelConfig(); });
    expect(await within(region).findByRole('switch', { name: 'Net weight' })).toBeInTheDocument();
    expect(within(region).queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('says its words in the interface language, from the current app’s own keys', async () => {
    await openSettings({ lang: 'it' });
    const region = within(screen.getByRole('region', { name: 'Impostazioni' }));
    expect(region.getByRole('heading', { level: 3, name: 'Stampa etichette' })).toBeInTheDocument();
    expect(region.getByRole('radiogroup', { name: 'Misura dell’etichetta' })).toBeInTheDocument();
    expect(region.getByRole('switch', { name: 'Peso netto' })).toBeInTheDocument();
  });
});

describe('Label printing', () => {
  it('shows the presets as numbers, never translated, plus a custom size, and marks the one in use', async () => {
    await openSettings({ labelConfig: { widthMm: 57, heightMm: 32 } });
    const size = within(group('Label size'));
    expect(size.getAllByRole('radio').map(radio => radio.textContent)).toEqual(['76 × 51', '57 × 32', '102 × 76', 'Custom size']);
    expect(choice('Label size', '57 × 32')).toBeChecked();
    expect(choice('Label size', '76 × 51')).not.toBeChecked();
    expect(settings().queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('sends a preset as one write of both sides', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', '57 × 32'));
    expect(source.labelSaves).toEqual([{ widthMm: 57, heightMm: 32 }]);
    expect(choice('Label size', '57 × 32')).toBeChecked();
  });

  it('⚠️ a size that matches no preset IS custom: the two boxes open by themselves, with the saved millimetres', async () => {
    await openSettings({ labelConfig: { widthMm: 80, heightMm: 40.5 } });
    expect(choice('Label size', 'Custom size')).toBeChecked();
    expect(settings().getByRole('spinbutton', { name: /Width/ })).toHaveValue(80);
    expect(settings().getByRole('spinbutton', { name: /Height/ })).toHaveValue(40.5);
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    expect(width).toHaveAttribute('min', '20');
    expect(width).toHaveAttribute('max', '300');
    expect(width).toHaveAttribute('step', '0.5');
    expect(width).toHaveAttribute('inputmode', 'decimal');
  });

  it('opens the two boxes on «Custom size» without writing anything', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    expect(settings().getByRole('spinbutton', { name: /Width/ })).toHaveValue(76);
    expect(source.labelSaves).toEqual([]);
  });

  it('⚠️ a custom size is ONE write after the boxes are left — none per keystroke — and the two boxes make one', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    const height = settings().getByRole('spinbutton', { name: /Height/ });
    await user.clear(width);
    await user.type(width, '102');
    expect(source.labelSaves).toEqual([]);
    await user.clear(height);
    await user.type(height, '60');
    expect(source.labelSaves).toEqual([]);
    await user.tab();
    await waitFor(() => { expect(source.labelSaves).toEqual([{ widthMm: 102, heightMm: 60 }]); }, FIRST);
    // Long enough to be sure no second write follows.
    await new Promise(resolve => setTimeout(resolve, SIZE_SETTLE_MS + 100));
    expect(source.labelSaves).toHaveLength(1);
  });

  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  it.each(['10', '301', ''])('⚠️ never sends %j mm: nothing is written, the saved size is back and the sentence says why', async typed => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    if (typed !== '') await user.type(width, typed);
    await user.tab();
    await user.tab();
    await wait(SIZE_SETTLE_MS + 100);
    expect(source.labelSaves).toEqual([]);
    expect(settings().getByRole('spinbutton', { name: /Width/ })).toHaveValue(76);
    expect(settings().getByText('Width and height must be between 20 and 300 mm — the saved size is back.')).toBeInTheDocument();
    // The boxes stay open while the sentence is up, even though 76 × 51 is a preset.
    expect(settings().getByRole('spinbutton', { name: /Height/ })).toHaveValue(51);
  });

  it('accepts the bounds, 20 and 300, and clears the sentence on the next valid size', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    let width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '5');
    await user.tab();
    await user.tab();
    expect(settings().getByText(/must be between 20 and 300 mm/)).toBeInTheDocument();

    width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '20');
    await user.tab();
    const height = settings().getByRole('spinbutton', { name: /Height/ });
    await user.clear(height);
    await user.type(height, '300');
    await user.tab();
    await waitFor(() => { expect(source.labelSaves).toEqual([{ widthMm: 20, heightMm: 300 }]); }, FIRST);
    expect(settings().queryByText(/must be between 20 and 300 mm/)).not.toBeInTheDocument();
  });

  it('⚠️ writes nothing while the second box is being typed in; one write once focus has left BOTH', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '90');
    await user.tab();
    const height = settings().getByRole('spinbutton', { name: /Height/ });
    expect(height).toHaveFocus();
    await user.clear(height);
    await user.type(height, '4');
    // Longer than the settle time, still in the height box.
    await wait(SIZE_SETTLE_MS + 150);
    expect(source.labelSaves).toEqual([]);
    await user.type(height, '0');
    await user.tab();
    await waitFor(() => { expect(source.labelSaves).toEqual([{ widthMm: 90, heightMm: 40 }]); }, FIRST);
    await wait(SIZE_SETTLE_MS + 100);
    expect(source.labelSaves).toHaveLength(1);
  });

  it('⚠️ keeps the boxes open when what is half-typed equals a preset, until focus leaves them', async () => {
    const { source, user } = await openSettings({ labelConfig: { widthMm: 57, heightMm: 51 } });
    expect(choice('Label size', 'Custom size')).toBeChecked();
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '76');
    await user.tab();
    await wait(SIZE_SETTLE_MS + 150);
    // 76 × 51 is a preset, but nothing was written and the boxes are still under the finger.
    expect(source.labelSaves).toEqual([]);
    const height = settings().getByRole('spinbutton', { name: /Height/ });
    expect(height).toHaveFocus();
    await user.clear(height);
    await user.type(height, '6');
    await user.type(height, '0');
    await user.tab();
    await waitFor(() => { expect(source.labelSaves).toEqual([{ widthMm: 76, heightMm: 60 }]); }, FIRST);
  });

  it('⚠️ writes a size that waits its 350 ms at once when the page is hidden or put away, and takes the listeners off on leaving', async () => {
    const { source, user, router } = await openSettings();
    const setVisibility = (value: string) => Object.defineProperty(document, 'visibilityState', { configurable: true, value });
    try {
      await user.click(choice('Label size', 'Custom size'));
      const width = settings().getByRole('spinbutton', { name: /Width/ });
      await user.clear(width);
      await user.type(width, '90');
      await user.tab();
      await user.tab();
      expect(source.labelSaves).toEqual([]);
      setVisibility('hidden');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      expect(source.labelSaves).toEqual([{ widthMm: 90, heightMm: 51 }]);

      // The same through pagehide.
      const again = settings().getByRole('spinbutton', { name: /Width/ });
      await user.clear(again);
      await user.type(again, '100');
      await user.tab();
      await user.tab();
      act(() => { window.dispatchEvent(new Event('pagehide')); });
      expect(source.labelSaves).toEqual([{ widthMm: 90, heightMm: 51 }, { widthMm: 100, heightMm: 51 }]);

      await act(async () => { await router.navigate('/recipes'); });
      const before = source.labelSaves.length;
      act(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pagehide')); });
      expect(source.labelSaves).toHaveLength(before);
    } finally {
      setVisibility('visible');
    }
  });

  it('⚠️ a preset tapped while a custom size waits cancels it', async () => {
    const { source, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '90');
    await user.tab();
    await user.click(choice('Label size', '102 × 76'));
    await new Promise(resolve => setTimeout(resolve, SIZE_SETTLE_MS + 100));
    expect(source.labelSaves).toEqual([{ widthMm: 102, heightMm: 76 }]);
  });

  it('sends the printer, and shows the resolution ONLY for a printer driven in its own language', async () => {
    const { source, user } = await openSettings();
    expect(choice('Printer', 'Any printer (print dialog)')).toBeChecked();
    expect(screen.queryByRole('radiogroup', { name: 'Printer resolution' })).not.toBeInTheDocument();
    expect(settings().queryByText(/printed on the sticker/)).not.toBeInTheDocument();
    expect(settings().getByText(/A Zebra sets the text with its own type/)).toBeInTheDocument();

    await user.click(choice('Printer', 'Zebra (its own language)'));
    expect(source.labelSaves).toEqual([{ printerLanguage: 'zpl' }]);
    expect(choice('Printer resolution', '203 dpi')).toBeChecked();
    expect(settings().getByText(/printed on the sticker/)).toBeInTheDocument();
    await user.click(choice('Printer resolution', '300 dpi'));
    expect(source.labelSaves).toEqual([{ printerLanguage: 'zpl' }, { dpi: 300 }]);
    expect(choice('Printer resolution', '300 dpi')).toBeChecked();

    await user.click(choice('Printer', 'Any printer (print dialog)'));
    expect(screen.queryByRole('radiogroup', { name: 'Printer resolution' })).not.toBeInTheDocument();
  });

  it('⚠️ asks «Which date» ONLY when there is room for a date, with its safety note', async () => {
    const { source, user } = await openSettings();
    expect(screen.queryByRole('radiogroup', { name: 'Which date' })).not.toBeInTheDocument();
    expect(settings().queryByText(/is about SAFETY/)).not.toBeInTheDocument();
    expect(toggle('Leave room for a date')).not.toBeChecked();

    await user.click(toggle('Leave room for a date'));
    expect(source.labelSaves).toEqual([{ showDate: true }]);
    expect(choice('Which date', 'Use by')).toBeChecked();
    expect(settings().getByText(/is about SAFETY/)).toBeInTheDocument();
    await user.click(choice('Which date', 'Best before'));
    expect(source.labelSaves).toEqual([{ showDate: true }, { dateKind: 'bestBefore' }]);
    expect(choice('Which date', 'Best before')).toBeChecked();

    await user.click(toggle('Leave room for a date'));
    expect(screen.queryByRole('radiogroup', { name: 'Which date' })).not.toBeInTheDocument();
  });

  it('ends with the setup note', async () => {
    await openSettings();
    expect(settings().getByText(/Before the first print, set the label size/)).toBeInTheDocument();
  });
});

describe('What else goes on the label', () => {
  it('has the three switches, off until somebody switches them on, and the note about who it is for', async () => {
    const { source, user } = await openSettings();
    expect(settings().getByRole('heading', { level: 3, name: 'What else goes on the label' })).toBeInTheDocument();
    expect(settings().getByText(/These are for food sold somewhere else/)).toBeInTheDocument();
    for (const name of ['Net weight', 'How to keep it', 'Who made it']) expect(toggle(name)).not.toBeChecked();
    await user.click(toggle('Net weight'));
    expect(source.labelSaves).toEqual([{ showWeight: true }]);
    expect(toggle('Net weight')).toBeChecked();
  });

  it('⚠️ shows the storage box only when its switch is on, and the business boxes and note only for «Who made it»', async () => {
    const { user } = await openSettings();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(settings().queryByText(/A name with no address identifies nobody/)).not.toBeInTheDocument();

    await user.click(toggle('How to keep it'));
    const storage = box('How to keep it');
    expect(storage).toHaveAttribute('placeholder', 'e.g. Keep refrigerated below 5°C');
    expect(storage).toHaveAttribute('maxlength', '200');
    expect(screen.queryByRole('textbox', { name: 'Business name' })).not.toBeInTheDocument();

    await user.click(toggle('Who made it'));
    expect(box('Business name')).toBeInTheDocument();
    expect(box('Address')).toBeInTheDocument();
    expect(settings().getByText(/A name with no address identifies nobody/)).toBeInTheDocument();

    await user.click(toggle('How to keep it'));
    await user.click(toggle('Who made it'));
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('⚠️ says when a switch has nothing behind it, and stops saying it once there is something', async () => {
    const { user } = await openSettings({ labelConfig: { showStorage: true } });
    const hint = /Switched on, but nothing to print yet/;
    expect(settings().getByText(hint)).toBeInTheDocument();
    await user.type(box('How to keep it'), 'Keep cold');
    await user.tab();
    await waitFor(() => { expect(settings().queryByText(hint)).not.toBeInTheDocument(); });

    await user.click(toggle('Who made it'));
    expect(settings().getByText(hint)).toBeInTheDocument();
    await user.type(box('Address'), '1 High Street');
    await user.tab();
    await waitFor(() => { expect(settings().queryByText(hint)).not.toBeInTheDocument(); });
  });

  it('⚠️ saves a text box when it is LEFT, trimmed, and only if it differs from what is saved', async () => {
    const { source, user } = await openSettings({ labelConfig: { showStorage: true, storageText: 'Keep cold' } });
    const storage = box('How to keep it');
    expect(storage).toHaveValue('Keep cold');
    await user.type(storage, '  now ');
    expect(source.labelSaves).toEqual([]);
    await user.tab();
    expect(source.labelSaves).toEqual([{ storageText: 'Keep cold  now' }]);
    expect(box('How to keep it')).toHaveValue('Keep cold  now');

    // Left again with no change: nothing is sent.
    await user.click(box('How to keep it'));
    await user.tab();
    // Trailing spaces only: trimmed to the saved text, nothing is sent.
    await user.click(box('How to keep it'));
    await user.type(box('How to keep it'), '   ');
    await user.tab();
    expect(source.labelSaves).toHaveLength(1);
  });

  it('saves on Enter too', async () => {
    const { source, user } = await openSettings({ labelConfig: { showBusiness: true } });
    await user.type(box('Business name'), 'Bakery Ltd{Enter}');
    expect(source.labelSaves).toEqual([{ businessName: 'Bakery Ltd' }]);
  });

  it('⚠️ never writes .value under a box somebody is typing in: a snapshot arriving mid-word leaves the typing alone', async () => {
    const { source, user } = await openSettings({ labelConfig: { showStorage: true, storageText: 'Keep cold' } });
    const storage = box('How to keep it');
    await user.click(storage);
    await user.type(storage, ' dry');
    act(() => {
      source.labelConfig = { showStorage: true, storageText: 'Changed elsewhere' };
      source.push();
    });
    expect(box('How to keep it')).toHaveValue('Keep cold dry');
    await user.tab();
    expect(source.labelSaves).toEqual([{ storageText: 'Keep cold dry' }]);
  });

  it('shows what another phone saved when the box is not being typed in', async () => {
    const { source } = await openSettings({ labelConfig: { showStorage: true, storageText: 'Keep cold' } });
    act(() => {
      source.labelConfig = { showStorage: true, storageText: 'Changed elsewhere' };
      source.push();
    });
    await waitFor(() => { expect(box('How to keep it')).toHaveValue('Changed elsewhere'); });
  });
});

describe('a refused save', () => {
  it('⚠️ says so in a live region that was there before, and shows the value put back', async () => {
    const { source, user } = await openSettings();
    const live = settings().getAllByRole('status').find(node => node.textContent === '') as HTMLElement;
    expect(live).toBeInTheDocument();
    source.refuse.labelSave = true;
    await user.click(toggle('Net weight'));
    await waitFor(() => { expect(toggle('Net weight')).not.toBeChecked(); });
    expect(live).toHaveTextContent('Could not save — the change has been put back');
    expect(source.labelSaves).toEqual([]);

    // The next save clears the sentence.
    source.refuse.labelSave = false;
    await user.click(toggle('Net weight'));
    await waitFor(() => { expect(live).toHaveTextContent(''); });
    expect(toggle('Net weight')).toBeChecked();
  });

  it('puts a refused preset back to the paper it was', async () => {
    const { source, user } = await openSettings({ labelConfig: { widthMm: 57, heightMm: 32 } });
    source.refuse.labelSave = true;
    await user.click(choice('Label size', '102 × 76'));
    await waitFor(() => { expect(choice('Label size', '57 × 32')).toBeChecked(); });
    expect(settings().getByText('Could not save — the change has been put back')).toBeInTheDocument();
  });

  it('⚠️ a refusal after the screen has gone is said through the section’s message', async () => {
    const { source, router } = await openSettings({ labelConfig: { showStorage: true } });
    source.refuse.labelSave = true;
    const storage = box('How to keep it');
    storage.focus();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().type(storage, 'Keep cold');
    await act(async () => { await router.navigate('/recipes'); });
    await screen.findByRole('button', { name: 'r1' }, LOAD);
    await waitFor(() => { expect(screen.getByText('Could not save — the change has been put back')).toBeInTheDocument(); });
  });
});

describe('leaving with typing in a box', () => {
  it('⚠️ holds the app busy while a box holds typing that is not saved, and lets go when it is', async () => {
    const { user } = await openSettings({ labelConfig: { showStorage: true, storageText: 'Keep cold' } });
    expect(isBusy()).toBe(false);
    const storage = box('How to keep it');
    await user.type(storage, '!');
    expect(isBusy()).toBe(true);
    await user.tab();
    await waitFor(() => { expect(isBusy()).toBe(false); });
  });

  it('is not busy for typing that equals what is saved', async () => {
    const { user } = await openSettings({ labelConfig: { showStorage: true, storageText: 'Keep cold' } });
    await user.type(box('How to keep it'), ' ');
    expect(isBusy()).toBe(false);
  });

  it('holds the app busy while a custom size waits to be written', async () => {
    const { user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '90');
    expect(isBusy()).toBe(true);
    await user.tab();
    // Still in the second box, holding typing: busy.
    expect(isBusy()).toBe(true);
    await user.tab();
    expect(isBusy()).toBe(true);
    await waitFor(() => { expect(isBusy()).toBe(false); }, FIRST);
  });

  it('⚠️ saves a text box still holding typing when the screen goes, because the write outlives the screen', async () => {
    const { source, router } = await openSettings({ labelConfig: { showStorage: true } });
    const storage = box('How to keep it');
    storage.focus();
    const { default: userEvent } = await import('@testing-library/user-event');
    await userEvent.setup().type(storage, 'Keep cold');
    expect(source.labelSaves).toEqual([]);
    await act(async () => { await router.navigate('/recipes'); });
    expect(source.labelSaves).toEqual([{ storageText: 'Keep cold' }]);
  });

  it('⚠️ writes a custom size that is still waiting its 350 ms at once when the screen goes', async () => {
    const { source, router, user } = await openSettings();
    await user.click(choice('Label size', 'Custom size'));
    const width = settings().getByRole('spinbutton', { name: /Width/ });
    await user.clear(width);
    await user.type(width, '90');
    await user.tab();
    expect(source.labelSaves).toEqual([]);
    await act(async () => { await router.navigate('/recipes'); });
    expect(source.labelSaves).toEqual([{ widthMm: 90, heightMm: 51 }]);
    await new Promise(resolve => setTimeout(resolve, SIZE_SETTLE_MS + 100));
    expect(source.labelSaves).toHaveLength(1);
  });
});
