import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { outputLanguage } from '@mise/shared/market';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { buildLabel, containsLine, declarationText, mayContainLine } from '@mise/shared/recipe-label-model';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { copyToClipboard } from '../ui/clipboard';
import { useSendSheet } from '../ui/SendSheet';
import { useAllergenTables } from './allergenTables';
import { useRecipes } from './RecipesContext';
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
// ⚠️ A HALF DECLARATION MUST NEVER BE SENDABLE. When the label cannot be built the card says one line,
// pointing at the allergen card above, and has NO Copy and NO Send. The same while the ingredients are
// still arriving: no verdict, no buttons.
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

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  if (!allergensOn(location)) return null;
  const lang = outputLanguage(location);

  const heading = <h3 id={headId} className={styles.head}>{t('cat.decl.title')}</h3>;

  if (!ingredientsLoaded) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        {heading}
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
      </section>
    );
  }

  if (!label.ok) {
    return (
      <section className={styles.card} aria-labelledby={headId}>
        {heading}
        <p className={styles.blocked}>{t('cat.decl.blocked')}</p>
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
