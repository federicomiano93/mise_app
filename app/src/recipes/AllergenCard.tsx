import { useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { allergenName, outputLanguage } from '@mise/shared/market';
import { ALLERGEN_REASON_TEXT, recipeAllergens, rowState } from '@mise/shared/recipe-allergen-model';
import type { RecipeAllergens } from '@mise/shared/recipe-allergen-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { ingredientCardAddress } from '@mise/shared/recipe-link';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { visibleSectionIds } from '../session/visibility';
import { gapEntries } from './allergenGaps';
import type { GapEntry } from './allergenGaps';
import { useAllergenTables } from './allergenTables';
import { incompleteSentence } from './allergenText';
import { useRecipes } from './RecipesContext';
import { useRecipeReturn } from './recipeReturn';
import { FROM_GAP, FROM_RECIPE, TO_INGREDIENT_CARD, cameFromIngredients, cameFromList, cameFromSheet } from './recipesNav';
import { editPath, labelPath, recipePath } from './recipesPath';
import { useStillWaiting } from './useStillWaiting';
import styles from './AllergenCard.module.css';

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
// ⚠️ EVERY GAP IS NAMED, in two groups, and each is a door to where it is put right (23 Nov 2026). The ingredients nobody has declared
// open their card in Suppliers (Back, Save and Delete come back here with ONE history step, the gap row owed the focus); the rows to fix
// in the recipe itself open its editor, or an incomplete sub-recipe's own screen. Who cannot open Suppliers sees the names as plain text.
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
  const { location, canManage, role } = useSession();
  const { state } = useLocation();
  const { recipes, ingredients, ingredientsLoaded, ingredientsUnreadable } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const navigate = useNavigate();
  const recipeReturn = useRecipeReturn();
  // ⚠️ BACK FROM THIS RECIPE'S LABEL the fold is open again (the button is inside it) and the focus is on the button,
  // as when the person left. Read while drawing the first time; opened afresh, the card still opens closed.
  const [returning] = useState(() => recipeReturn.pending(recipe.id));
  // ⚠️ BACK FROM ONE OF THIS RECIPE'S GAPS (an ingredient's card, a sub-recipe, the editor) the fold is open again and the focus is on the
  // gap row that was tapped; if that row is gone (the ingredient was fixed) it is on the card's own toggle, never the page body.
  const [gapBack] = useState(() => recipeReturn.pendingGap(recipe.id));
  const [open, setOpen] = useState(returning || gapBack !== null);
  const labelButton = useRef<HTMLButtonElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const gapButtons = useRef(new Map<string, HTMLButtonElement>());
  const gapDelivered = useRef(false);
  const headId = useId();
  const ingredientsTitleId = useId();
  const rowsTitleId = useId();
  const bodyId = useId();
  const stillWaiting = useStillWaiting(!ingredientsLoaded);

  useEffect(() => {
    if (!returning || labelButton.current === null) return;
    labelButton.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);

  // Once the ingredients are in (a cold phone draws the card before them, with no rows to focus), once.
  useEffect(() => {
    if (gapBack === null || gapDelivered.current || !ingredientsLoaded) return;
    gapDelivered.current = true;
    recipeReturn.restoreScroll(recipe.id);
    const target = gapButtons.current.get(gapBack) ?? toggle.current;
    if (target === null) return;
    target.focus({ preventScroll: true });
    recipeReturn.markDelivered();
    // Again after the shell's own scroll reset, which runs after this card's effects (as the Food cost card does) — and then the row
    // itself is brought into view if the restored scroll left it outside (the data arrives after the screen, so the place written down
    // may be taller than what is drawn yet, and `preventScroll` leaves the browser no way to show it).
    queueMicrotask(() => {
      recipeReturn.restoreScroll(recipe.id);
      const box = target.getBoundingClientRect();
      if (typeof target.scrollIntoView === 'function' && (box.top < 0 || box.bottom > window.innerHeight)) target.scrollIntoView({ block: 'center' });
    });
  }, [ingredientsLoaded]);

  // ⚠️ A GAP ROW THAT HAS THE FOCUS AND THEN GOES (the ingredient was declared, and the live list says so a moment after the card came
  // back) would drop the focus on the page body: it goes to the card's toggle instead. Asked after every draw, cheaply.
  const focusedGap = useRef<string | null>(null);
  useEffect(() => {
    const key = focusedGap.current;
    if (key === null || gapButtons.current.has(key)) return;
    focusedGap.current = null;
    if (document.activeElement === document.body || document.activeElement === null) toggle.current?.focus({ preventScroll: true });
  });

  if (!allergensOn(location)) return null;
  const lang = outputLanguage(location);

  const result = recipeAllergens(recipe, tables);
  const verdict = rowState(result);
  // A recipe with no rows stays silent: there is nothing to declare and nothing to go and fix.
  if (verdict === 'nothing-yet') return null;

  if (!ingredientsLoaded) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        <h3 id={headId} className={styles.staticHead}>{t('cat.alg.title')}</h3>
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
        {stillWaiting ? <p className={styles.checking}>{t('recipes.allergensStillWaiting')}</p> : null}
      </section>
    );
  }

  const incomplete = verdict === 'not-declared';
  // ⚠️ ONLY WHO MAY OPEN SUPPLIERS GETS A DOOR TO IT: the section is off for the venue, or the role is kept out of it, and the same
  // question the rail asks (session/visibility.ts) answers it. Editing a recipe is for everybody who sees the section (RecipeView).
  const mayOpenSuppliers = visibleSectionIds(location, canManage, role).has('suppliers');
  const gaps = gapEntries(recipe.ingredients, result.rows);
  const ingredientGaps = gaps.filter(gap => gap.reason === 'not-declared');
  const rowGaps = gaps.filter(gap => gap.reason !== 'not-declared');
  const openGap = (gap: GapEntry) => {
    recipeReturn.rememberGap(recipe.id, gap.key, gap.target.kind === 'ingredient');
    if (gap.target.kind === 'ingredient') {
      const address = ingredientCardAddress(gap.target.refId);
      if (address !== null) void navigate(address, { state: TO_INGREDIENT_CARD });
    } else if (gap.target.kind === 'recipe') {
      void navigate(recipePath(gap.target.refId), { state: FROM_GAP });
    } else {
      void navigate(editPath(recipe.id), { state: { ...FROM_RECIPE, recipeFromList: cameFromList(state) && !cameFromSheet(state) && !cameFromIngredients(state) } });
    }
  };
  const gapRow = (gap: GapEntry, withReason: boolean, tappable: boolean) => {
    const words = (
      <span className={styles.gapWords}>
        <span className={styles.gapLabel}>{gap.label}</span>
        {/* A space, or the accessible name of the row reads «Flourthe linked…». */}
        {withReason ? ' ' : null}
        {withReason ? <span className={styles.gapReason}>{t(ALLERGEN_REASON_TEXT[gap.reason])}</span> : null}
      </span>
    );
    return (
      <li key={gap.key} className={styles.gapItem}>
        {tappable ? (
          <button
            type="button"
            className={styles.gapRow}
            ref={node => {
              if (node === null) gapButtons.current.delete(gap.key);
              else gapButtons.current.set(gap.key, node);
            }}
            onFocus={() => { focusedGap.current = gap.key; }}
            onClick={() => { openGap(gap); }}
          >
            {words}
            <ChevronRight aria-hidden="true" />
          </button>
        ) : (
          <div className={styles.gapRow}>{words}</div>
        )}
      </li>
    );
  };
  const names = (codes: RecipeAllergens['allergens']) => codes.map(code => allergenName(code, lang)).join(', ');

  return (
    <section className={styles.card} aria-labelledby={headId}>
      <h3 id={headId} className={styles.heading}>
        <button
          ref={toggle}
          type="button"
          className={styles.toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => { setOpen(!open); }}
        >
          {/* The words wrap as one group, so on a narrow phone the state drops whole under the title and the chevron keeps its
              place on the right (at 296px the three pieces did not fit on one row and the chevron was pushed past the edge). */}
          <span className={styles.words}>
            <span className={styles.label}>{t('cat.alg.title')}</span>
            {/* A space between the two, or the accessible name reads «Allergensnot declared». */}
            {' '}
            <span className={`${styles.state} ${incomplete ? styles.blocked : styles.ok}`}>
              {incomplete ? t('cat.alg.notDeclared') : t('cat.alg.declared')}
            </span>
          </span>
          <ChevronDown aria-hidden="true" className={styles.chevron} />
        </button>
      </h3>

      {verdict === 'declared-listed' ? <p className={styles.answer}>{names(result.allergens)}</p> : null}
      {verdict === 'declared-none' ? <p className={styles.answer}>{t('cat.noneOfThe14')}</p> : null}

      <div id={bodyId} hidden={!open} className={styles.body}>
        {incomplete ? (
          <>
            <p className={styles.warn}>{incompleteSentence(t, result.gaps.length)}</p>
            {/* ⚠️ THE ROWS ARE NAMED: «incomplete» alone leaves somebody hunting through twenty
                ingredients. This list is the work. */}
            {ingredientsUnreadable ? (
              <p className={styles.warn}>{t('cat.alg.unreadable')}</p>
            ) : (
              <>
                {ingredientGaps.length > 0 ? (
                  <div className={styles.group}>
                    <h4 id={ingredientsTitleId} className={styles.groupTitle}>{t('cat.alg.groupIngredients', { n: ingredientGaps.length })}</h4>
                    {mayOpenSuppliers ? <p className={styles.hint}>{t('cat.alg.groupIngredientsHint')}</p> : null}
                    <ul className={`${styles.gaps} ${styles.twoColumns}`} aria-labelledby={ingredientsTitleId}>
                      {ingredientGaps.map(gap => gapRow(gap, false, mayOpenSuppliers))}
                    </ul>
                  </div>
                ) : null}
                {rowGaps.length > 0 ? (
                  <div className={styles.group}>
                    <h4 id={rowsTitleId} className={styles.groupTitle}>{t('cat.alg.groupRows', { n: rowGaps.length })}</h4>
                    <ul className={styles.gaps} aria-labelledby={rowsTitleId}>
                      {rowGaps.map(gap => gapRow(gap, true, true))}
                    </ul>
                  </div>
                ) : null}
              </>
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
              ref={labelButton}
              type="button"
              className={styles.labelButton}
              onClick={() => {
                recipeReturn.remember(recipe.id);
                void navigate(labelPath(recipe.id), { state: FROM_RECIPE });
              }}
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
