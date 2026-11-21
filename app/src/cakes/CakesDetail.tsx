import { useT } from '../i18n/useT';
import { CakeEditor } from './CakeEditor';
import { useCakes } from './CakesContext';
import type { CakesView } from './cakesPath';
import { ReferenceScreen } from './ReferenceScreen';
import styles from './CakesDetail.module.css';

// The right-hand side of the split — and, below it, the whole screen when a cake, a new cake or the reference grams is open. With
// nothing chosen it says what to do.
export function CakesDetail({ view }: { view: CakesView }) {
  switch (view.kind) {
    case 'list':
      return <Prompt />;
    case 'new':
      return <CakeEditor id={null} />;
    case 'cake':
      return <CakeEditor id={view.id} />;
    case 'reference':
      return <ReferenceScreen />;
  }
}

// Only the split draws this (below it the right-hand side is not drawn while the list is the screen).
//
// ⚠️ NOT BESIDE «NO CAKES YET»: a prompt to tap a cake, next to a list that says there are none, would send somebody looking for what
// is not there.
function Prompt() {
  const { t } = useT();
  const { cakes } = useCakes();
  if (cakes.length === 0) return null;
  return (
    <div className={styles.prompt}>
      <p className={styles.promptTitle}>{t('cakes.prompt.title')}</p>
      <p>{t('cakes.prompt.text')}</p>
    </div>
  );
}
