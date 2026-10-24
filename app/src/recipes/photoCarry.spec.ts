import { beforeEach, describe, expect, it } from 'vitest';
import { workingFrom } from './editorModel';
import {
  FROM_EDITOR, HANDOVER_TTL_MS, cameFromEditor, carryOwner, forgetHandover, handOver, hasHandover, hasTypedCopy, peekHandover, typedCopyOf,
  withTypedCopy, withoutTypedCopy,
} from './photoCarry';
import { FROM_LIST } from './recipesNav';

// What travels between the new-recipe editor and the photo screen (step 3d-9).

beforeEach(() => { forgetHandover(); });

const ME = carryOwner('alice', 'bakery');

describe('the typed copy on a history entry', () => {
  const typed = { ...workingFrom(null), name: 'Pane' };

  it('goes on the entry, keeping what the entry already said, and the page leaves the focus alone', () => {
    const state = withTypedCopy(FROM_LIST, typed, ME);
    expect(state).toMatchObject({ keepFocus: true, fromList: true });
    expect(hasTypedCopy(state)).toBe(true);
    expect(typedCopyOf(state, ME)?.name).toBe('Pane');
  });

  it('an entry with no state at all still keeps the focus where it is', () => {
    expect(withTypedCopy(null, typed, ME)).toMatchObject({ keepFocus: true });
    expect(withTypedCopy(undefined, typed, ME)).toMatchObject({ keepFocus: true });
  });

  it('comes off whole, leaving everything else', () => {
    const off = withoutTypedCopy(withTypedCopy(FROM_LIST, typed, ME));
    expect(hasTypedCopy(off)).toBe(false);
    expect(typedCopyOf(off, ME)).toBeNull();
    expect(off).toMatchObject({ keepFocus: true, fromList: true });
  });

  it('is nothing when the state is not ours', () => {
    for (const state of [null, undefined, 5, 'x', {}, { typedCopy: 5 }, { typedCopy: { name: 5 } }]) {
      expect(typedCopyOf(state, ME)).toBeNull();
    }
    expect(hasTypedCopy(null)).toBe(false);
  });

  it('survives being written to a history entry and read back', () => {
    const back = typedCopyOf(JSON.parse(JSON.stringify(withTypedCopy(FROM_LIST, typed, ME))), ME);
    expect(back?.name).toBe('Pane');
  });
});

describe('the photo screen’s entry', () => {
  it('says it was opened from the editor', () => {
    expect(cameFromEditor(FROM_EDITOR)).toBe(true);
    expect(FROM_EDITOR).toMatchObject({ keepFocus: true });
    expect(cameFromEditor(FROM_LIST)).toBe(false);
    expect(cameFromEditor(null)).toBe(false);
  });
});

describe('the read draft', () => {
  it('is looked at without being taken (a render run twice is harmless) and forgotten once taken', () => {
    const draft = workingFrom(null);
    expect(peekHandover(ME, 1000)).toBeNull();
    handOver(draft, ME, 1000);
    expect(peekHandover(ME, 1000)).toBe(draft);
    expect(peekHandover(ME, 1000)).toBe(draft);
    forgetHandover();
    expect(peekHandover(ME, 1000)).toBeNull();
    expect(hasHandover()).toBe(false);
  });

  it('⚠️ is only for the person and the venue it was read for, and only for a short while', () => {
    const draft = workingFrom(null);
    handOver(draft, ME, 1000);
    expect(peekHandover(carryOwner('bob', 'bakery'), 1000)).toBeNull();
    expect(peekHandover(carryOwner('alice', 'other'), 1000)).toBeNull();
    expect(peekHandover(ME, 1000 + HANDOVER_TTL_MS)).toBe(draft);
    expect(peekHandover(ME, 1001 + HANDOVER_TTL_MS)).toBeNull();
    expect(peekHandover(ME, 999)).toBeNull();
  });
});

describe('⚠️ the typed copy after a sign-out or a venue switch (the history keeps entry state across a reload)', () => {
  it('is not there for another person or another venue', () => {
    const state = withTypedCopy(FROM_LIST, { ...workingFrom(null), name: 'Pane' }, ME);
    expect(typedCopyOf(state, carryOwner('alice', 'other'))).toBeNull();
    expect(typedCopyOf(state, carryOwner('bob', 'bakery'))).toBeNull();
    expect(typedCopyOf(state, ME)?.name).toBe('Pane');
    expect(hasTypedCopy(withoutTypedCopy(state))).toBe(false);
    expect('typedFor' in withoutTypedCopy(state)).toBe(false);
  });
});
