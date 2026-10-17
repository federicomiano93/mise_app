import { beforeEach, describe, expect, it } from 'vitest';
import { workingFrom } from './editorModel';
import {
  FROM_EDITOR, cameFromEditor, forgetHandover, handOver, hasTypedCopy, peekHandover, typedCopyOf, withTypedCopy, withoutTypedCopy,
} from './photoCarry';
import { FROM_LIST } from './recipesNav';

// What travels between the new-recipe editor and the photo screen (step 3d-9).

beforeEach(() => { forgetHandover(); });

describe('the typed copy on a history entry', () => {
  const typed = { ...workingFrom(null), name: 'Pane' };

  it('goes on the entry, keeping what the entry already said, and the page leaves the focus alone', () => {
    const state = withTypedCopy(FROM_LIST, typed);
    expect(state).toMatchObject({ keepFocus: true, fromList: true });
    expect(hasTypedCopy(state)).toBe(true);
    expect(typedCopyOf(state)?.name).toBe('Pane');
  });

  it('an entry with no state at all still keeps the focus where it is', () => {
    expect(withTypedCopy(null, typed)).toMatchObject({ keepFocus: true });
    expect(withTypedCopy(undefined, typed)).toMatchObject({ keepFocus: true });
  });

  it('comes off whole, leaving everything else', () => {
    const off = withoutTypedCopy(withTypedCopy(FROM_LIST, typed));
    expect(hasTypedCopy(off)).toBe(false);
    expect(typedCopyOf(off)).toBeNull();
    expect(off).toMatchObject({ keepFocus: true, fromList: true });
  });

  it('is nothing when the state is not ours', () => {
    for (const state of [null, undefined, 5, 'x', {}, { typedCopy: 5 }, { typedCopy: { name: 5 } }]) {
      expect(typedCopyOf(state)).toBeNull();
    }
    expect(hasTypedCopy(null)).toBe(false);
  });

  it('survives being written to a history entry and read back', () => {
    const back = typedCopyOf(JSON.parse(JSON.stringify(withTypedCopy(FROM_LIST, typed))));
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
    expect(peekHandover()).toBeNull();
    handOver(draft);
    expect(peekHandover()).toBe(draft);
    expect(peekHandover()).toBe(draft);
    forgetHandover();
    expect(peekHandover()).toBeNull();
  });
});
