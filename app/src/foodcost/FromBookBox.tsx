import { useId } from 'react';
import type { Ref } from 'react';
import { BookOpen } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import styles from './FromBookBox.module.css';

type Props = {
  // How many recipes have no product (always above 0: the list draws no box otherwise).
  count: number;
  onOpen: () => void;
  // The button registers with the section's hand-back, so the focus comes back to it when the choice screen closes unused.
  buttonRef: Ref<HTMLButtonElement>;
};

// The box above the list of products (current app b5cf999e, 28 Oct 2026): «3 recipes without a product» and the way to create
// them. Drawn by FoodcostList only for whoever runs the place, once products AND recipes have answered, and not while the list is
// narrowed to a recipe. The count comes from `recipesWithoutProducts`, asked on every draw, so recipes arriving or products being
// created move it with no state of its own.
export function FromBookBox({ count, onOpen, buttonRef }: Props) {
  const { t } = useT();
  const titleId = useId();
  return (
    <section className={styles.box} aria-labelledby={titleId}>
      <div className={styles.head}>
        <BookOpen className={styles.icon} aria-hidden="true" />
        <div className={styles.text}>
          <p id={titleId} className={styles.title}>{t('fc.fromBook.boxTitle', { n: count })}</p>
          <p className={styles.sub}>{t('fc.fromBook.boxSub')}</p>
        </div>
      </div>
      <Button ref={buttonRef} className={styles.action} onPress={onOpen}>{t('fc.fromBook.boxAction', { n: count })}</Button>
    </section>
  );
}
