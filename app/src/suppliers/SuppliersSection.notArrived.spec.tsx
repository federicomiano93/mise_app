import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, screen, within } from '@testing-library/react';
import { STALL_MS } from './suppliersStore';
import { fakeSuppliersSource } from '../testing/fakeSuppliersSource';
import { LOAD, item, renderSuppliers, split, supplier } from '../testing/renderSuppliers';

// «This list has not arrived yet»: a list that has not answered says «Loading…», and after 10 s (or at once with the phone offline
// and only an empty copy) says it has not arrived and what to check, in the three lists and on a supplier's own screen (the
// current app's orders.registry.notArrived.*). It goes back to the rows the moment the list answers.

beforeAll(async () => { await import('./SuppliersSection'); }, 60_000);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const TITLE = 'This list has not arrived yet';
const SUB = 'Check your connection: it will appear here as soon as it arrives.';
const main = () => within(screen.getByRole('main'));

function seeded(extra = {}) {
  return fakeSuppliersSource({
    suppliers: [supplier('s-zed', { name: 'Zed Dairy Ltd', shortName: 'Zed' })],
    ingredients: [item('i-milk', { name: 'Milk', supplierId: 's-zed' }), item('i-box', { name: 'Box', kind: 'packaging' })],
    ...extra,
  });
}

// Everything is held back, with the clock in the spec's hands.
async function waiting(path: string, options = {}) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const source = seeded();
  source.hold();
  const view = renderSuppliers(path, { source, ...options });
  await act(async () => { await Promise.resolve(); });
  return { ...view, source };
}

const pass = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe.each([
  ['/suppliers'],
  ['/suppliers/suppliers'],
  ['/suppliers/packaging'],
])('the list at %s', (path) => {
  it('says «Loading…» while it waits, «has not arrived» at 10 s, and shows the rows the moment it answers', async () => {
    const { source } = await waiting(path);
    expect(main().getByText('Loading…')).toBeInTheDocument();
    expect(main().queryByText(TITLE)).not.toBeInTheDocument();
    await pass(STALL_MS - 1);
    expect(main().queryByText(TITLE)).not.toBeInTheDocument();
    await pass(1);
    expect(main().getByText(TITLE)).toBeInTheDocument();
    expect(main().getByText(SUB)).toBeInTheDocument();
    expect(main().queryByText('Loading…')).not.toBeInTheDocument();
    act(() => { source.release(); });
    expect(main().queryByText(TITLE)).not.toBeInTheDocument();
    expect(main().getAllByRole('listitem').length).toBeGreaterThan(0);
  });

  it('⚠️ is the SAME status region across both (a screen reader hears the change inside one that was already there)', async () => {
    await waiting(path);
    const region = main().getByText('Loading…').closest('[role="status"]');
    expect(region).not.toBeNull();
    await pass(STALL_MS);
    expect(main().getByText(TITLE).closest('[role="status"]')).toBe(region);
  });
});

describe('the other ways in', () => {
  // ⚠️ THE CLOCK IS FAKE AND NEVER WOUND: the 10 s stall timer cannot be what says it, or these would pass with the offline rule broken.
  const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

  it('an empty copy with the phone offline says it at once, with no 10 s wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', Object.create(navigator, { onLine: { value: false } }));
    const source = seeded({ suppliers: [], ingredients: [] });
    source.fromCache = true;
    renderSuppliers('/suppliers', { source });
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    expect(main().getByText(TITLE)).toBeInTheDocument();
    expect(screen.queryByText(/No ingredients yet/)).not.toBeInTheDocument();
  });

  it('an empty copy with the phone online keeps saying «Loading…» (the server may still have rows)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('navigator', Object.create(navigator, { onLine: { value: true } }));
    const source = seeded({ suppliers: [], ingredients: [] });
    source.fromCache = true;
    renderSuppliers('/suppliers', { source });
    await flush();
    expect(main().getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('⚠️ on the tablet split only the list speaks; the supplier screen beside it is quiet (a screen reader would hear it twice)', async () => {
    split();
    const { source } = await waiting('/suppliers/supplier/s-zed');
    await pass(STALL_MS);
    const spoken = main().getAllByText(TITLE).filter(node => node.closest('[role="status"]') !== null);
    expect(main().getAllByText(TITLE)).toHaveLength(2);
    expect(spoken).toHaveLength(1);
    act(() => { source.release(); });
  });

  it('on a phone the supplier screen speaks for itself (the list is hidden behind it)', async () => {
    await waiting('/suppliers/supplier/s-zed');
    await pass(STALL_MS);
    const spoken = main().getAllByText(TITLE).filter(node => node.closest('[role="status"]') !== null);
    expect(spoken).toHaveLength(2);
  });

  it('a supplier\'s own screen says it too, and shows the supplier the moment it arrives', async () => {
    const { source } = await waiting('/suppliers/supplier/s-zed');
    // (On a phone the list stays mounted behind the supplier's screen: two places say it, the list's and the screen's.)
    expect(main().getAllByText('Loading…')).toHaveLength(2);
    await pass(STALL_MS);
    expect(main().getAllByText(TITLE)).toHaveLength(2);
    act(() => { source.release(); });
    vi.useRealTimers();
    expect(await screen.findByRole('region', { name: 'Zed' }, LOAD)).toBeInTheDocument();
    expect(screen.queryByText(TITLE)).not.toBeInTheDocument();
  });

  it('says it in Italian, with the current app\'s words', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const source = seeded();
    source.hold();
    renderSuppliers('/suppliers', { source, lang: 'it', session: { language: 'it', location: { country: 'IT' } } });
    await act(async () => { await Promise.resolve(); });
    await pass(STALL_MS);
    expect(main().getByText('Questo elenco non è ancora arrivato')).toBeInTheDocument();
    expect(main().getByText('Controlla la connessione: comparirà qui appena arriva.')).toBeInTheDocument();
  });
});
