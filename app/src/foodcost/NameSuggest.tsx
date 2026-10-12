import { useId, useState } from 'react';
import type { Ref } from 'react';
import { suggestLinks } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import type { StoredDoc } from './foodcostSource';
import styles from './NameSuggest.module.css';

type Props = {
  id: string;
  value: string;
  invalid: boolean;
  // Only while «Made of» is empty: renaming a product already made of something must not keep
  // offering to rebuild it.
  enabled: boolean;
  recipes: Readonly<Record<string, StoredDoc>>;
  inputRef: Ref<HTMLInputElement>;
  onChange: (text: string) => void;
  // A recipe was tapped.
  onPick: (recipeId: string) => void;
  // «See all»: the full chooser, already searching what was typed.
  onSeeAll: (typed: string) => void;
};

type Entry = { kind: 'recipe'; id: string; name: string } | { kind: 'all'; total: number };

// The product's name box and, under it while it is typed, the recipes it matches (his idea, 13 Sep
// 2026: «when I type the name and it matches a recipe in the recipe book, show me a suggestion for a
// quick pick»). A tap names the product after the recipe and puts the recipe first in «Made of».
//
// ⚠️ IT NEVER CHOOSES BY ITSELF: nothing is picked without a tap, or Enter on a row highlighted with
// the arrows. Leaving the box, Escape, or no match just closes it.
// ⚠️ IN THE PAGE'S FLOW, NOT FLOATING: a floating list would have to be placed against a phone
// keyboard that changes the visible area as it opens.
// ⚠️ A TAP ON IT MUST NOT CLOSE IT FIRST: touching the list would move the focus off the box before
// the click lands, the blur would close the list, and the tap would land on nothing — so the list
// swallows the pointer going down, which keeps the focus (and the keyboard) where it is.
export function NameSuggest({ id, value, invalid, enabled, recipes, inputRef, onChange, onPick, onSeeAll }: Props) {
  const { t } = useT();
  const ids = useId();
  const listId = `${ids}-list`;
  // Opened by typing, closed by leaving the box, Escape or a pick.
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const found = enabled && open ? suggestLinks({ ingredients: {}, recipes, query: value }) : { items: [], total: 0 };
  const entries: Entry[] = found.items.map(item => ({ kind: 'recipe', id: String(item.refId), name: item.name }));
  if (found.total > found.items.length) entries.push({ kind: 'all', total: found.total });
  const shown = entries.length > 0;
  const activeEntry = active >= 0 && active < entries.length ? active : -1;

  const choose = (entry: Entry) => {
    setOpen(false);
    setActive(-1);
    if (entry.kind === 'all') onSeeAll(value);
    else onPick(entry.id);
  };

  return (
    <div className={styles.suggest}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        autoComplete="off"
        className={styles.input}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={shown}
        aria-controls={listId}
        aria-activedescendant={activeEntry >= 0 ? `${ids}-${activeEntry}` : undefined}
        aria-invalid={invalid ? true : undefined}
        placeholder={t('fc.productName')}
        value={value}
        data-invalid={invalid}
        onChange={event => {
          setOpen(true);
          setActive(-1);
          onChange(event.target.value);
        }}
        onBlur={() => { setOpen(false); setActive(-1); }}
        onKeyDown={event => {
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
            setOpen(false);
            setActive(-1);
          }
        }}
      />
      <div
        id={listId}
        role="listbox"
        aria-label={t('fc.suggest.label')}
        hidden={!shown}
        onPointerDown={event => { event.preventDefault(); }}
        onMouseDown={event => { event.preventDefault(); }}
      >
        {entries.map((entry, index) => (
          <div
            key={entry.kind === 'all' ? 'all' : entry.id}
            id={`${ids}-${index}`}
            role="option"
            aria-selected={index === activeEntry}
            className={styles.row}
            data-active={index === activeEntry}
            data-all={entry.kind === 'all'}
            onClick={() => { choose(entry); }}
          >
            {entry.kind === 'all' ? t('cat.suggest.seeAll', { n: entry.total }) : entry.name}
          </div>
        ))}
      </div>
    </div>
  );
}
