import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { allergenName, outputLanguage } from '@mise/shared/market';
import { ALLERGEN_REASON_TEXT, recipeAllergens, rowState } from '@mise/shared/recipe-allergen-model';
import type { RecipeAllergens } from '@mise/shared/recipe-allergen-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useAllergenTables } from './allergenTables';
import { incompleteSentence } from './allergenText';
import { useRecipes } from './RecipesContext';
import { FROM_RECIPE } from './recipesNav';
import { labelPath } from './recipesPath';
import { useStillWaiting } from './useStillWaiting';
import styles from './AllergenCard.module.css';

// How many undeclared rows the card names; the rest are «and N more».
const GAPS_SHOWN = 8;

// What a recipe contains, for somebody at the counter being asked.
//
// ⚠️ A PARTIAL LIST IS THE DANGEROUS ONE. The unlinked row could be the one with the hazelnuts, so when
// anything is missing this card refuses to present a list and shows the JOB instead. Every verdict
// comes from the shared model (`rowState` over `recipeAllergens`): nothing here decides an allergen
// state with an `if` of its own.
//
// ⚠️ THE WHOLE CARD GOES WHEN THE VENUE HAS ALLERGENS SWITCHED OFF, read here on every render. The venue
// document is read ONCE, when the venue opens, and is not live in Mise 2: a switch thrown on another phone
// is seen after a reload, like the rest of Mise 2.
//
// ⚠️ NO COUNTRY: this card still shows the names (in English), as the current app does on purpose — it is
// the on-screen reading at the counter. What is COPIED or SENT is the declaration card's job, and that one
// refuses without a country.
//
// ⚠️ UNTIL THE INGREDIENTS HAVE ARRIVED THE CARD SAYS IT IS CHECKING AND GIVES NO VERDICT (new in Mise 2):
// with nothing to look a linked row up in, every recipe would read «not declared» for a moment on a
// cold phone, which is a wrong answer, however safe. After ten seconds of it the card adds a line saying
// what it is waiting for (offline, nothing stored), and still gives no verdict.
//
// ⚠️ IF THE INGREDIENT LIST COULD NEVER BE READ (`ingredientsUnreadable`) the per-row reasons would all be
// untrue («linked to an ingredient that no longer exists»), so one line stands in their place. The head
// still says «not declared», from the model.
//
// ⚠️ THE ANSWER IS NEVER BEHIND A TAP: incomplete, the head says «not declared» in a word; complete, the
// allergens (or «None of the 14») stand outside the fold. Only the JOB folds away — the rows to fix, the
// traces, the caveat. It opens CLOSED every time a recipe is opened (the screen is keyed on the recipe),
// and a live redraw of the SAME recipe keeps it as it was.
//
// ⚠️ THE FOOD WORDS ARE THE VENUE'S COUNTRY'S (`outputLanguage`), read here while drawing and never the
// interface language: the card must agree word for word with the label the same recipe prints. The words
// around them («not declared», «May contain») are interface text.
export function AllergenCard({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const { location } = useSession();
  const { recipes, ingredients, ingredientsLoaded, ingredientsUnreadable } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const headId = useId();
  const bodyId = useId();
  const stillWaiting = useStillWaiting(!ingredientsLoaded);

  if (!allergensOn(location)) return null;
  const lang = outputLanguage(location);

  const result = recipeAllergens(recipe, tables);
  const state = rowState(result);
  // A recipe with no rows stays silent: there is nothing to declare and nothing to go and fix.
  if (state === 'nothing-yet') return null;

  if (!ingredientsLoaded) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        <h3 id={headId} className={styles.staticHead}>{t('cat.alg.title')}</h3>
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
        {stillWaiting ? <p className={styles.checking}>{t('recipes.allergensStillWaiting')}</p> : null}
      </section>
    );
  }

  const incomplete = state === 'not-declared';
  const names = (codes: RecipeAllergens['allergens']) => codes.map(code => allergenName(code, lang)).join(', ');

  return (
    <section className={styles.card} aria-labelledby={headId}>
      <h3 id={headId} className={styles.heading}>
        <button
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => { setOpen(!open); }}
        >
          <span className={styles.label}>{t('cat.alg.title')}</span>
          {/* A space between the two, or the accessible name reads «Allergensnot declared». */}
          {' '}
          <span className={`${styles.state} ${incomplete ? styles.blocked : styles.ok}`}>
            {incomplete ? t('cat.alg.notDeclared') : t('cat.alg.declared')}
          </span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </button>
      </h3>

      {state === 'declared-listed' ? <p className={styles.answer}>{names(result.allergens)}</p> : null}
      {state === 'declared-none' ? <p className={styles.answer}>{t('cat.noneOfThe14')}</p> : null}

      <div id={bodyId} hidden={!open} className={styles.body}>
        {incomplete ? (
          <>
            <p className={styles.warn}>{incompleteSentence(t, result.gaps.length)}</p>
            {/* ⚠️ THE ROWS ARE NAMED: «incomplete» alone leaves somebody hunting through twenty
                ingredients. This list is the work. */}
            {ingredientsUnreadable ? (
              <p className={styles.warn}>{t('cat.alg.unreadable')}</p>
            ) : (
              <ul className={styles.gaps}>
                {result.gaps.slice(0, GAPS_SHOWN).map((gap, index) => (
                  <li key={index}>
                    {gap.reason === null ? gap.label : `${gap.label} — ${t(ALLERGEN_REASON_TEXT[gap.reason])}`}
                  </li>
                ))}
                {result.gaps.length > GAPS_SHOWN ? (
                  <li className={styles.more}>{t('cat.alg.andMore', { n: result.gaps.length - GAPS_SHOWN })}</li>
                ) : null}
              </ul>
            )}
            {/* What IS known so far, marked as explicitly NOT an answer. */}
            {result.allergens.length > 0 ? (
              <p className={styles.soFar}>{t('cat.alg.soFar', { list: names(result.allergens) })}</p>
            ) : null}
          </>
        ) : (
          <>
            {result.mayContain.length > 0 ? (
              <p className={styles.traces}>{t('cat.alg.mayContain', { list: names(result.mayContain) })}</p>
            ) : null}
            {/* The sentence that must not be dropped: the app gathers what it was told and cannot know
                what happened on the bench this morning. */}
            <p className={styles.caveat}>{t('cat.fromTheSuppliersSpecifications2')}</p>
            {/* ⚠️ THE WAY TO THE LABEL EXISTS ONLY WHEN THERE IS A LABEL TO MAKE: on a recipe with gaps it would be a tap
                through to a refusal, and the refusal is already above, naming exactly what is missing. It is here, inside
                the card the venue's allergen switch hides, and nowhere else: a venue that has switched allergens off has
                no way in (the label screen refuses again by itself, for an address typed by hand). It opens one level
                below the recipe, so Back returns here. */}
            <button
              type="button"
              className={styles.labelButton}
              onClick={() => { void navigate(labelPath(recipe.id), { state: FROM_RECIPE }); }}
            >
              <span>{t('cat.makeALabel')}</span>
              <ChevronRight aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    </section>
  );
}
