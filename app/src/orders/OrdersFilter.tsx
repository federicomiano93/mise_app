import { useRef } from 'react';
import type { KeyboardEvent } from 'react';
import styles from './OrdersFilter.module.css';

// «All (N) / Ordering (N)»: a radio group (it filters ONE list), shared by the supplier list and the flat view. The roving
// pattern: the chosen one is the only tab stop, the arrows move the choice and the focus with it.
export function OrdersFilter({ label, ordering, allText, orderingText, onChoose }: {
  label: string;
  // Whether «Ordering» is the chosen one.
  ordering: boolean;
  allText: string;
  orderingText: string;
  onChoose: (ordering: boolean) => void;
}) {
  const radios = useRef(new Map<boolean, HTMLButtonElement>());
  function choose(only: boolean) {
    onChoose(only);
    radios.current.get(only)?.focus();
  }
  function onKey(event: KeyboardEvent<HTMLButtonElement>, only: boolean) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      choose(!only);
    }
  }
  return (
    <div role="radiogroup" aria-label={label} className={styles.filter}>
      {([false, true] as const).map(only => (
        <button
          key={String(only)}
          ref={node => {
            if (node) radios.current.set(only, node);
            else radios.current.delete(only);
          }}
          type="button"
          role="radio"
          aria-checked={ordering === only}
          tabIndex={ordering === only ? 0 : -1}
          className={styles.radio}
          onClick={() => { onChoose(only); }}
          onKeyDown={event => { onKey(event, only); }}
        >
          {only ? orderingText : allText}
        </button>
      ))}
    </div>
  );
}
