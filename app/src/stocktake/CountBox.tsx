import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useStocktakeStore } from './StocktakeContext';
import { boxText } from './stocktakeFormat';
import styles from './CountBox.module.css';

type Props = {
  // The product the box counts, and what the box is called for a screen reader.
  id: string;
  label: string;
  // What the month holds for it: null when nobody has counted it.
  value: number | null;
  // Closed month, or the month has not answered yet: nothing can be typed.
  disabled: boolean;
  // The list keeps the boxes by product, to move the focus on from one to the next.
  register: (id: string, node: HTMLInputElement | null) => void;
  onEnter: () => void;
};

// What a person has typed into a box they are in: the text it started with and the text now.
type Edit = { readonly start: string; readonly draft: string };

// The box a count is typed into, on the row.
//
// ⚠️ A BOX BEING TYPED INTO HOLDS ITS OWN TEXT AND IS NEVER WRITTEN INTO FROM THE STORE. The month
// arrives live from the other phones, and a snapshot that rewrote the box would move the caret and
// eat «3,» on its way to «3,5». While the box has the focus it shows its draft; the store's number
// is shown only otherwise.
//
// ⚠️ IT IS A TEXT BOX WITH THE DECIMAL KEYBOARD, NEVER type="number": a numeric field refuses the
// comma an Italian keyboard produces, and its spinner arrows eat the width the number needs.
//
// ⚠️ AND IT NEVER SHOWS A THOUSANDS SEPARATOR, after an update from another phone too (boxText).
//
// The count is committed when the text CHANGED, on leaving the box or on Enter (which also moves
// on to the next row's box). Compared with the text the box started with, not with the store's
// number now: a colleague's count that arrived while the box was open is not overwritten by a
// number nobody typed.
export function CountBox({ id, label, value, disabled, register, onEnter }: Props) {
  const { locale } = useT();
  const store = useStocktakeStore();
  const stored = boxText(value, locale);

  const [edit, setEditState] = useState<Edit | null>(null);
  // The same edit, readable by an event that fires before the next render: Enter commits and moves
  // the focus in one go, and the blur it causes must see the commit already made.
  const live = useRef<Edit | null>(null);
  const setEdit = (next: Edit | null) => {
    live.current = next;
    setEditState(next);
  };

  // A box that shut under somebody's fingers (the month was closed on another phone) shows the
  // month's number again, whatever was half-typed — and forgets it, so that it does not come back
  // if the month is reopened. Browsers do not always blur a box that becomes disabled, so `edit`
  // can outlive the focus.
  const editing = edit !== null && !disabled;
  const dirty = editing && edit.draft !== edit.start;
  useEffect(() => {
    if (disabled && live.current !== null) {
      live.current = null;
      setEditState(null);
    }
  }, [disabled]);

  // A number typed and not yet written is an unsaved edit: a reload the app starts by itself waits
  // until it is written or dropped (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const commit = (keepEditing: boolean) => {
    const current = live.current;
    if (current === null) return;
    if (current.draft !== current.start && !disabled) store.setCount('closing', id, current.draft);
    setEdit(keepEditing ? { start: current.draft, draft: current.draft } : null);
  };

  // ⚠️ LEAVING WITH THE BOX STILL OPEN COMMITS IT. Tapping a button does not blur a box on iPhone
  // Safari, so a number typed just before a tap on the rail (or on the month's arrow) would be
  // thrown away with the screen. A layout effect, because the cleanup of a layout effect runs
  // before the section's passive one that stops the store: the number lands while the store still
  // takes it, and the stop sends it.
  useLayoutEffect(() => () => {
    const current = live.current;
    if (current !== null && current.draft !== current.start) store.setCount('closing', id, current.draft);
  }, [store, id]);

  const ref = useCallback((node: HTMLInputElement | null) => { register(id, node); }, [register, id]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      className={styles.box}
      aria-label={label}
      disabled={disabled}
      value={editing ? edit.draft : stored}
      onFocus={() => { setEdit({ start: stored, draft: stored }); }}
      onChange={event => {
        setEdit({ start: live.current?.start ?? stored, draft: event.target.value });
      }}
      onBlur={() => { commit(false); }}
      onKeyDown={event => {
        // Enter that confirms a keyboard's own suggestion is not the person saying «next».
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        commit(true);
        onEnter();
      }}
    />
  );
}
