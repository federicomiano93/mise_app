import { describe, expect, it } from 'vitest';
import { recordDateFor, rawDayFor } from './orderDay';

const TODAY = '2026-10-28';
const draft = (days: Record<string, string>, updatedAt = '') => ({ days, updatedAt });

describe('rawDayFor', () => {
  it('is the stored stamp, even a day that has not come yet', () => {
    expect(rawDayFor(draft({ a: '2026-10-31' }), 'a', TODAY)).toBe('2026-10-31');
    expect(rawDayFor(draft({ a: '2026-10-20' }), 'a', TODAY)).toBe('2026-10-20');
  });

  it('falls back to the local day the draft was last written on, then to today', () => {
    const written = new Date(2026, 9, 25, 12, 0, 0).toISOString();
    expect(rawDayFor(draft({}, written), 'a', TODAY)).toBe('2026-10-25');
    expect(rawDayFor(draft({}), 'a', TODAY)).toBe(TODAY);
    expect(rawDayFor(draft({}, 'not a date'), 'a', TODAY)).toBe(TODAY);
  });

  it('reads each supplier’s own stamp', () => {
    expect(rawDayFor(draft({ a: '2026-10-31' }), 'b', TODAY)).toBe(TODAY);
  });
});

describe('recordDateFor', () => {
  it('files a future stamp under today (decision F3) and leaves a past or current one alone', () => {
    expect(recordDateFor(draft({ a: '2026-10-31' }), 'a', TODAY)).toBe(TODAY);
    expect(recordDateFor(draft({ a: '2026-10-27' }), 'a', TODAY)).toBe('2026-10-27');
    expect(recordDateFor(draft({ a: TODAY }), 'a', TODAY)).toBe(TODAY);
    expect(recordDateFor(draft({}), 'a', TODAY)).toBe(TODAY);
  });
});
