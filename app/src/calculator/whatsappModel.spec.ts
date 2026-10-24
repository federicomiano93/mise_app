import { describe, expect, it } from 'vitest';
import { ORDER_PREFILL_LABELS, ORDER_PREFILL_WINDOWS, getClients, normalizeConfig } from '@mise/shared/calculator-config';
import type { CalculatorConfig, WhatsappList } from '@mise/shared/calculator-config';
import { CLIENTS, configOf } from '../testing/renderCalculator';
import {
  PREFILL_LABEL_KEYS, addEntry, clientsToAdd, copyItem, editLines, entryOf, findDirect, findList, isBlank, lineNames, linesOf,
  newDirect, newId, newList, pickerGroups, pickerProducts, putItem, removeEntry, removeItem, sameItem, targetClient,
  tryAddFreeLine, withFreeLine, withItem, withName, withPrefillWindow, withProduct, withRenamedLine, withoutFreeLine, withoutItem,
  withoutProduct,
} from './whatsappModel';
import type { WorkingItem } from './whatsappModel';

const LIST: WhatsappList = {
  id: 'wl-1', title: 'Monday market',
  clients: [{ clientId: 'roma', products: ['tray'], extras: [{ id: 'wx-cut-loaves', name: 'Cut loaves' }] }],
};

function config(over: Record<string, unknown> = {}): CalculatorConfig {
  return normalizeConfig(configOf({
    whatsappLists: [LIST, { id: 'wl-2', title: 'Tuesday', clients: [] }],
    whatsappClients: [{ id: 'wc-1', name: 'Stall', products: ['roll'], extras: [] }],
    ...over,
  }));
}

describe('making and finding', () => {
  it('makes empty items with a prefixed id', () => {
    expect(newId('wl', () => 0.5)).toMatch(/^wl-/);
    expect(newList()).toMatchObject({ title: '', clients: [] });
    expect(newDirect()).toMatchObject({ name: '', products: [], extras: [] });
    expect(newList().id).not.toBe(newList().id);
  });

  it('finds a list and a direct client by id', () => {
    expect(findList(config(), 'wl-2')?.title).toBe('Tuesday');
    expect(findList(config(), 'nope')).toBeUndefined();
    expect(findDirect(config(), 'wc-1')?.name).toBe('Stall');
  });

  it('copies an item so the configuration is never edited in place', () => {
    const cfg = config();
    const copy = copyItem(findList(cfg, 'wl-1') as WhatsappList);
    copy.title = 'changed';
    expect(findList(cfg, 'wl-1')?.title).toBe('Monday market');
  });

  it('tells a blank name from a real one', () => {
    expect(isBlank('')).toBe(true);
    expect(isBlank('   ')).toBe(true);
    expect(isBlank(undefined)).toBe(true);
    expect(isBlank(' a ')).toBe(false);
  });

  it('labels every prefill window with the key the shared port names', () => {
    expect(ORDER_PREFILL_WINDOWS.map(window => PREFILL_LABEL_KEYS[window])).toEqual(
      ORDER_PREFILL_WINDOWS.map(window => ORDER_PREFILL_LABELS[window]),
    );
  });
});

describe('the dirty comparison', () => {
  const list: WorkingItem = { group: 'list', item: LIST };

  it('is false for a copy and for an edit put back', () => {
    expect(sameItem(list, { group: 'list', item: copyItem(LIST) })).toBe(true);
    const typed = withName(list, 'x');
    expect(sameItem(list, typed)).toBe(false);
    expect(sameItem(list, withName(typed, 'Monday market'))).toBe(true);
  });

  it('is true when only a free line changed', () => {
    expect(sameItem(list, editLines(list, 'roma', lines => withRenamedLine(lines, 0, 'Cut'))))
      .toBe(false);
  });
});

