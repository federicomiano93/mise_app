import { useCallback, useId, useMemo, useState } from 'react';
import type { Ref } from 'react';
import { ChevronRight, Search } from 'lucide-react';
import { filterByName } from '@mise/shared/catalogue-model';
import { haccpListCategory, haccpSettingsOf } from '@mise/shared/haccp-label';
import { categoryOf, withoutArchived } from '@mise/shared/recipe-shelf';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { haccpRowOpener, useHandBack } from './handBack';
import { useRecipes } from './RecipesContext';
import styles from './HaccpList.module.css';

type Props = {
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
  // A recipe was tapped: the section opens its HACCP label one level down.
  onOpenRecipe: (id: string) => void;
};

// The HACCP list (image labels step 2): the recipes whose HACCP label can be made, drawn like the Allergen sheet — the
// right-hand pane on the split, a screen of its own on a phone, one level below the recipe list.
//
// ⚠️ ARCHIVED RECIPES ARE LEFT OUT, and so is everything outside the one category the venue chose in Settings (none = every
// recipe). A category word that has left the venue's list reads as «every recipe» (haccpListCategory), so deleting a category
// can never leave the lab with an empty list it cannot explain. The line under the title SAYS which recipes are shown, so a
// short list is never a mystery.
//
// ⚠️ THE ROWS WAIT FOR THE LABEL SETTINGS (`labelConfigKnown`): drawn before they arrive, the list would show every recipe and
// then lose the ones outside the category, under the finger.
//
// ⚠️ THE SEARCH IS ITS OWN (its text is kept here, never the recipe list's), by recipe name, and the box stays mounted while
// a snapshot repaints the rows.
export function HaccpList({ titleRef, onBack, onOpenRecipe }: Props) {
  const { t, locale } = useT();
  const handBack = useHandBack();
  const { recipes, recipesLoaded, labelConfig, labelConfigKnown, categories } = useRecipes();
  const [query, setQuery] = useState('');
  const titleId = useId();

  const settings = haccpSettingsOf(labelConfig);
  const only = haccpListCategory(settings, categories);

  // Alphabetical in the interface's language: accents and case sort the way the person reads.
  const inScope = useMemo(() => {
    const kept = withoutArchived(recipes).filter(recipe => only === null || categoryOf(recipe, categories) === only);
    return kept.sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [recipes, categories, only, locale]);
  const shown = useMemo(() => filterByName(inScope, query), [inScope, query]);

  const ready = recipesLoaded && labelConfigKnown;

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={onBack} title={t('haccp.list.title')} titleId={titleId} titleRef={titleRef} />
      <div className={styles.body}>
        {!ready ? (
          <p className={styles.loading} aria-busy="true">{t('session.loading')}</p>
        ) : (
          <>
            <p className={styles.scope}>
              {only === null ? t('haccp.list.shownAll') : t('haccp.list.shownCategory', { name: only })}
            </p>

            <div className={styles.search}>
              <Search aria-hidden="true" />
              <input
                type="search"
                autoComplete="off"
                className={styles.input}
                aria-label={t('cat.searchARecipeBy')}
                placeholder={t('cat.searchARecipe')}
                value={query}
                onChange={event => { setQuery(event.target.value); }}
              />
            </div>

            {inScope.length === 0 ? (
              <p className={styles.nothing}>
                {only === null ? t('cat.noRecipesYet') : t('haccp.list.emptyCategory', { name: only })}
              </p>
            ) : shown.length === 0 ? (
              <p className={styles.nothing}>{t('cat.noRecipeMatchesYour')}</p>
            ) : (
              <ul className={styles.rows}>
                {shown.map(recipe => (
                  <HaccpRow
                    key={recipe.id}
                    id={recipe.id}
                    name={recipe.name === '' ? t('cat.noName') : recipe.name}
                    onOpen={onOpenRecipe}
                    register={handBack.register}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// One recipe: its name and a chevron, the whole row a button. Back from its HACCP label hands the focus back to it.
function HaccpRow({ id, name, onOpen, register }: {
  id: string;
  name: string;
  onOpen: (id: string) => void;
  register: (name: string, node: HTMLElement | null) => void;
}) {
  const opener = useCallback((node: HTMLButtonElement | null) => { register(haccpRowOpener(id), node); }, [register, id]);
  return (
    <li className={styles.item}>
      <button ref={opener} type="button" className={styles.row} onClick={() => { onOpen(id); }}>
        <span className={styles.name}>{name}</span>
        <ChevronRight aria-hidden="true" className={styles.chevron} />
      </button>
    </li>
  );
}
