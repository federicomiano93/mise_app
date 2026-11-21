import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { cakeProductId } from '@mise/shared/cake-model';
import { useFoodcost, useFoodcostStore } from '../foodcost/FoodcostContext';
import { useCopyWait } from '../foodcost/copyWait';
import { cameFromFoodcost, cameFromList, useLeave } from '../foodcost/foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from '../foodcost/handBack';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { CakeForm } from './CakeForm';
import { useCakes } from './CakesContext';
import { CAKES_PATH, cakePath } from './cakesPath';
import styles from './CakeEditor.module.css';

// One cake's screen: a cake by its address (`id`), or a new one (`id` null).
//
// ⚠️ IT WAITS FOR EVERYTHING THE FORM COPIES AND COSTS FROM: the cakes, the Food cost cards, the recipes and the ingredients with their
// prices, and, for a NEW cake, the venue's reference grams (copied before they arrive, it would have none; see referenceReady). A cake costed before
// its prices arrived would read «incomplete» only because they were on their way.
//
// ⚠️ A CAKE MISSING FROM THE LIST IS «GONE» ONLY ON THE SERVER'S WORD (`cakesFromServer`): this phone's own copy of the cakes may be an
// empty one from a database that never synced. And not while its own FIRST SAVE is in the air: a snapshot taken before the write lacks
// it for a moment (the store's `firstSave`).
//
// ⚠️ THE SECTION DOES NOT REMOUNT THIS COMPONENT from one address to the next, so it follows `id` itself: the form is keyed on the id,
// and a form copies its cake once, when it mounts. A new cake that is saved gets its own address, and the form (which holds the id it
// made) is NOT remounted for it.
export function CakeEditor({ id }: { id: string | null }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const handBack = useHandBack();
  const store = useFoodcostStore();
  const { cakes, cakesLoaded, cakesFromServer, referenceLoaded } = useCakes();
  const { productsLoaded, recipesLoaded, ingredientsLoaded } = useFoodcost();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const onLeaving = useCallback(() => { handBack.expect(id === null ? NEW_OPENER : productOpener(id)); }, [handBack, id]);
  const leave = useLeave(CAKES_PATH, onLeaving);

  const cake = id === null ? null : cakes.find(candidate => candidate.id === id) ?? null;
  // ⚠️ AN EXISTING CAKE CARRIES ITS OWN `ref` and does not wait for the venue's: only the «reference changed» band does. A NEW cake copies the
  // venue's, so it waits for the answer — but not for ever: offline on a first visit no answer comes, and after the deadline it starts as «no
  // reference yet» (Food cost's own COPY_WAIT_MS).
  const referenceWaited = useCopyWait(referenceLoaded);
  const referenceReady = id !== null || referenceWaited;
  const ready = cakesLoaded && referenceReady && productsLoaded && recipesLoaded && ingredientsLoaded;
  const firstSave = id === null ? null : store.firstSave(cakeProductId(id));

  // The form is keyed on the id, except that a new cake saved by it keeps its form when its address arrives.
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [shown, setShown] = useState({ id, serial: 0 });
  if (shown.id !== id) {
    setShown({ id, serial: id !== null && id === justSaved ? shown.serial : shown.serial + 1 });
    if (id !== justSaved) setJustSaved(null);
  }
  const mine = id !== null && id === justSaved;

  const gone = ready && id !== null && cake === null && !mine && cakesFromServer && firstSave !== 'sending';
  // The form is on screen for a new cake, a cake that is in the list, and a cake this very form just saved (its row may not be in the list yet).
  const hasForm = ready && !gone && (id === null || cake !== null || mine);

  // ⚠️ A FIRST SAVE REFUSED BEFORE ITS CAKE WAS EVER IN THE LIST (the store took it back): the store has said «… wasn't saved»; the person
  // goes to the list.
  const left = useRef(false);
  useEffect(() => {
    if (!(mine && cake === null && firstSave === 'refused') || left.current) return;
    left.current = true;
    leave();
  }, [mine, cake, firstSave, leave]);

  // Opened from the list, or from the cake's card in Food cost, the page does not move the focus (KEEP_FOCUS): it goes to this title
  // (once, when the screen first appears).
  useEffect(() => {
    if ((hasForm || gone) && (cameFromList(state) || cameFromFoodcost(state))) title.current?.focus();
  }, [hasForm, gone]);

  const saved = (savedId: string) => {
    if (id !== null) return;
    setJustSaved(savedId);
    void navigate(cakePath(savedId), { replace: true, state });
  };

  if (gone) return <Gone titleId={titleId} titleRef={title} onBack={leave} />;
  if (!hasForm) {
    return (
      <section className={styles.editor} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <CakeForm key={shown.serial} id={id} cake={cake} titleRef={title} onSaved={saved} />;
}

// A cake address whose cake is not among the cakes, once the server has said so.
function Gone({ titleId, titleRef, onBack }: { titleId: string; titleRef: Ref<HTMLHeadingElement>; onBack: () => void }) {
  const { t } = useT();
  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={onBack} title={t('cakes.gone')} titleId={titleId} titleRef={titleRef} />
    </section>
  );
}
