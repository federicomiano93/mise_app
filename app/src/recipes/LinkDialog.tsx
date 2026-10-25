import { useMemo, useState } from 'react';
import { linkOptions, nameTaken } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { Chosen } from './editorModel';
import { LINK_SEPARATOR } from './linkModel';
import type { StoredDoc } from './recipesSource';
import styles from './LinkDialog.module.css';

type Props = {
  ingredients: Readonly<Record<string, StoredDoc>>;
  recipes: readonly CatalogueRecipe[];
  suppliers: Readonly<Record<string, StoredDoc>>;
  excludeRecipeId: string | null;
  // Whether the row has a link: «Remove the link» is only offered then (it would do nothing otherwise).
  hasLink: boolean;
  // Opened already searching (the suggestion list's «See all»).
  initialQuery?: string;
  // ⚠️ THREE ANSWERS THAT MUST NEVER BE CONFUSED: a thing chosen, `null` = the link removed, and onClose = dismissed (Escape,
  // Back) — which changes NOTHING. «Cancel» must not silently clear a link.
  onChoose: (chosen: Chosen | null) => void;
  onClose: () => void;
  // «+ Add "…" as an ingredient» under the lists, for the name searched: offered where the person may add records.
  mayCreate: boolean;
  onCreate: (name: string) => void;
};

// The full chooser that links a recipe row to an ingredient or another recipe: a search screen, not a menu (there are too
// many ingredients for a <select> on a phone). A dialog — the focus stays inside, Escape closes, the focus goes back to the
// button that opened it — mounted only while it is open. The matching is linkOptions (tested where it lives).
//
// ⚠️ NO PRICE (13 Sep 2026): name · pack weight · supplier is what tells two similar-looking articles apart.
export function LinkDialog({ ingredients, recipes, suppliers, excludeRecipeId, hasLink, initialQuery = '', onChoose, onClose, mayCreate, onCreate }: Props) {
  const { t } = useT();
  const [query, setQuery] = useState(initialQuery);
  const options = useMemo(
    () => linkOptions({ ingredients, recipes, suppliers, query, excludeRecipeId, inactiveLast: true }),
    [ingredients, recipes, suppliers, query, excludeRecipeId],
  );
  // Same three conditions as the suggestion list's last row.
  const canCreate = mayCreate && query.trim() !== '' && !nameTaken(ingredients, query, { inactiveLast: true });
  // 3e-5b: the ingredients switched off are listed LAST, under their own heading, and chosen like any other.
  const inactive = options.inactive ?? [];
  const shown = options.ingredients.length + options.recipes.length + inactive.length;

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('cat.linkTo')}
      actions={<Button onPress={onClose}>{t('ui.back')}</Button>}
    >
      <input
        type="search"
        autoFocus
        autoComplete="off"
        className={styles.search}
        placeholder={t('cat.searchAnIngredient')}
        aria-label={t('cat.searchAnIngredient')}
        value={query}
        onChange={event => { setQuery(event.target.value); }}
      />
      <div className={styles.list}>
        {hasLink ? (
          <button type="button" className={`${styles.row} ${styles.remove}`} onClick={() => { onChoose(null); }}>
            {t('cat.removeTheLink')}
          </button>
        ) : null}
        {options.ingredients.length === 0 ? null : (
          <section className={styles.section}>
            <h3 className={styles.heading}>{t('cat.ingredients')}</h3>
            <ul className={styles.rows}>
              {options.ingredients.map(option => (
                <li key={String(option.id)}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => { onChoose({ kind: 'ingredient', refId: String(option.id), name: option.name }); }}
                  >
                    <span className={styles.name}>{option.displayName ?? option.name}</span>
                    {/* A real space between the two, for a screen reader: the visual gap is the flex gap. */}
                    {' '}
                    {/* ⚠️ NO PRICE. */}
                    <span className={styles.meta}>{[option.weight, option.supplierName].filter(Boolean).join(LINK_SEPARATOR)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {options.recipes.length === 0 ? null : (
          <section className={styles.section}>
            <h3 className={styles.heading}>{t('ui.recipes')}</h3>
            <ul className={styles.rows}>
              {options.recipes.map(option => (
                <li key={String(option.id)}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => { onChoose({ kind: 'recipe', refId: String(option.id), name: option.name }); }}
                  >
                    <span className={styles.name}>{option.name}</span>
                    {' '}
                    <span className={styles.meta}>{t('cat.recipe')}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {inactive.length === 0 ? null : (
          <section className={styles.section}>
            <h3 className={styles.heading}>{t('ui.notInUse')}</h3>
            <ul className={styles.rows}>
              {inactive.map(option => (
                <li key={String(option.id)}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => { onChoose({ kind: 'ingredient', refId: String(option.id), name: option.name }); }}
                  >
                    <span className={styles.name}>{option.displayName ?? option.name}</span>
                    {' '}
                    <span className={styles.meta}>{[option.weight, option.supplierName].filter(Boolean).join(LINK_SEPARATOR)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
        {shown === 0 ? (
          <p className={styles.empty}>{query.trim() !== '' ? t('cat.nothingMatchesYourSearch') : t('cat.noIngredientsYetAdd')}</p>
        ) : null}
        {canCreate ? (
          <button type="button" className={`${styles.row} ${styles.create}`} onClick={() => { onCreate(query.trim()); }}>
            {t('cat.createIngredient', { name: query.trim() })}
          </button>
        ) : null}
      </div>
    </Dialog>
  );
}
