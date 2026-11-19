import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { todayISO } from '@mise/shared/day';
import { addProduct } from '../testing/bookingForm';
import { fakeBookingsSource, priceListOf } from '../testing/fakeBookingsSource';
import { renderApp } from '../testing/renderApp';
import { LIMITS, dayAfter } from './bookingModel';
import { DEFAULT_SETTINGS } from './bookingSettings';
import formBarCss from '../ui/FormBar.module.css?raw';
import namesCss from './CustomerNameField.module.css?raw';

// The common names under «Nome cliente» (19 Nov 2026): Italian venues only, a window over the form, never picks by itself.
// ⚠️ Fake customers only.

const LOAD = { timeout: 5000 };
const TOMORROW = dayAfter(todayISO(), 1);

function show(country: string | null) {
  const source = fakeBookingsSource([], priceListOf([]), { ...DEFAULT_SETTINGS, askPhone: false });
  const view = renderApp('/bookings/new', {
    data: { bookings: () => source },
    session: { location: country === null ? {} : { country } },
  });
  return { ...view, source };
}

async function nameBox() {
  await screen.findByRole('region', { name: 'New booking' }, LOAD);
  return screen.getByLabelText('Customer name');
}

const optionNames = () => screen.queryAllByRole('option').map(option => option.textContent);

beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { vi.restoreAllMocks(); });

describe('the names window', () => {
  it('opens under the box from two letters, with the typed letters in bold, and no heading inside it', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    expect(box).toHaveAttribute('role', 'combobox');
    await user.type(box, 'G');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(box, 'iu');
    const list = screen.getByRole('listbox', { name: 'Suggested names' });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box).toHaveAttribute('aria-controls', list.id);
    expect(optionNames().length).toBeLessThanOrEqual(5);
    const row = within(list).getByRole('option', { name: 'Giuseppe' });
    expect(row.querySelector('strong')?.textContent).toBe('Giu');
    // Only rows: no heading, no label text.
    expect(within(list).queryByRole('heading')).toBeNull();
    expect(list.children).toHaveLength(list.querySelectorAll('[role="option"]').length);
  });

  it('a tap on a row puts the word and ONE space in the box and keeps the focus there', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Giu');
    await user.click(screen.getByRole('option', { name: 'Giuseppe' }));
    expect(box).toHaveValue('Giuseppe ');
    expect(box).toHaveFocus();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('after the first word the surnames come first: «Pap» offers Pappalardo first, and a pick keeps the earlier words', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Pap');
    expect(optionNames()[0]).toBe('Pappalardo');
    await user.clear(box);
    await user.type(box, 'Maria Pap');
    expect(optionNames()[0]).toBe('Pappalardo');
    await user.click(screen.getByRole('option', { name: 'Pappalardo' }));
    expect(box).toHaveValue('Maria Pappalardo ');
  });

  it('a compound surname: «Di M» offers Di Mauro, and the pick replaces both words', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Maria Di M');
    await user.click(screen.getByRole('option', { name: 'Di Mauro' }));
    expect(box).toHaveValue('Maria Di Mauro ');
  });

  it('the arrows highlight a row and Enter picks it; Enter with nothing highlighted picks nothing', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Pap');
    expect(box).not.toHaveAttribute('aria-activedescendant');
    await user.keyboard('{ArrowDown}');
    const first = screen.getAllByRole('option')[0]!;
    expect(first).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', first.id);
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('Pappalardo ');
  });

  it('Escape closes it; leaving the box closes it; a tap outside closes it', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Giu');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.type(box, 's');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.tab();
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(box);
    await user.type(box, 'e');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it.each([['GB'], [null]])('⚠️ any other country (%s) keeps the plain box: no combobox, no window', async country => {
    const { user } = show(country);
    const box = await nameBox();
    await user.type(box, 'Giu');
    expect(box).not.toHaveAttribute('role');
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('⚠️ saving after a pick stores the name without the trailing space', async () => {
    const { user, source } = show('IT');
    const box = await nameBox();
    await addProduct(user, 'Torta su misura');
    await user.type(box, 'Giu');
    await user.click(screen.getByRole('option', { name: 'Giuseppe' }));
    await user.click(screen.getByRole('radio', { name: 'Pickup' }));
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: TOMORROW } });
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '08:15' } });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await user.click(within(await screen.findByRole('alertdialog', { name: 'Save this booking?' })).getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(source.create).toHaveBeenCalledWith(expect.objectContaining({ customerName: 'Giuseppe' })); });
  });

  it('the window floats over the form on tokens only, above the form bar', () => {
    expect(namesCss).toMatch(/\.window\s*\{[^}]*position: absolute;[^}]*top: 100%;[^}]*left: 0;[^}]*right: 0;[^}]*z-index: 1;/);
    expect(namesCss).toMatch(/border: 1px solid var\(--line-2\);[^}]*border-radius: var\(--r-md\);[^}]*background: var\(--surface\);[^}]*box-shadow: var\(--shadow-2\);/);
    expect(namesCss).toMatch(/\.row\s*\{[^}]*min-height: calc\(var\(--hit\) \+ var\(--s1\)\);/);
    expect(namesCss).toMatch(/\.row\[data-active="true"\]\s*\{\s*background: var\(--accent-tint\);/);
    expect(formBarCss).toMatch(/\.bar\s*\{[^}]*z-index: 2;/);
    expect(namesCss).toMatch(/\.window\[data-wide="true"\]\s*\{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  });

  it('Enter with nothing highlighted picks nothing; ArrowUp starts from the last row and wraps both ways', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Ma');
    const count = screen.getAllByRole('option').length;
    await user.keyboard('{Enter}');
    expect(box).toHaveValue('Ma');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    const selected = () => screen.getAllByRole('option').findIndex(option => option.getAttribute('aria-selected') === 'true');
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(count - 1);
    await user.keyboard('{ArrowDown}');
    expect(selected()).toBe(0);
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(count - 1);
    await user.keyboard('{ArrowUp}');
    expect(selected()).toBe(count - 2);
  });

  it('the pick is cut at the name limit inside the component', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    fireEvent.change(box, { target: { value: `${'A'.repeat(LIMITS.customerName - 4)} Giu` } });
    await user.click(screen.getByRole('option', { name: 'Giuseppe' }));
    expect((box as HTMLInputElement).value).toHaveLength(LIMITS.customerName);
  });

  it('the tap-outside listener is removed when the window closes', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    await user.type(box, 'Giu');
    expect(added).toHaveBeenCalledWith('pointerdown', expect.any(Function));
    await user.keyboard('{Escape}');
    expect(removed).toHaveBeenCalledWith('pointerdown', expect.any(Function));
  });

  it('only with the caret at the end: editing an earlier word closes the window', async () => {
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Giu');
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.type(box, 'a', { initialSelectionStart: 0, initialSelectionEnd: 0 });
    expect(box).toHaveValue('aGiu');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('the name asks for capitals on each word', async () => {
    show('IT');
    expect(await nameBox()).toHaveAttribute('autocapitalize', 'words');
  });

  it('a wide box lays the rows out in three columns, a narrow one in a list', async () => {
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get');
    width.mockReturnValue(700);
    const { user } = show('IT');
    const box = await nameBox();
    await user.type(box, 'Ma');
    expect(screen.getByRole('listbox')).toHaveAttribute('data-wide', 'true');
  });
});

