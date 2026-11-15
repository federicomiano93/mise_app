import { useState } from 'react';

type Props = {
  id: string;
  // What the working copy holds: a number, or '' for a box left empty (the tray weight is checked on Save).
  value: number | '';
  // Called with the text on every keystroke: the caller turns it into what it keeps.
  onText: (text: string) => void;
  inputMode: 'numeric' | 'decimal';
  min: number;
  max?: number;
  step: number;
  className?: string;
  // The name of the box when no <label> points at it.
  label?: string;
  describedBy?: string;
  invalid?: boolean;
};

// A number box of the Recipes editor that shows what was TYPED until it is left: a box that rewrote «0.» to «0» (or
// «1.50» to «1.5») under the finger would fight the person typing. Tapping it selects what is there, so a new number
// replaces the old one.
export function DecimalBox({ id, value, onText, inputMode, min, max, step, className, label, describedBy, invalid }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      className={className}
      inputMode={inputMode}
      min={min}
      max={max}
      step={step}
      aria-label={label}
      aria-describedby={describedBy}
      aria-invalid={invalid ? true : undefined}
      value={draft ?? String(value)}
      onFocus={event => { event.currentTarget.select(); }}
      onChange={event => {
        setDraft(event.target.value);
        onText(event.target.value);
      }}
      onBlur={() => { setDraft(null); }}
    />
  );
}
