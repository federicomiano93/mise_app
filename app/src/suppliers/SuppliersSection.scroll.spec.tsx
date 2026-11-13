import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// Where the page is scrolled to when «Ingredients & suppliers» moves between its list and a supplier opened from it. The
// shell has ONE scroll area (the main landmark) and resets it at every address; this section owns it for the moves inside
// itself (shell/scrollArea.tsx), so these specs pin what it does with each move. jsdom does not lay out or scroll: the
// position is planted.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => { vi.unstubAllGlobals(); });

const source = () => fakeSuppliersSource({
  suppliers: [supplier('a', { name: 'Aaa' }), supplier('b', { name: 'Bbb' }), supplier('c', { name: 'Ccc' })],
  ingredients: [item('1', { name: 'Anise', supplierId: 'a' }), item('2', { name: 'Basil', supplierId: 'b' })],
});

const rowOf = (name: RegExp) => within(screen.getByRole('main')).getByRole('button', { name });

async function loaded(path = '/suppliers/suppliers') {
  const view = renderSuppliers(path, { source: source() });
  await screen.findByRole('button', { name: /^Aaa/ }, LOAD);
  return view;
}

// The shell's scroll area, scrolled to `top`.
function scrolledTo(top: number): HTMLElement {
  const main = screen.getByRole('main');
  Object.defineProperty(main, 'scrollTop', { value: top, writable: true });
  return main;
}

describe('the scroll on the tablet\'s split', () => {
  it('keeps the place in the list when a supplier is opened, and when another one is', async () => {
    split();
    const { user } = await loaded();
    const main = scrolledTo(900);
    await user.click(rowOf(/^Bbb/));
    await screen.findByRole('region', { name: 'Bbb' }, LOAD);
    expect(main.scrollTop).toBe(900);
    await user.click(rowOf(/^Ccc/));
    await screen.findByRole('region', { name: 'Ccc' }, LOAD);
    expect(main.scrollTop).toBe(900);
  });

  it('starts the next supplier at the top of the right-hand side, not where the last was left', async () => {
    split();
    const { user } = await loaded();
    await user.click(rowOf(/^Bbb/));
    const detail = screen.getByRole('region', { name: 'Bbb' }).closest('[data-view] > *') as HTMLElement;
    Object.defineProperty(detail, 'scrollTop', { value: 300, writable: true });
    await user.click(rowOf(/^Ccc/));
    await screen.findByRole('region', { name: 'Ccc' }, LOAD);
    expect(detail.scrollTop).toBe(0);
  });

  it('sends a new tab\'s list to the top', async () => {
    split();
    const { user } = await loaded();
    const main = scrolledTo(900);
    await user.click(screen.getByRole('tab', { name: 'Ingredients' }));
    expect(main.scrollTop).toBe(0);
  });
});

describe('Back on the tablet\'s split with nothing changed (item 16, found by a driver at 1024)', () => {
  // The driver saw the list move from 2008 to 1709 after an untouched open + Back. The section never writes the scroll on a move
  // between two screens that are both beside the list; the 299 px was the driver's own Back press, which first called
  // scrollIntoView({ block: 'center' }) on a button that is stuck to the top of the right-hand pane, and a browser scrolls the
  // page for that. So the section's half is pinned here: it leaves the place alone, and hands the focus back to the row.
  it('keeps the place in the list and puts the focus back on the row, for an ingredient and for a supplier', async () => {
    split();
    const { user } = await loaded('/suppliers/suppliers');
    await user.click(screen.getByRole('tab', { name: 'Ingredients' }));
    const main = scrolledTo(1200);
    await user.click(rowOf(/^Anise/));
    await screen.findByRole('heading', { level: 2, name: 'Edit ingredient' }, LOAD);
    expect(main.scrollTop).toBe(1200);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(rowOf(/^Anise/)).toHaveFocus(); });
    expect(main.scrollTop).toBe(1200);

    await user.click(screen.getByRole('tab', { name: 'Suppliers' }));
    scrolledTo(900);
    await user.click(rowOf(/^Bbb/));
    await screen.findByRole('region', { name: 'Bbb' }, LOAD);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(rowOf(/^Bbb/)).toHaveFocus(); });
    expect(main.scrollTop).toBe(900);
  });
});

describe('the scroll on a phone', () => {
  it('opens a supplier at the top, and Back brings the list to the place it was left at, with the focus on its row', async () => {
    const { user } = await loaded();
    const main = scrolledTo(700);
    await user.click(rowOf(/^Bbb/));
    await screen.findByRole('region', { name: 'Bbb' }, LOAD);
    expect(main.scrollTop).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => { expect(rowOf(/^Bbb/)).toHaveFocus(); });
    expect(main.scrollTop).toBe(700);
  });

  it('sends a tab to the top of its list', async () => {
    const { user } = await loaded();
    const main = scrolledTo(700);
    await user.click(screen.getByRole('tab', { name: 'Packaging' }));
    expect(main.scrollTop).toBe(0);
  });
});
