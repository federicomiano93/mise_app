import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { Recipe } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import styles from './RecipeTabs.module.css';

type Props = {
  // The recipes shown as tabs, in order.
  recipes: readonly Recipe[];
  active: string;
  onPick: (id: string) => void;
  // The ids of the tabs and of the panel the selected one controls.
  tabId: (id: string) => string;
  panelId: string;
};

// Where an arrow, Home or End key sends the selection.
function targetOf(key: string, index: number, last: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return index === last ? 0 : index + 1;
    case 'ArrowLeft':
    case 'ArrowUp':
      return index === 0 ? last : index - 1;
    case 'Home':
      return 0;
    case 'End':
      return last;
    default:
      return null;
  }
}

// The strip above the recipe. TWO OR MORE recipes → one tab each. ONE recipe → its name as a plain title:
// a lone tab is a button that switches to the screen you are already on, and its look says «tap me» about a
// name (the current app, 4 Oct 2026). The title takes no focus and no tap.
//
// ⚠️ A TAB'S NAME IS THE WORDS DRAWN ON IT, never an aria-label that differs from them (axe
// `label-content-name-mismatch`): a recipe's name is what is written, so it is the name.
//
// It is a tab list: only the selected tab is in the Tab order, the arrows move the selection AND the focus.
// ⚠️ PICKING A TAB DOES NOT PULL THE FOCUS INTO THE PANEL: it belongs on the tab that was pressed, or there
// would be nothing for the next arrow key to move from.
export function RecipeTabs({ recipes, active, onPick, tabId, panelId }: Props) {
  const { t } = useT();
  const tabs = useRef(new Map<string, HTMLButtonElement>());

  // A phone's strip scrolls sideways when four long names do not fit: the chosen one must not wait off the
  // edge. jsdom has no scrollIntoView.
  useEffect(() => {
    tabs.current.get(active)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const only = recipes.length === 1 ? recipes[0] : undefined;
  if (only) return <h2 className={styles.title}>{only.name}</h2>;

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = targetOf(event.key, index, recipes.length - 1);
    const recipe = target === null ? undefined : recipes[target];
    if (!recipe) return;
    event.preventDefault();
    onPick(recipe.id);
    tabs.current.get(recipe.id)?.focus();
  }

  return (
    <div role="tablist" aria-label={t('calc.tabsLabel')} className={styles.list}>
      {recipes.map((recipe, index) => {
        const selected = recipe.id === active;
        return (
          <button
            key={recipe.id}
            ref={node => {
              if (node) tabs.current.set(recipe.id, node);
              else tabs.current.delete(recipe.id);
            }}
            type="button"
            role="tab"
            id={tabId(recipe.id)}
            aria-selected={selected}
            aria-controls={selected ? panelId : undefined}
            tabIndex={selected ? 0 : -1}
            className={styles.tab}
            onClick={() => { onPick(recipe.id); }}
            onKeyDown={event => { onKeyDown(event, index); }}
          >
            {recipe.name}
          </button>
        );
      })}
    </div>
  );
}
