import { describe, expect, it, vi } from 'vitest';
import { CLEARED_NOTE_MS, createTabState } from './calculatorTabState';

// The memory of the tabs, against a storage of its own and a clock of its own. The keys are the current
// app's (calculator-tab-keys pins their spelling); what is asserted here is which of them are written when.

const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

function memoryStorage(seed: Record<string, string> = {}) {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function setup(seed: Record<string, string> = {}, startMs = at(12, 10)) {
  const storage = memoryStorage(seed);
  let now = startMs;
  const state = createTabState(storage, () => now);
  return { storage, state, setNow: (ms: number) => { now = ms; } };
}

describe('writing', () => {
  it('keeps the text under the key, as given', () => {
    const { state, storage } = setup();
    state.set('qty-a::b', '2.50');
    expect(storage.data.get('qty-a::b')).toBe('2.50');
    expect(state.read('qty-a::b')).toBe('2.50');
  });

  it('stamps the tab as used only when asked, with the time as text', () => {
    const { state, storage, setNow } = setup();
    setNow(123456);
    state.set('total-r1', '300');
    expect(storage.data.has('touched-r1')).toBe(false);
    state.set('total-r1', '400', 'r1');
    expect(storage.data.get('touched-r1')).toBe('123456');
  });

  it('tells its readers, once per write, and stops telling one that left', () => {
    const { state } = setup();
    const listener = vi.fn();
    const stop = state.subscribe(listener);
    const before = state.getVersion();
    state.set('qty-a::b', '1', 'r1');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(state.getVersion()).toBe(before + 1);
    stop();
    state.set('qty-a::b', '2');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('still remembers what it was given on a phone that refuses storage', () => {
    const state = createTabState(null, () => 1);
    state.set('qty-a::b', '5', 'r1');
    expect(state.read('qty-a::b')).toBe('5');
    expect(state.read('touched-r1')).toBe('1');
  });

  it('survives a storage that throws', () => {
    const throwing = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    const state = createTabState(throwing, () => 1);
    expect(state.read('qty-a::b')).toBeNull();
    state.set('qty-a::b', '5');
    expect(state.read('qty-a::b')).toBe('5');
    state.forget('r1', ['a::b']);
    expect(state.read('qty-a::b')).toBeNull();
  });
});

describe('forgetting a tab', () => {
  const KEPT = {
    'qty-a::b': '3', 'qty-a::c': '4', 'param-r1': '0.8', 'total-r1': '200', 'trays-r1': '2', 'extra-r1': '1',
    'extra-unit-r1': 'g', 'touched-r1': '5', 'revealed-r1': '1', 'lock-r1': '{"locked":true,"logId":"log-1"}',
  };

  it('removes every key of the tab, the lock and the confirmed flag included', () => {
    const { state, storage } = setup({ ...KEPT, 'param-r2': '9', 'qty-x::y': '1' });
    state.forget('r1', ['a::b', 'a::c']);
    for (const key of Object.keys(KEPT)) expect(storage.data.has(key), key).toBe(false);
  });

  it('leaves another tab and an unrelated key alone', () => {
    const { state, storage } = setup({ ...KEPT, 'param-r2': '9', 'mise.calcZoomStep': '3', 'qty-x::y': '1' });
    state.forget('r1', ['a::b', 'a::c']);
    expect(storage.data.get('param-r2')).toBe('9');
    expect(storage.data.get('mise.calcZoomStep')).toBe('3');
    expect(storage.data.get('qty-x::y')).toBe('1');
  });

  it('reads as nothing afterwards, whatever the storage still holds', () => {
    const { state } = setup(KEPT);
    state.forget('r1', ['a::b']);
    expect(state.read('param-r1')).toBeNull();
    expect(state.read('lock-r1')).toBeNull();
  });
});

describe('the new-work-day sweep', () => {
  const tab = (id: string) => ({ id, qtyIds: ['a::b'] });

  it('clears a tab last used on an earlier work day, and says which', () => {
    const { state, storage } = setup({ 'touched-r1': String(at(11, 15)), 'qty-a::b': '3', 'lock-r1': '{"locked":true,"logId":"x"}' });
    expect(state.sweep([tab('r1')])).toEqual(['r1']);
    expect(storage.data.size).toBe(0);
  });

  it('keeps a tab last used today', () => {
    const { state, storage } = setup({ 'touched-r1': String(at(12, 8)), 'qty-a::b': '3' });
    expect(state.sweep([tab('r1')])).toEqual([]);
    expect(storage.data.get('qty-a::b')).toBe('3');
  });

  it('keeps a tab nobody used, and a stamp that is not a time', () => {
    const { state, storage } = setup({ 'qty-a::b': '3', 'touched-r2': 'junk', 'touched-r3': '0' });
    expect(state.sweep([tab('r1'), tab('r2'), tab('r3')])).toEqual([]);
    expect(storage.data.get('qty-a::b')).toBe('3');
  });

  it('counts the day from 4 am', () => {
    const night = { 'touched-r1': String(new Date(2026, 9, 11, 23, 30).getTime()) };
    const a = setup(night, new Date(2026, 9, 12, 3, 59).getTime());
    expect(a.state.sweep([tab('r1')])).toEqual([]);
    const b = setup(night, new Date(2026, 9, 12, 4, 0).getTime());
    expect(b.state.sweep([tab('r1')])).toEqual(['r1']);
  });

  it('only forgets the tabs of the list it is given', () => {
    const { state, storage } = setup({ 'touched-r1': String(at(11, 15)), 'touched-r2': String(at(11, 15)) });
    expect(state.sweep([tab('r1')])).toEqual(['r1']);
    expect(storage.data.has('touched-r2')).toBe(true);
  });

  it('does not tell its readers when there was nothing to clear', () => {
    const { state } = setup({ 'touched-r1': String(at(12, 8)) });
    const listener = vi.fn();
    state.subscribe(listener);
    state.sweep([tab('r1')]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('is done once: a second sweep finds nothing', () => {
    const { state } = setup({ 'touched-r1': String(at(11, 15)) });
    expect(state.sweep([tab('r1')])).toEqual(['r1']);
    expect(state.sweep([tab('r1')])).toEqual([]);
  });
});

describe('the note', () => {
  it('is due for twelve seconds for a tab the sweep cleared, and for no other', () => {
    const { state, setNow } = setup({ 'touched-r1': String(at(11, 15)) });
    expect(state.noteLeft('r1')).toBe(0);
    state.sweep([{ id: 'r1', qtyIds: [] }, { id: 'r2', qtyIds: [] }]);
    expect(CLEARED_NOTE_MS).toBe(12_000);
    expect(state.noteLeft('r1')).toBe(12_000);
    expect(state.noteLeft('r2')).toBe(0);
    setNow(at(12, 10) + 5_000);
    expect(state.noteLeft('r1')).toBe(7_000);
    setNow(at(12, 10) + 12_000);
    expect(state.noteLeft('r1')).toBe(0);
    setNow(at(12, 10) + 99_000);
    expect(state.noteLeft('r1')).toBe(0);
  });
});

describe('removing one key', () => {
  it('forgets that key only, and tells its readers', () => {
    const { state, storage } = setup({ 'revealed-r1': '1', 'qty-a::b': '3' });
    const listener = vi.fn();
    state.subscribe(listener);
    state.remove('revealed-r1');
    expect(storage.data.has('revealed-r1')).toBe(false);
    expect(state.read('revealed-r1')).toBeNull();
    expect(storage.data.get('qty-a::b')).toBe('3');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('how often a tab was forgotten', () => {
  it('moves on with a Reset and with the new-day sweep, for that tab only', () => {
    const { state } = setup({ 'touched-r1': String(at(11, 15)), 'touched-r2': String(at(12, 8)) });
    expect([state.forgotten('r1'), state.forgotten('r2')]).toEqual([0, 0]);
    state.sweep([{ id: 'r1', qtyIds: [] }, { id: 'r2', qtyIds: [] }]);
    expect([state.forgotten('r1'), state.forgotten('r2')]).toEqual([1, 0]);
    state.forget('r2', []);
    expect([state.forgotten('r1'), state.forgotten('r2')]).toEqual([1, 1]);
  });
});