describe('keeping the window in sight', () => {
  // jsdom lays nothing out: the rectangles, the visual viewport and the scroll are stubbed.
  function stage(listBottom: number, viewportHeight: number) {
    const rects = new Map<string, Partial<DOMRect>>();
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function rect(this: Element) {
      const key = this.getAttribute('role') === 'listbox' ? 'list' : this.tagName === 'INPUT' ? 'input' : this.tagName === 'HEADER' ? 'bar' : this.hasAttribute('data-scroller') ? 'scroller' : '';
      const found = rects.get(key) ?? { top: 0, bottom: 0 };
      return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}), ...found } as DOMRect;
    });
    rects.set('list', { bottom: listBottom });
    rects.set('input', { top: 300 });
    rects.set('bar', { bottom: 100 });
    rects.set('scroller', { top: 90, bottom: 5000 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: { offsetTop: 0, height: viewportHeight } });
    return { scroll: vi.fn(), rects };
  }

  async function open(scroll: ReturnType<typeof vi.fn>) {
    const { user } = show('IT');
    const box = await nameBox();
    const form = box.closest('form') as HTMLFormElement;
    form.style.overflowY = 'auto';
    form.setAttribute('data-scroller', '');
    form.scrollBy = scroll as unknown as typeof form.scrollBy;
    await user.type(box, 'Giu');
    return screen.getByRole('listbox');
  }

  afterEach(() => { Reflect.deleteProperty(window, 'visualViewport'); });

  it('a window that fits scrolls nothing', async () => {
    const { scroll } = stage(250, 600);
    await open(scroll);
    expect(scroll).not.toHaveBeenCalled();
  });

  it('a window the keyboard covers scrolls once, so the box sits just under the bar', async () => {
    const { scroll } = stage(500, 289);
    await open(scroll);
    expect(scroll).toHaveBeenCalledTimes(1);
    // The box top (300) minus the bar's real bottom (100) minus the small gap (8).
    expect(scroll).toHaveBeenCalledWith({ top: 192 });
  });

  it('a window clipped by its scrolling column scrolls it, though the screen is tall', async () => {
    const { scroll, rects } = stage(500, 900);
    rects.set('scroller', { top: 90, bottom: 400 });
    await open(scroll);
    expect(scroll).toHaveBeenCalledTimes(1);
  });
});
