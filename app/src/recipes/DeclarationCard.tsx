import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { canPrintLabel, outputLanguage } from '@mise/shared/market';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { recipeAllergens, rowState } from '@mise/shared/recipe-allergen-model';
import { buildLabel, containsLine, declarationText, mayContainLine } from '@mise/shared/recipe-label-model';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { copyToClipboard } from '../ui/clipboard';
import { useSendSheet } from '../ui/SendSheet';
import { useAllergenTables } from './allergenTables';
import { useRecipes } from './RecipesContext';
import { useStillWaiting } from './useStillWaiting';
import styles from './DeclarationCard.module.css';

// How long «Copied» (or «Could not copy») stays under the buttons.
const COPY_NOTE_MS = 2500;

// The ingredient declaration, on the recipe screen: the list heaviest first with the allergen-bearing
// rows in bold and underlined INSIDE the list, «Contains», «May contain», the caveat, and Copy and Send.
//
// ⚠️ NOTHING HERE IS NEW ARITHMETIC: `buildLabel` flattens sub-recipes, sums duplicates, sorts by weight
// (which is the law, not a presentation choice) and marks the allergen rows, exactly as the label does.
//
// ⚠️ HIDDEN WHEN ALLERGENS ARE OFF, asked first: a venue that has switched them off must not be offered a
// declaration about data it can no longer reach.
//
// ⚠️ NO COUNTRY, NO DECLARATION. The words of a declaration are the venue's COUNTRY's language and there is no
// fallback: with no country, an unsupported one, or a venue document that did not load (`canPrintLabel` false)
// the card says ONE line (the current app's «No label can be made yet…») and has no Copy and no Send. The
// venue document is read once when the venue opens and is not live in Mise 2 (seen after a reload).
//
// ⚠️ AN EMPTY RECIPE (no rows) HIDES THE CARD, as the allergen card is hidden: there is nothing to declare. A
// recipe whose rows are declared but none has a weight gets its own sentence, never the «still to be
// declared» one, which would send somebody hunting for ingredients that are fine.
//
// ⚠️ A HALF DECLARATION MUST NEVER BE SENDABLE. When the label cannot be built the card says one line,
// pointing at the allergen card above, and has NO Copy and NO Send. The same while the ingredients are
// still arriving: no verdict, no buttons (after ten seconds of it, one more line says what it is waiting
// for). If the ingredient list could never be read the verdict stays «not ready» and the blocked line stands.
//
// ⚠️ WHAT IS COPIED AND SENT IS THE LABEL'S OWN TEXT in the venue's COUNTRY's language
// (`outputLanguage`, read while drawing), without the nutrition table: some mail clients silently drop a
// body past about 2000 characters. The caveat and the buttons are interface text.
export function DeclarationCard({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const { location } = useSession();
  const { recipes, ingredients, ingredientsLoaded } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const [send, sendSheet] = useSendSheet();
  const [note, setNote] = useState<'copied' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const headId = useId();
  const label = useMemo(() => buildLabel(recipe, tables), [recipe, tables]);
  const stillWaiting = useStillWaiting(!ingredientsLoaded);

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  if (!allergensOn(location)) return null;
  // A recipe with no rows stays silent, the model's own word for it (the allergen card says the same).
  if (rowState(recipeAllergens(recipe, tables)) === 'nothing-yet') return null;

  const heading = <h3 id={headId} className={styles.head}>{t('cat.decl.title')}</h3>;

  // ⚠️ Before anything is composed: a declaration is never produced in a fallback language.
  if (!canPrintLabel(location)) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        {heading}
        <p className={styles.blocked}>{t('label.blocked.noCountry')}</p>
      </section>
    );
  }
  const lang = outputLanguage(location);

  if (!ingredientsLoaded) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        {heading}
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
        {stillWaiting ? <p className={styles.checking}>{t('recipes.allergensStillWaiting')}</p> : null}
      </section>
    );
  }

  if (!label.ok) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        {heading}
        <p className={styles.blocked}>
          {label.reason === 'no-ingredients' ? t('label.blocked.noWeights') : t('cat.decl.blocked')}
        </p>
      </section>
    );
  }

  const contains = containsLine(label, lang);
  const traces = mayContainLine(label, lang);
  const text = () => declarationText(label, lang, { withNutrition: false });

  const copy = async () => {
    const ok = await copyToClipboard(text());
    setNote(ok ? 'copied' : 'failed');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; setNote(null); }, COPY_NOTE_MS);
  };

  return (
    <section className={styles.card} aria-labelledby={headId}>
      {heading}
      {/* No «Ingredients:» line on the screen: the card's own heading says what this is. The sent text
          carries it, because there the law asks for it. */}
      <p className={styles.list}>
        {label.ingredients.map((item, index) => (
          <Fragment key={item.id}>
            {index > 0 ? ', ' : null}
            {item.emphasise ? <strong className={styles.allergen}>{item.name}</strong> : <span>{item.name}</span>}
          </Fragment>
        ))}
        .
      </p>
      {contains === '' ? null : <p className={styles.contains}>{contains}</p>}
      {traces === '' ? null : <p className={styles.traces}>{traces}</p>}
      <p className={styles.caveat}>{t('cat.decl.caveat')}</p>

      <div className={styles.share}>
        <button type="button" className={styles.copy} onClick={() => { void copy(); }}>{t('cat.decl.copy')}</button>
        <button type="button" className={styles.send} onClick={() => { send({ subject: recipe.name, text: text() }); }}>
          <Send aria-hidden="true" />
          <span>{t('ui.send')}</span>
        </button>
      </div>
      {/* ⚠️ The mail road OPENS the mail app, it does not send: the sheet says so where it is read. */}
      <p role="status" className={styles.status}>
        {note === 'copied' ? t('label.copied') : note === 'failed' ? t('label.copyFailed') : ''}
      </p>
      {sendSheet}
    </section>
  );
}
