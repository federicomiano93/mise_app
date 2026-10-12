import type { Ref } from 'react';
import styles from './NumberBox.module.css';

type Props = {
  id: string;
  // The name a screen reader reads (and the words «Check “…”» uses when the number is refused).
  label: string;
  value: string;
  placeholder?: string;
  invalid: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onChange: (text: string) => void;
};

// A number typed into a plain text box, with the decimal keyboard.
//
// ⚠️ A COMMA TYPED IS A DECIMAL POINT: an Italian keyboard offers one, and a number box returns ''
// for «12,5» in some browsers, which would read as «empty». The text is kept as typed («12.» is a
// number half-typed); productEditorModel's readNumber turns it into a number.
export function NumberBox({ id, label, value, placeholder = '0', invalid, inputRef, onChange }: Props) {
  return (
    <input
      ref={inputRef}
      id={id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={styles.box}
      placeholder={placeholder}
      aria-label={label}
      aria-invalid={invalid ? true : undefined}
      data-invalid={invalid}
      value={value}
      onChange={event => { onChange(event.target.value); }}
    />
  );
}
