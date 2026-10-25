import { useId, useState } from 'react';
import type { InputHTMLAttributes, KeyboardEvent, ReactNode } from 'react';
import { Check } from 'lucide-react';
import { nameTaken, suggestLinks } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import type { Chosen } from './editorModel';
import { LINK_SEPARATOR } from './linkModel';
import type { StoredDoc } from './recipesSource';
import styles from './LinkSuggest.module.css';

type Options = {
  // What is typed in the row's name box.
  value: string;
  ingredients: Readonly<Record<string, StoredDoc>>;
  recipes: readonly CatalogueRecipe[];
  suppliers: Readonly<Record<string, StoredDoc>>;
  // This recipe's own id (null for a new one): a recipe is never offered to itself.
  excludeRecipeId: string | null;
  // The row's current link, ticked in the list.
  linked: { kind: string; refId: string } | null;
  // A suggestion was tapped (or chosen with Enter).
  onPick: (chosen: Chosen) => void;
  // «See all»: the full chooser, already searching what was typed.
  onSeeAll: (typed: string) => void;
  // «+ Add "…" as an ingredient» is offered (the person may add records), and what a tap on it does.
  mayCreate: boolean;
  onCreate: (name: string) => void;
};

type Entry =
  | { kind: 'item'; id: string; chosen: Chosen; name: string; meta: string; linked: boolean; inactive: boolean }
  | { kind: 'all'; id: 'all'; total: number }
  | { kind: 'create'; id: 'create'; name: string };

// The small list that appears under a recipe row's name while it is typed, so the row can be linked to an ingredient (or a
// recipe) with one tap (his idea, 13 Sep 2026). The matching is suggestLinks (tested where it lives); this draws it.
// A hook, not a component: the combobox attributes belong on the name box, which the row draws, and the list goes under the
// row's line — two places, one state.
//
// ⚠️ IT NEVER CHOOSES BY ITSELF: nothing is picked without a tap, or Enter on a row highlighted with the arrows. Leaving the
// box, Escape, or no match just closes it.
// ⚠️ IN THE PAGE'S FLOW, NOT FLOATING: a floating list would have to be placed against a phone keyboard that changes the
// visible area as it opens.
// ⚠️ A TAP ON IT MUST NOT CLOSE IT FIRST: touching the list would move the focus off the box before the click lands, the blur
// would close the list, and the tap would land on nothing — so the list swallows the pointer going down.
// ⚠️ READ ON EVERY RENDER, not remembered: ingredients still arriving are offered as they land.
export function useLinkSuggest({
  value, ingredients, recipes, suppliers, excludeRecipeId, linked, onPick, onSeeAll, mayCreate, onCreate,
}: Options): {
  inputProps: InputHTMLAttributes<HTMLInputElement>;
  typed: () => void;
  list: ReactNode;
} {
  const { t } = useT();
  const ids = useId();
  const listId = `${ids}-list`;
  // Opened by typing, closed by leaving the box, Escape or a pick.
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const found = open
    ? suggestLinks({ ingredients, recipes, suppliers, query: value, excludeRecipeId, linked, inactiveLast: true })
    : { items: [], total: 0 };
  const entries: Entry[] = found.items.map(item => ({
    kind: 'item',
    id: `${item.kind}:${String(item.refId)}`,
    chosen: { kind: item.kind, refId: String(item.refId), name: item.name },
    name: item.displayName,
    // ⚠️ NO PRICE: the catalogue shows no money.
    meta: item.kind === 'recipe' ? t('cat.recipe') : [item.weight, item.supplierName].filter(Boolean).join(LINK_SEPARATOR),
    linked: item.linked,
    inactive: item.inactive === true,
  }));
  if (found.total > found.items.length) entries.push({ kind: 'all', id: 'all', total: found.total });
  // ⚠️ THE LAST ROW, AFTER «See all», AND IT MAY BE THE ONLY ONE: only for a name the records do not hold (the same set the chooser
  // offers: a switched-off ingredient counts, a box does not), and only where the person may add records.
  if (open && mayCreate && value.trim() !== '' && !nameTaken(ingredients, value, { inactiveLast: true })) entries.push({ kind: 'create', id: 'create', name: value.trim() });
  const shown = entries.length > 0;
  const activeEntry = active >= 0 && active < entries.length ? active : -1;

  const close = () => { setOpen(false); setActive(-1); };
  const choose = (entry: Entry) => {
    close();
    if (entry.kind === 'create') onCreate(entry.name);
    else if (entry.kind === 'all') onSeeAll(value);
    else onPick(entry.chosen);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!shown) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((activeEntry + 1) % entries.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(activeEntry < 0 ? entries.length - 1 : (activeEntry - 1 + entries.length) % entries.length);
    } else if (event.key === 'Enter' && activeEntry >= 0) {
      event.preventDefault();
      const entry = entries[activeEntry];
      if (entry) choose(entry);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const list = (
    <div
      id={listId}
      role="listbox"
      aria-label={t('cat.suggest.label')}
      className={styles.list}
      hidden={!shown}
      onPointerDown={event => { event.preventDefault(); }}
      onMouseDown={event => { event.preventDefault(); }}
    >
      {entries.map((entry, index) => (
        <div
          key={entry.id}
          id={`${ids}-${index}`}
          role="option"
          aria-selected={index === activeEntry}
          className={styles.row}
          data-active={index === activeEntry}
          data-all={entry.kind === 'all'}
          data-create={entry.kind === 'create'}
          onClick={() => { choose(entry); }}
        >
          {entry.kind === 'create' ? t('cat.createIngredient', { name: entry.name }) : entry.kind === 'all' ? t('cat.suggest.seeAll', { n: entry.total }) : (
            <>
              <span className={styles.name}>{entry.name}</span>
              {' '}
              {entry.meta === '' ? null : <span className={styles.meta}>{entry.meta}</span>}
              {/* 3e-5b: a switched-off ingredient is offered last and says so in a word (never by colour alone). */}
              {entry.inactive ? <span className={styles.meta}>{t('ui.notInUse')}</span> : null}
              {entry.linked ? (
                <span className={styles.linked}>
                  <Check aria-hidden="true" />
                  {t('cat.suggest.linked')}
                </span>
              ) : null}
            </>
          )}
        </div>
      ))}
    </div>
  );

  return {
    inputProps: {
      autoComplete: 'off',
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': shown,
      'aria-controls': listId,
      'aria-activedescendant': activeEntry >= 0 ? `${ids}-${activeEntry}` : undefined,
      onBlur: close,
      onKeyDown,
    },
    typed: () => { setOpen(true); setActive(-1); },
    list,
  };
}
