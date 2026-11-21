import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

// A row of radio buttons that choose ONE thing (the cake stage's «Cut-away | Whole»), drawn with the caller's
// classes so each keeps its own look. The roving pattern of the Orders filter (orders/OrdersFilter.tsx): the chosen one is the only tab
// stop, and the arrows (all four, wrapping), Home and End move the choice and the focus with it.
export function RovingRadios<V extends string>({ label, className, optionClassName, options, value, onChoose }: {
  label: string;
  className: string | undefined;
  optionClassName: string | undefined;
  options: ReadonlyArray<{ value: V; text: string }>;
  value: V;
  onChoose: (value: V) => void;
}) {
  const nodes = useRef(new Map<V, HTMLButtonElement>());
  const choose = (next: V) => {
    onChoose(next);
    nodes.current.get(next)?.focus();
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    let target: number;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = (index - 1 + options.length) % options.length;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = (index + 1) % options.length;
    else if (event.key === 'Home') target = 0;
    else if (event.key === 'End') target = options.length - 1;
    else return;
    event.preventDefault();
    const next = options[target];
    if (next) choose(next.value);
  };
  return (
    <div role="radiogroup" aria-label={label} className={className}>
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={node => {
            if (node) nodes.current.set(option.value, node);
            else nodes.current.delete(option.value);
          }}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          tabIndex={value === option.value ? 0 : -1}
          className={optionClassName}
          onClick={() => { onChoose(option.value); }}
          onKeyDown={event => { onKey(event, index); }}
        >
          {option.text}
        </button>
      ))}
    </div>
  );
}
