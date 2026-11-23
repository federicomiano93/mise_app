import type { Ref } from 'react';
import styles from './NumberBox.module.css';

type Props = {
  id: string;
  // A name for a box with no visible <label htmlFor>; one that has a label is named by it, so the
  // name a screen reader reads is the words on the screen.
  label?: string;
  value: string;
  placeholder?: string;
  invalid: boolean;
  // A limit on what can be typed, where a copy of the text is kept on the device and refused past it (cakes/cakeParking.ts).
  maxLength?: number;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (text: string) => void;
};

// A number typed into a plain text box, with the decimal keyboard.
//
// ⚠️ A COMMA TYPED IS A DECIMAL POINT: an Italian keyboard offers one, and a number box returns ''
// for «12,5» in some browsers, which would read as «empty». The text is kept as typed («12.» is a
// number half-typed); productEditorModel's readNumber turns it into a number.
export function NumberBox({ id, label, value, placeholder = '0', invalid, maxLength, inputRef, onChange }: Props) {
  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={styles.box}
      placeholder={placeholder}
      {...(maxLength === undefined ? {} : { maxLength })}
      {...(label === undefined ? {} : { 'aria-label': label })}
      aria-invalid={invalid ? true : undefined}
      data-invalid={invalid}
      value={value}
      onChange={event => { onChange(event.target.value); }}
    />
  );
}
