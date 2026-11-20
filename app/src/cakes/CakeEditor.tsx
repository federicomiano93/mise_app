import { useCallback, useEffect, useId, useRef } from 'react';
import { useLocation } from 'react-router';
import { cameFromList, useLeave } from '../foodcost/foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from '../foodcost/handBack';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useCakes } from './CakesContext';
import { CAKES_PATH } from './cakesPath';
import styles from './CakeEditor.module.css';

// ⚠️ THE SEAM OF THE NEXT SLICE: the cake's editor (the parts, the measures, the cost, Save) takes this name and this prop. `id` is the
// cake being edited, or null for a new one. Until then the pane says so, with the cake's name and a working Back.
export function CakeEditor({ id }: { id: string | null }) {
  const { t } = useT();
  const { cakes } = useCakes();
  const handBack = useHandBack();
  const { state } = useLocation();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const cake = id === null ? null : cakes.find(candidate => candidate.id === id) ?? null;

  const onLeaving = useCallback(() => { handBack.expect(id === null ? NEW_OPENER : productOpener(id)); }, [handBack, id]);
  const leave = useLeave(CAKES_PATH, onLeaving);
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const name = cake === null ? t('cakes.new') : cake.name === '' ? t('cakes.untitled') : cake.name;
  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={name} titleId={titleId} titleRef={title} />
      <p className={styles.soon}>{t('cakes.editorSoon')}</p>
    </section>
  );
}
