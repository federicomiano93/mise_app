import { useEffect, useId, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { HaccpLabelBody } from './HaccpLabelBody';
import { haccpRowOpener, useHandBack } from './handBack';
import { useRecipes } from './RecipesContext';
import { cameFromHaccp, useLeave } from './recipesNav';
import { HACCP_PATH } from './recipesPath';
import styles from './LabelScreen.module.css';
import detail from './RecipesDetail.module.css';

// A recipe's HACCP label, one level below the HACCP list (image labels step 2): Back and the title, then the body.
//
// ⚠️ BACK IS ONE LEVEL UP, TO THE HACCP LIST, and hands the focus back to the row that opened it. Opened by its address with
// nothing behind it (a bookmark, a reload) there is no list entry to step back to, so it REPLACES itself with the HACCP list.
//
// ⚠️ A RECIPE ADDRESS WAITS FOR THE SERVER'S FIRST ANSWER (or the stream breaking) before it says the recipe does not exist:
// the local copy can be a stale partial one, and «this recipe no longer exists» about one that does is worse than «Loading…».
export function HaccpLabelScreen({ id }: { id: string }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const { recipes, recipesFromServer, streamBroken } = useRecipes();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const leave = useLeave(HACCP_PATH, () => { handBack.expect(haccpRowOpener(id)); }, cameFromHaccp);

  const recipe = recipes.find(candidate => candidate.id === id) ?? null;
  const settled = recipesFromServer || streamBroken;

  // Opened from a row of the HACCP list the page does not move the focus (FROM_HACCP): it goes to this title, once, when the
  // screen first has a recipe to show. Not when the browser's Back brings it again (a POP).
  const shown = recipe !== null;
  useEffect(() => {
    if (shown && cameFromHaccp(state) && navigationType !== 'POP') title.current?.focus();
  }, [shown]);

  if (recipe === null) {
    if (!settled) {
      return (
        <section className={detail.waiting} aria-busy="true">
          <p className={detail.loading}>{t('session.loading')}</p>
        </section>
      );
    }
    return (
      <section className={detail.missing} aria-label={t('recipes.notFound')}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('recipes.notFound')} titleRef={title} />
      </section>
    );
  }

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={t('haccp.label.title')}
        titleId={titleId}
        titleRef={title}
        sub={<span className={styles.sub}>{recipe.name === '' ? t('cat.noName') : recipe.name}</span>}
      />
      <HaccpLabelBody recipe={recipe} />
    </section>
  );
}
