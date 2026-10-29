import { useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { wholeNumber } from '@mise/shared/archive';

// What the row's buttons use to read and move the box.
export interface BoxHandle {
  // The whole number the box shows now (an empty box is 0).
  read(): number;
  // Shows a number (0 = empty) without telling anybody: the caller has written it itself (a stepper, the ×).
  show(n: number): void;
  focus(): void;
}

type Props = {
  // What the draft holds for this box; 0 draws an empty box. An empty box and 0 are the same thing (parity L26).
  value: number;
  className: string | undefined;
  ariaLabel: string;
  // Every input, as a whole number, never below 0 (the store saves it after its own pause).
  onChange: (n: number) => void;
  handle?: Ref<BoxHandle>;
};

const textOf = (n: number): string => (n > 0 ? String(n) : '');

// A number box that keeps its own text.
//
// ⚠️ A BOX THAT HAS THE FOCUS IS NEVER OVERWRITTEN (parity L41, syncInputsFromState): a snapshot from another phone, or the
// echo of what is being typed, must not rewrite the digits under the finger. The box follows the draft only while it is not
// focused, and picks the draft up again the moment it loses the focus. A stepper or the × writes through `handle.show`, so
// they do not wait for a blur.
export function NumberBox({ value, className, ariaLabel, onChange, handle }: Props) {
  const shown = textOf(value);
  const [text, setText] = useState(shown);
  const [seen, setSeen] = useState(shown);
  const focused = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(text);
  if (seen !== shown) {
    setSeen(shown);
    if (!focused.current) {
      latest.current = shown;
      setText(shown);
    }
  }

  useImperativeHandle(handle, () => ({
    read: () => wholeNumber(latest.current),
    show(n) {
      latest.current = textOf(n);
      setText(latest.current);
    },
    focus() {
      input.current?.focus();
    },
  }), []);

  return (
    <input
      ref={input}
      type="number"
      min="0"
      inputMode="numeric"
      className={className}
      aria-label={ariaLabel}
      value={text}
      onFocus={() => { focused.current = true; }}
      onBlur={() => {
        focused.current = false;
        latest.current = shown;
        setText(shown);
      }}
      onChange={event => {
        latest.current = event.target.value;
        setText(event.target.value);
        onChange(wholeNumber(event.target.value));
      }}
    />
  );
}
