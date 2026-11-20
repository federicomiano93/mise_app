// The «To do today» half's rules (restTodos.ts): which to-dos, in what order, how many, which are late.

import { describe, expect, test } from 'vitest';
import { workDayDate } from '@mise/shared/kiosk-model';
import type { KioskTodo } from './kioskTodosSource';
import { MAX_TODOS_SHOWN, restTodosFor } from './restTodos';

const todo = (text: string, day: string, createdAtMs: number | null = 1): KioskTodo => ({ text, day, createdAtMs });
const TODAY = '2026-10-05';
const texts = (list: ReturnType<typeof restTodosFor>) => list.items.map(i => i.text);

describe('restTodosFor', () => {
  test('keeps overdue and today, drops tomorrow and later', () => {
    const out = restTodosFor([todo('later', '2026-10-06'), todo('today', TODAY), todo('old', '2026-10-01')], TODAY);
    expect(texts(out)).toStrictEqual(['old', 'today']);
  });

  test('overdue first (oldest day, then made first), then today by when it was made', () => {
    const out = restTodosFor([
      todo('today b', TODAY, 20), todo('today a', TODAY, 10),
      todo('late newer day', '2026-10-04', 1), todo('late older day b', '2026-10-02', 50), todo('late older day a', '2026-10-02', 5),
    ], TODAY);
    // The cap is 4, so the last of today's falls into «more».
    expect(texts(out)).toStrictEqual(['late older day a', 'late older day b', 'late newer day', 'today a']);
    expect(out.more).toBe(1);
  });

  test('flags the overdue ones only', () => {
    const out = restTodosFor([todo('x', '2026-10-04'), todo('y', TODAY)], TODAY);
    expect(out.items).toStrictEqual([{ text: 'x', late: true }, { text: 'y', late: false }]);
  });

  test('an item with no creation time goes last of its group', () => {
    const out = restTodosFor([todo('none', TODAY, null), todo('known', TODAY, 99)], TODAY);
    expect(texts(out)).toStrictEqual(['known', 'none']);
  });

  test('at most four, the rest counted', () => {
    const many = Array.from({ length: 7 }, (_, i) => todo(`t${i}`, TODAY, i));
    const out = restTodosFor(many, TODAY);
    expect(MAX_TODOS_SHOWN).toBe(4);
    expect(out.items).toHaveLength(4);
    expect(out.more).toBe(3);
  });

  test('nothing due: nothing drawn', () => {
    expect(restTodosFor([todo('later', '2026-10-09')], TODAY)).toStrictEqual({ items: [], more: 0 });
  });

  test('does not reorder the caller’s list', () => {
    const list = [todo('b', TODAY, 2), todo('a', TODAY, 1)];
    restTodosFor(list, TODAY);
    expect(list.map(t => t.text)).toStrictEqual(['b', 'a']);
  });
});

describe('before 04:00 the work day is yesterday', () => {
  test('the work day decides: a to-do of the real date is tomorrow’s', () => {
    const today = workDayDate(new Date(2026, 9, 5, 2, 30).getTime());
    expect(today).toBe('2026-10-04');
    const out = restTodosFor([todo('by the clock', '2026-10-05'), todo('work day', '2026-10-04'), todo('before', '2026-10-03')], today);
    expect(out.items).toStrictEqual([{ text: 'before', late: true }, { text: 'work day', late: false }]);
  });
});
