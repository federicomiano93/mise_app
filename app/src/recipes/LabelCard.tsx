import { Fragment } from 'react';
import { NUTRIENTS } from '@mise/shared/allergen-model';
import { labelWord, nutrientName, outputLanguage } from '@mise/shared/market';
import { containsLine, mayContainLine } from '@mise/shared/recipe-label-model';
import type { DraftLabel, LabelShows } from '@mise/shared/recipe-label-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import styles from './LabelScreen.module.css';

// The label as words, big enough to read and to copy: the same thing the paper above it says. Name, the
// ingredients heaviest first with the allergen-bearing ones emphasised INSIDE the list, «Contains», «May contain», the
// nutrition table or the sentence that it cannot be worked out, and the loss in baking.
//
// ⚠️ EVERY WORD ON THE LABEL FOLLOWS THE VENUE'S COUNTRY (`outputLanguage`, read here while drawing) and never the
// interface language: an Italian bakery run by an English-speaking manager still prints «Contiene». The few words
// that are the screen's own («Recipe» for an unnamed one, «Worked out on the finished weight») are interface text.
//
// ⚠️ THE ALLERGENS ARE EMPHASISED INSIDE THE LIST, not only summarised underneath: that is what the regulation asks
// for, and what a person scanning a label actually reads. Bold AND underlined, so it does not rest on weight alone.
//
// ⚠️ WHAT IS WORKED OUT FOLLOWS THE SWITCH, and so does what is shown: asking for allergens only never computes a
// nutrition table (buildLabel), and a label asked for nutrition that cannot be worked out SAYS SO rather than
// printing the allergen half and looking finished.
export function LabelCard({ label, shows }: { label: DraftLabel; shows: LabelShows }) {
  const { t } = useT();
  const { location } = useSession();
  const lang = outputLanguage(location);
  const contains = containsLine(label, lang);
  const traces = mayContainLine(label, lang);

  return (
    <div className={styles.card}>
      <p className={styles.name}>{label.name || t('label.untitled')}</p>

      {shows !== 'nutrition' ? (
        <>
          <p className={styles.ingredients}>
            {`${labelWord('ingredients', lang)}: `}
            {label.ingredients.map((item, index) => (
              <Fragment key={item.id}>
                {index > 0 ? ', ' : null}
                <span className={item.emphasise ? styles.allergen : undefined}>{item.name}</span>
              </Fragment>
            ))}
            .
          </p>
          {contains === '' ? null : <p className={styles.contains}>{contains}</p>}
          {traces === '' ? null : <p className={styles.traces}>{traces}</p>}
        </>
      ) : null}

      {shows !== 'allergens' ? (
        label.nutrition !== null ? (
          <>
            <table className={styles.nutrition}>
              <thead>
                <tr>
                  <th scope="col">{labelWord('typicalValues', lang)}</th>
                  <th scope="col" className={styles.num}>{labelWord('per100g', lang)}</th>
                </tr>
              </thead>
              <tbody>
                {NUTRIENTS.map(nutrient => (
                  <tr key={nutrient.key}>
                    <td>{nutrientName(nutrient, lang)}</td>
                    <td className={styles.num}>{`${label.nutrition?.[nutrient.key] ?? ''} ${nutrient.unit}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {label.nutrition.lossPct > 0 ? (
              <p className={styles.yield}>{t('label.onFinishedWeight', { pct: label.nutrition.lossPct })}</p>
            ) : null}
          </>
        ) : (
          <p className={styles.missing}>{t('label.noNutrition')}</p>
        )
      ) : null}
    </div>
  );
}
