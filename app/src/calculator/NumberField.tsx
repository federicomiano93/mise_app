import { useState } from 'react';
import { clearsOnFocus, isBlank } from './calculatorInput';
import styles from './Boxes.module.css';

type Props = {
  id: string;
  // What the tab keeps under this box's key.
  value: string;
  // Called with the text on every keystroke: the caller keeps it.
  onChange: (text: string) => void;
  // A box left empty (or with something that is not a number) goes back to its default: the caller keeps it.
  onBlank: () => void;
  inputMode: 'numeric' | 'decimal';
  min?: number;
  max?: number;
  step?: number | 'any';
  describedBy?: string;
  // A whole-number box: the text the maths used instead of what was typed, or null when the box already says it
  // (the trays box replaces a fraction). Applied when the box is left or Enter is pressed.
  settle?: (text: string) => string | null;
};

// A number box of the Calculator, with the behaviour of the current app's `wireNumberUX`:
//   • tapping a 0 or an empty box EMPTIES it, ready to type into; any other number is SELECTED;
//   • leaving it empty (or with text that is not a number) puts the default back and recalculates.
//
// ⚠️ WHAT IS KEPT IS NOT ALWAYS WHAT IS SHOWN WHILE THE BOX HAS THE FOCUS: a tapped 0 shows an empty box
// while the tab still keeps «0», until a digit is typed. That is the draft; without the focus the box shows
// what the tab keeps. The value is written per keystroke by the caller.
export function NumberField({ id, value, onChange, onBlank, inputMode, min, max, step, describedBy, settle }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;

  const leave = () => {
    const text = draft ?? value;
    setDraft(null);
    if (isBlank(text)) {
      onBlank();
      return;
    }
    const settled = settle?.(text) ?? null;
    if (settled !== null) onChange(settled);
  };

  return (
    <input
      id={id}
      type="number"
      className={styles.box}
      inputMode={inputMode}
      min={min}
      max={max}
      step={step}
      aria-describedby={describedBy}
      value={shown}
      onFocus={event => {
        if (clearsOnFocus(value)) setDraft('');
        else event.currentTarget.select();
      }}
      onChange={event => {
        setDraft(event.target.value);
        onChange(event.target.value);
      }}
      onBlur={leave}
      onKeyDown={event => {
        // Enter settles a whole-number box the way leaving it does (the browser's own `change`).
        if (event.key === 'Enter' && !event.nativeEvent.isComposing && settle) {
          const settled = settle(draft ?? value);
          if (settled !== null) {
            setDraft(null);
            onChange(settled);
          }
        }
      }}
    />
  );
}
