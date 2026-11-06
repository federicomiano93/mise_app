import { useCallback } from 'react';
import type { ReactNode, Ref } from 'react';
import { ArrowLeftRight, History, Search, Settings, Share } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { HISTORY_DOOR, SEND_OPENER, SETTINGS_OPENER, SWAP_OPENER, useHandBack } from './handBack';
import styles from './OrdersHead.module.css';

type Props = {
  // The view this head is on: the swap button names the OTHER one.
  view: 'suppliers' | 'ingredients';
  // The search box's own words (its label and its placeholder).
  label: string;
  query: string;
  onQuery: (text: string) => void;
  // The search box took the focus or its text changed (the supplier list: a supplier held for the live data is no longer wanted).
  onLookingElsewhere?: () => void;
  // Suppliers, ingredients and the draft have all arrived, and there is at least one supplier: only then the send arrow and the swap
  // button are drawn.
  ready: boolean;
  hasSuppliers: boolean;
  onSwap: () => void;
  onSend: () => void;
  onSettings: () => void;
  onHistory: () => void;
  // The head's own box, for a view that measures it (the flat view's sticky letters).
  headRef?: Ref<HTMLDivElement>;
  // Under the search row: the All / Ordering filter.
  children?: ReactNode;
};

// The head of «Orders»: the search box, the send arrow and the tools (swap, History, gear), over the supplier list AND over the
// flat view. It sticks to the top of the scroll area while the rows scroll.
//
// ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: it is a controlled input in a component that stays mounted, and
// only the rows below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard where the person
// left them (the current app built the box once for the same reason). Its text lives in the view that owns the rows.
export function OrdersHead({ view, label, query, onQuery, onLookingElsewhere, ready, hasSuppliers, onSwap, onSend, onSettings, onHistory, headRef, children }: Props) {
  const { t } = useT();
  const handBack = useHandBack();
  // Back from a screen hands the focus back to the button that opened it; the swap button gets it after the view changed.
  const sendNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SEND_OPENER, node); }, [handBack]);
  const swapNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SWAP_OPENER, node); }, [handBack]);
  const settingsNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);
  const historyNode = useCallback((node: HTMLButtonElement | null) => { handBack.register(HISTORY_DOOR, node); }, [handBack]);
  // The word names the view the button goes TO.
  const swapText = view === 'suppliers' ? t('ord.view.ingredients') : t('ord.view.suppliers');

  return (
    <div ref={headRef} className={styles.head}>
      <div className={styles.top}>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
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
        {/* ⚠️ AN ARROW OUT OF A TRAY, NOT A WHATSAPP MARK: the screen it opens offers several roads. Here only once the list
            is ready and has suppliers, so it never offers to send what has not arrived. */}
        {ready && hasSuppliers ? (
          <Button ref={sendNode} className={styles.send} onPress={onSend}>
            <Share aria-hidden="true" />
            {t('ord.send.action')}
          </Button>
        ) : null}
        {/* ⚠️ ITS PLACE IS KEPT WHILE IT WAITS: arriving with the live data it would push the block below onto a new row, and every
            supplier 56px down just as a finger lands on one (the rule at OrdersSection's hold). */}
        {ready ? null : <span aria-hidden="true" className={styles.sendPlace} />}
        {/* ⚠️ ONE BLOCK, SO THEY WRAP TOGETHER: loose, on the tablet's list column the gear fell alone onto a row of its own and the
            search box shrank to «Cerca u». */}
        <div className={styles.tools}>
          {/* The other view, by its name: the same place on both views, so the finger that swapped can swap back. Its place is
              kept while the lists wait, like the send arrow's (the block would widen when it arrives). */}
          {ready ? (hasSuppliers ? (
            <Button ref={swapNode} className={styles.swap} onPress={onSwap}>
              <ArrowLeftRight aria-hidden="true" />
              {swapText}
            </Button>
          ) : null) : <span aria-hidden="true" className={styles.swapPlace} />}
          {/* ⚠️ WITH ITS WORD, NOT AN ICON ALONE, AND OUT OF THE SETTINGS (Federico, 3 Nov 2026): inside them he could not find it.
              Always there, even with no supplier yet: past orders outlive the suppliers they went to. */}
          <Button ref={historyNode} className={styles.history} onPress={onHistory}>
            <History aria-hidden="true" />
            {t('ord.history.title')}
          </Button>
          {/* Always there, even with no supplier yet: the settings are not about the suppliers. */}
          <Button ref={settingsNode} className={styles.gear} aria-label={t('ord.settings.open')} onPress={onSettings}>
            <Settings aria-hidden="true" />
          </Button>
        </div>
      </div>
      {children}
    </div>
  );
}
