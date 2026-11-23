import { useId } from 'react';
import type { Ref } from 'react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { ImageLabelBody } from './ImageLabelBody';
import { imageLabelChoice } from './imageLabelData';
import { LabelBody } from './LabelBody';
import { useRecipes } from './RecipesContext';
import styles from './LabelScreen.module.css';

type Props = {
  recipe: CatalogueRecipe;
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// The label screen: Back and the recipe's name, then the body (LabelBody.tsx, which the whole cake's label shares). One level below
// the recipe it was opened from.
export function LabelScreen({ recipe, titleRef, onBack }: Props) {
  const { t } = useT();
  const titleId = useId();
  // ⚠️ THE MODEL IS THE VENUE'S CHOICE (config/labels `template`), and it is believed only once the label settings have
  // arrived: until then the standard screen is drawn, exactly as before this model existed. The image label has its own
  // screen and no allergens / nutrition switch (its text is typed, not worked out).
  const { labelConfig, labelConfigKnown } = useRecipes();
  const image = labelConfigKnown && imageLabelChoice(labelConfig).template === 'logo';
  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        title={recipe.name === '' ? t('cat.label') : recipe.name}
        titleId={titleId}
        titleRef={titleRef}
        sub={<span className={styles.sub}>{t('cat.label')}</span>}
      />
      {image ? <ImageLabelBody recipe={recipe} /> : <LabelBody recipe={recipe} shelfLifeDays={recipe.shelfLifeDays} netWeightG={recipe.netWeightG} />}
    </section>
  );
}
