import { useCallback } from 'react';
import type { ReactNode, Ref } from 'react';
import { Search } from 'lucide-react';
import { useT } from '../i18n/useT';
import { SEARCH_BOX, SWAP_OPENER, useHandBack } from './handBack';
import styles from './OrdersHead.module.css';

type Props = {
  // The view this head is on: its tab is the current one.
  view: 'suppliers' | 'ingredients';
  // The search box's own words (its label and its placeholder).
  label: string;
  query: string;
  onQuery: (text: string) => void;
  // The search box took the focus or its text changed (the supplier list: a supplier held for the live data is no longer wanted).
  onLookingElsewhere?: () => void;
  // Suppliers, ingredients and the draft have all arrived, and there is at least one supplier: only then the tabs answer a press.
  ready: boolean;
  hasSuppliers: boolean;
  onSwap: () => void;
  // The sticky part's own box, for a view that measures it (the flat view's sticky column names and letters).
  headRef?: Ref<HTMLDivElement>;
  // Under the search box: the flat view's All / Ordering filter.
  children?: ReactNode;
};

// The top-left of «Orders» (the redesign of 16 Nov 2026, item 4), over the supplier list AND over the flat view: the two tabs
// «Suppliers» / «Ingredients», then the search box. The tabs scroll away; the search box sticks under the title band while the rows
// scroll. Two siblings in the caller's tall column, not one wrapper: a sticky box sticks only inside its parent.
//
// ⚠️ ROWS OF FIXED HEIGHT (a 48px tab row, then the search box with its padding): on the split the line under this part must meet the
// line under the In arrivo / Da riordinare cell on the right, which is built from the same two rows (OrdersSection.module.css).
//
// ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: it is a controlled input in a component that stays mounted, and only the
// rows below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard where the person left them (the
// current app built the box once for the same reason). Its text lives in the view that owns the rows.
export function OrdersHead({ view, label, query, onQuery, onLookingElsewhere, ready, hasSuppliers, onSwap, headRef, children }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  // Where the focus falls back to when the door it was returned to is gone (cardTrip.ts).
  const searchNode = useCallback((node: HTMLInputElement | null) => { handBack.register(SEARCH_BOX, node); }, [handBack]);
  // ⚠️ THE FOCUS AFTER A SWAP GOES TO THE TAB OF THE VIEW THAT ARRIVED (SWAP_OPENER): the current tab, the one just pressed.
  const currentNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SWAP_OPENER, node); }, [handBack]);
  const live = ready && hasSuppliers;

  const tab = (which: 'suppliers' | 'ingredients', words: string) => {
    const current = which === view;
    return (
      <button
        ref={current ? currentNode : undefined}
        type="button"
        className={styles.tab}
        aria-pressed={current}
        // Before the lists are live (or with no supplier at all) the other view has nothing to show: the tab stays, so nothing moves
        // when the data lands, but it answers nothing.
        aria-disabled={!current && !live ? true : undefined}
        onClick={() => { if (!current && live) onSwap(); }}
      >
        {words}
      </button>
    );
  };

  return (
    <>
      <div className={styles.tabs} role="group" aria-label={t('ord.view.label')}>
        {tab('suppliers', t('ord.view.suppliers'))}
        {tab('ingredients', t('ord.view.ingredients'))}
      </div>
      <div ref={headRef} className={styles.head}>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
            ref={searchNode}
            type="search"
            autoComplete="off"
            className={styles.input}
            aria-label={label}
            placeholder={label}
            value={query}
            // ⚠️ onFocus AND onChange, NOT document.activeElement when the supplier finally opens: on WebKit a tap does not
            // take the focus off the search box, so a person who typed and THEN tapped a row must still get that supplier.
            onFocus={onLookingElsewhere}
            onChange={event => {
              onLookingElsewhere?.();
              onQuery(event.target.value);
            }}
          />
        </div>
        {children}
      </div>
    </>
  );
}
