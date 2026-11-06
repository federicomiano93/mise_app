import { describe, expect, it } from 'vitest';
import { groupTodos } from './todoModel';
import type { TodoGroup } from './todoModel';
import type { TodoItem } from './todosSource';

const DAY_MS = 86_400_000;
const TODAY = '2026-11-06';
const NOW = new Date(2026, 10, 6, 9, 0, 0).getTime();

let counter = 0;
function item(day: string, extra: Partial<TodoItem> = {}): TodoItem {
  counter += 1;
  return { id: `i${String(counter).padStart(3, '0')}`, text: `t${counter}`, day, done: false, doneAtMs: null, createdAtMs: counter, ...extra };
}
const ids = (group: TodoGroup | undefined) => (group?.items ?? []).map(x => x.id);
const kinds = (groups: TodoGroup[]) => groups.map(g => (g.kind === 'day' ? `day:${g.day}` : g.kind));

describe('groupTodos', () => {
  it('draws nothing for no items', () => {
    expect(groupTodos([], TODAY, NOW)).toEqual([]);
  });

  it('puts yesterday in overdue, today in today, today+7 in its own day, today+8 in later', () => {
    const yesterday = item('2026-11-05');
    const today = item('2026-11-06');
    const seventh = item('2026-11-13');
    const eighth = item('2026-11-14');
    const groups = groupTodos([eighth, seventh, today, yesterday], TODAY, NOW);
    expect(kinds(groups)).toEqual(['overdue', 'day:2026-11-06', 'day:2026-11-13', 'later']);
    expect(ids(groups[0])).toEqual([yesterday.id]);
    expect(ids(groups[3])).toEqual([eighth.id]);
  });

  it('gives each of the next days its own group with its offset, empty days left out', () => {
    const groups = groupTodos([item('2026-11-08'), item('2026-11-07')], TODAY, NOW);
    expect(groups.map(g => (g.kind === 'day' ? g.offset : -1))).toEqual([1, 2]);
  });

  it('keeps a ticked item on today and on a future day, with the unticked ones', () => {
    const a = item(TODAY, { done: true, doneAtMs: NOW - 1000 });
    const b = item(TODAY);
    const c = item('2026-11-09', { done: true, doneAtMs: NOW });
    const groups = groupTodos([b, a, c], TODAY, NOW);
    expect(kinds(groups)).toEqual(['day:2026-11-06', 'day:2026-11-09']);
    expect(ids(groups[0])).toEqual([a.id, b.id]);
  });

  it('moves a ticked item of a past day to done, never to overdue', () => {
    const open = item('2026-11-01');
    const ticked = item('2026-11-02', { done: true, doneAtMs: NOW - DAY_MS });
    const groups = groupTodos([open, ticked], TODAY, NOW);
    expect(kinds(groups)).toEqual(['overdue', 'done']);
    expect(ids(groups[1])).toEqual([ticked.id]);
  });

  it('keeps a ticked item in later when its day is far ahead', () => {
    const far = item('2026-12-01', { done: true, doneAtMs: NOW });
    expect(kinds(groupTodos([far], TODAY, NOW))).toEqual(['later']);
  });

  it('orders overdue by day, oldest first, then by creation', () => {
    const newer = item('2026-11-04');
    const olderLate = item('2026-11-01', { createdAtMs: 900 });
    const olderEarly = item('2026-11-01', { createdAtMs: 100 });
    expect(ids(groupTodos([newer, olderLate, olderEarly], TODAY, NOW)[0])).toEqual([olderEarly.id, olderLate.id, newer.id]);
  });

  it('orders later by day', () => {
    const b = item('2026-12-24');
    const a = item('2026-11-20');
    expect(ids(groupTodos([b, a], TODAY, NOW)[0])).toEqual([a.id, b.id]);
  });

  it('orders done by the newest tick first', () => {
    const old = item('2026-10-20', { done: true, doneAtMs: NOW - 5 * DAY_MS });
    const fresh = item('2026-10-25', { done: true, doneAtMs: NOW - DAY_MS });
    const mid = item('2026-10-22', { done: true, doneAtMs: NOW - 2 * DAY_MS });
    expect(ids(groupTodos([old, fresh, mid], TODAY, NOW)[0])).toEqual([fresh.id, mid.id, old.id]);
  });

  it('within a day sorts by creation, an unknown creation last, then by id', () => {
    const unknown = item(TODAY, { createdAtMs: null, id: 'a-unknown' });
    const second = item(TODAY, { createdAtMs: 20 });
    const first = item(TODAY, { createdAtMs: 10 });
    const tieB = item(TODAY, { createdAtMs: 30, id: 'tie-b' });
    const tieA = item(TODAY, { createdAtMs: 30, id: 'tie-a' });
    expect(ids(groupTodos([unknown, tieB, second, tieA, first], TODAY, NOW)[0]))
      .toEqual([first.id, second.id, 'tie-a', 'tie-b', 'a-unknown']);
  });

  it('shows a tick of 29 and of exactly 30 days ago and hides one of 31', () => {
    const at29 = item('2026-10-08', { done: true, doneAtMs: NOW - 29 * DAY_MS });
    const at30 = item('2026-10-07', { done: true, doneAtMs: NOW - 30 * DAY_MS });
    const at31 = item('2026-10-06', { done: true, doneAtMs: NOW - 31 * DAY_MS });
    const shown = ids(groupTodos([at29, at30, at31], TODAY, NOW)[0]);
    expect(shown).toEqual([at29.id, at30.id]);
  });

  it('hides an old tick wherever the day of the item is', () => {
    const futureOld = item('2026-11-07', { done: true, doneAtMs: NOW - 40 * DAY_MS });
    expect(groupTodos([futureOld], TODAY, NOW)).toEqual([]);
  });

  it('never hides an unticked item, however old', () => {
    const ancient = item('2025-01-01');
    expect(ids(groupTodos([ancient], TODAY, NOW)[0])).toEqual([ancient.id]);
  });

  it('counts a ticked item with no tick time as ticked now: shown, and first in done', () => {
    const unknown = item('2026-11-01', { done: true, doneAtMs: null });
    const known = item('2026-11-02', { done: true, doneAtMs: NOW - DAY_MS });
    const groups = groupTodos([known, unknown], TODAY, NOW);
    expect(ids(groups[0])).toEqual([unknown.id, known.id]);
  });

  it('counts calendar days across the weekend the clocks go back (25 October 2026)', () => {
    // Whatever the machine's zone, the week from Saturday 24 October is the same seven calendar days:
    // 31 October is the seventh and 1 November already folds under «later».
    const groups = groupTodos(
      [item('2026-10-25'), item('2026-10-26'), item('2026-10-31'), item('2026-11-01'), item('2026-11-02')],
      '2026-10-24',
      new Date(2026, 9, 24, 9, 0, 0).getTime(),
    );
    expect(kinds(groups)).toEqual(['day:2026-10-25', 'day:2026-10-26', 'day:2026-10-31', 'later']);
    expect(groups.map(g => (g.kind === 'day' ? g.offset : -1))).toEqual([1, 2, 7, -1]);
    expect(groups[3]?.items).toHaveLength(2);
  });

  it('counts calendar days across the weekend the clocks go forward (29 March 2026)', () => {
    const groups = groupTodos(
      [item('2026-03-28'), item('2026-03-29'), item('2026-03-30'), item('2026-04-04'), item('2026-04-05')],
      '2026-03-28',
      new Date(2026, 2, 28, 9, 0, 0).getTime(),
    );
    expect(kinds(groups)).toEqual([
      'day:2026-03-28', 'day:2026-03-29', 'day:2026-03-30', 'day:2026-04-04', 'later',
    ]);
  });
});