describe('writing over the LATEST configuration', () => {
  it('replaces the item with the same id, in its place, and leaves everything else as it is', () => {
    const latest = config();
    const next = withItem(latest, { group: 'list', item: { ...LIST, title: 'Renamed' } });
    expect(next.whatsappLists.map(list => list.title)).toEqual(['Renamed', 'Tuesday']);
    expect(next.whatsappClients).toEqual(latest.whatsappClients);
    expect(next.clients).toBe(latest.clients);
    expect(latest.whatsappLists[0]?.title).toBe('Monday market');
  });

  it('keeps another phone\'s change to a different list', () => {
    // The screen opened with Tuesday empty; another phone has since added a client to it.
    const latest = config({
      whatsappLists: [LIST, { id: 'wl-2', title: 'Tuesday', clients: [{ clientId: 'sole', products: [], extras: [] }] }],
    });
    const next = withItem(latest, { group: 'list', item: { ...LIST, title: 'Renamed' } });
    expect(next.whatsappLists[1]?.clients).toHaveLength(1);
  });

  it('adds an item the latest configuration lacks (new, or deleted elsewhere meanwhile) at the end', () => {
    const next = withItem(config(), { group: 'list', item: { id: 'wl-new', title: 'New', clients: [] } });
    expect(next.whatsappLists.map(list => list.id)).toEqual(['wl-1', 'wl-2', 'wl-new']);
    const direct = withItem(config(), { group: 'direct', item: { id: 'wc-9', name: 'Kiosk', products: [], extras: [] } });
    expect(direct.whatsappClients.map(item => item.id)).toEqual(['wc-1', 'wc-9']);
  });

  it('deletes ONE id from the latest configuration: another phone\'s added list survives', () => {
    const latest = config({ whatsappLists: [LIST, { id: 'wl-2', title: 'Tuesday', clients: [] }, { id: 'wl-3', title: 'Added elsewhere', clients: [] }] });
    expect(withoutItem(latest, 'list', 'wl-1').whatsappLists.map(list => list.id)).toEqual(['wl-2', 'wl-3']);
    expect(withoutItem(latest, 'direct', 'wc-1').whatsappClients).toEqual([]);
    expect(withoutItem(latest, 'list', 'wl-1').whatsappClients).toEqual(latest.whatsappClients);
  });

  it('changes only the prefill window', () => {
    const latest = config();
    expect(withPrefillWindow(latest, 'today')).toEqual({ ...latest, orderPrefillWindow: 'today' });
  });

  it('putItem and removeItem are by id', () => {
    expect(putItem([{ id: 'a', v: 1 }, { id: 'b', v: 1 }], { id: 'b', v: 2 })).toEqual([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
    expect(removeItem([{ id: 'a' }, { id: 'b' }], 'a')).toEqual([{ id: 'b' }]);
  });
});

describe('the client entries of a list', () => {
  it('adds a client once, empty, and removes it', () => {
    const added = addEntry(LIST, 'sole');
    expect(entryOf(added, 'sole')).toEqual({ clientId: 'sole', products: [], extras: [] });
    expect(addEntry(added, 'sole')).toBe(added);
    expect(removeEntry(added, 'sole').clients.map(entry => entry.clientId)).toEqual(['roma']);
  });

  it('offers only the address-book clients not already in the list', () => {
    const clients = getClients(config());
    expect(clientsToAdd(LIST, clients).map(client => client.id)).toEqual(['sole']);
    expect(clientsToAdd(addEntry(LIST, 'sole'), clients)).toEqual([]);
    expect(clientsToAdd(LIST, [])).toEqual([]);
  });
});

describe('the products and free lines', () => {
  const list: WorkingItem = { group: 'list', item: LIST };
  const direct: WorkingItem = { group: 'direct', item: { id: 'wc-1', name: 'Stall', products: ['roll'], extras: [] } };

  it('edits the lines of one entry, and of a direct client', () => {
    const next = editLines(list, 'roma', lines => withProduct(lines, 'slab'));
    expect(linesOf(next, 'roma')?.products).toEqual(['tray', 'slab']);
    expect(linesOf(editLines(direct, null, lines => withProduct(lines, 'tray')), null)?.products).toEqual(['roll', 'tray']);
    expect(editLines(list, 'sole', lines => withProduct(lines, 'slab'))).toEqual(list);
    expect(linesOf(list, null)).toBeUndefined();
  });

  it('adds a product once and removes one', () => {
    const lines = { products: ['a'], extras: [] };
    expect(withProduct(lines, 'a')).toBe(lines);
    expect(withoutProduct({ products: ['a', 'b'], extras: [] }, 'a').products).toEqual(['b']);
  });

  it('a new free line has no id yet, and typing in a line never gives it one', () => {
    const lines = withFreeLine({ products: [], extras: [{ id: 'wx-cut', name: 'Cut' }] }, 'Rolls');
    expect(lines.extras).toEqual([{ id: 'wx-cut', name: 'Cut' }, { id: '', name: 'Rolls' }]);
    const renamed = withRenamedLine(lines, 0, 'Cut loaves of bread');
    expect(renamed.extras[0]).toEqual({ id: 'wx-cut', name: 'Cut loaves of bread' });
    expect(withoutFreeLine(renamed, 0).extras).toEqual([{ id: '', name: 'Rolls' }]);
  });

  it('lists a target\'s products and free lines by name, skipping a deleted product and a blank line', () => {
    const cfg = config();
    expect(lineNames(cfg, { products: ['tray', 'gone'], extras: [{ id: 'wx-a', name: ' Cut ' }, { id: 'wx-b', name: '  ' }] }))
      .toEqual(['Focaccia tray', 'Cut']);
    expect(lineNames(cfg, { products: [], extras: [] })).toEqual([]);
  });

  it('refuses a blank name and a name the message already carries, and adds the rest', () => {
    const cfg = config();
    const lines = { products: ['tray'], extras: [{ id: 'wx-cut', name: 'Cut' }] };
    expect(tryAddFreeLine(cfg, lines, '   ')).toEqual({ kind: 'blank' });
    expect(tryAddFreeLine(cfg, lines, 'Cut')).toEqual({ kind: 'duplicate', name: 'Cut' });
    expect(tryAddFreeLine(cfg, lines, ' Focaccia tray ')).toEqual({ kind: 'duplicate', name: 'Focaccia tray' });
    const added = tryAddFreeLine(cfg, lines, ' Rolls ');
    expect(added).toMatchObject({ kind: 'added' });
    if (added.kind === 'added') expect(added.lines.extras.at(-1)).toEqual({ id: '', name: 'Rolls' });
  });

  it('a free line gets its id from the configuration\'s normaliser when it is saved: unique, wx-, blanks dropped', () => {
    const lines = ['Rolls', 'Rolls', '   ', 'Cut loaves'].reduce(
      (acc, name) => withFreeLine(acc, name), { products: [] as string[], extras: [] as { id: string; name: string }[] },
    );
    const saved = normalizeConfig(configOf({
      whatsappLists: [{ id: 'wl-1', title: 'x', clients: [{ clientId: 'roma', products: [], extras: lines.extras }] }],
    }));
    expect(saved.whatsappLists[0]?.clients[0]?.extras).toEqual([
      { id: 'wx-rolls', name: 'Rolls' }, { id: 'wx-rolls-2', name: 'Rolls' }, { id: 'wx-cut-loaves', name: 'Cut loaves' },
    ]);
  });
});

describe('the picker', () => {
  // Two clients sell «Focaccia tray» under different ids: the picker offers one row, and the client's own copy wins.
  const cfg = config();

  it('is unique by name', () => {
    expect(pickerProducts(cfg, null).rows.map(row => row.name)).toEqual([
      'Focaccia tray', 'Focaccia slab', 'Paused loaf', 'Brioche roll', 'Cheese by the kilo',
    ]);
  });

  it('the client\'s own copy of a name wins over an earlier client\'s', () => {
    const book = normalizeConfig(configOf({
      clients: [
        { id: 'a', name: 'A', products: [{ ...CLIENTS[0]?.products[0], id: 'a-tray' }] },
        { id: 'b', name: 'B', products: [{ ...CLIENTS[0]?.products[0], id: 'b-tray' }] },
      ],
    }));
    expect(pickerProducts(book, null).rows[0]?.id).toBe('a-tray');
    expect(pickerProducts(book, targetClient(book, 'b')).rows[0]?.id).toBe('b-tray');
    const groups = pickerGroups(book, targetClient(book, 'b'), { products: [], extras: [] });
    expect(groups.own.map(row => row.id)).toEqual(['b-tray']);
    expect(groups.others).toEqual([]);
  });

  it('puts the client\'s own products first, then the rest, and leaves out what the message carries (products and free lines)', () => {
    const roma = targetClient(cfg, 'roma');
    const groups = pickerGroups(cfg, roma, { products: ['tray'], extras: [{ id: 'wx-c', name: 'Cheese by the kilo' }] });
    expect(groups.own.map(row => row.name)).toEqual(['Focaccia slab', 'Paused loaf', 'Brioche roll']);
    expect(groups.others).toEqual([]);
    expect(groups.total).toBe(5);
    expect(groups.added.has('Focaccia tray')).toBe(true);
  });

  it('a direct client has no products of its own: everything is «others»', () => {
    expect(targetClient(cfg, null)).toBeNull();
    const groups = pickerGroups(cfg, null, { products: [], extras: [] });
    expect(groups.own).toEqual([]);
    expect(groups.others).toHaveLength(5);
  });

  it('an unknown client has no products of its own either', () => {
    const groups = pickerGroups(cfg, targetClient(cfg, 'gone'), { products: [], extras: [] });
    expect(groups.own).toEqual([]);
    expect(groups.others).toHaveLength(5);
  });

  it('everything added → total says the address book is not empty', () => {
    const all = { products: ['tray', 'slab', 'paused', 'roll', 'cheese'], extras: [] };
    const groups = pickerGroups(cfg, null, all);
    expect(groups.own).toEqual([]);
    expect(groups.others).toEqual([]);
    expect(groups.total).toBe(5);
  });
});
