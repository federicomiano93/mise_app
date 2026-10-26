import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { itemWithPrice } from '@mise/shared/ingredient-edit-model';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { outputLanguage } from '@mise/shared/market';
import { packChoices, unitChoices } from '@mise/shared/record-choices';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { IngredientCard } from '../records/IngredientCard';
import { kindFor } from '../records/ingredientCardModel';
import type { CardKind } from '../records/ingredientCardModel';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { announceAction } from '../telemetry/usage';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useCopyWait } from './copyWait';
import { ADD_INGREDIENT_OPENER, NEW_OPENER, SEARCH_OPENER, itemOpener, supplierItemOpener, useHandBack } from './handBack';
import { useIngredientDeletions } from './ingredientDeletions';
import { SupplierCard } from './SupplierCard';
import { useSuppliers, useSuppliersStore } from './SuppliersContext';
import { cameFromList, cameFromListOrSupplierScreen, fromCard, supplierScreenOf, tabOfState, useLeave } from './suppliersNav';
import { ingredientMergePath, tabPath } from './suppliersPath';
import { useDeleteIngredient } from './useDeleteIngredient';
import { useMayWritePrices } from './useMayWritePrices';
import styles from './SupplierCard.module.css';

// The ingredient card's own screen: a new ingredient or packaging item (`id` null), or one by its address. It connects the
// card (records/IngredientCard.tsx, which knows nothing of this section) to the store, the address, the wait for the server and
// the way back.
//
// ⚠️ AN EXISTING ITEM OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE: the card copies the item once and Save writes
// every product field, so a card opened from a copy a week old would write last week's brand back over another phone's change —
// and an item whose supplier the copy does not know yet would be re-filed under «No supplier». It waits for the server's first
// answer about the ingredients AND the suppliers, or, with no signal (or none after COPY_WAIT_MS), opens what this phone has.
// «This ingredient no longer exists» is said only on the server's word (or after that wait).
//
// ⚠️ AN ITEM THAT LEAVES THE LIST WHILE ITS CARD IS OPEN (deleted on another phone) KEEPS THE CARD ON SCREEN: it holds the
// person's typing, and Save puts the item back (as the supplier card does).
type Props = {
  id: string | null;
  // A new item opened from the Packaging tab.
  packaging: boolean;
  // The supplier a NEW item starts on (opened from that supplier's screen).
  preset: string | null;
};

export function IngredientCardScreen({ id, packaging, preset }: Props) {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const store = useSuppliersStore();
  const snapshot = useSuppliers();
  const handBack = useHandBack();
  const deletions = useIngredientDeletions();
  const { canManage, location } = useSession();
  const mayPrice = useMayWritePrices();
  const money = useMoney();
  const [runDelete, deleteDialog, counting] = useDeleteIngredient();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const noTitle = useRef<HTMLHeadingElement>(null);
  const language = outputLanguage(location) ?? 'en';

  const item = id === null ? null : snapshot.ingredients.find(candidate => candidate.id === id) ?? null;
  const waited = useCopyWait(id === null
    ? snapshot.suppliersLoaded
    : (snapshot.ingredientsFromServer && snapshot.suppliersFromServer) || snapshot.ingredientsBroken || snapshot.suppliersBroken);
  // ⚠️ AN EXISTING ITEM'S CARD OPENS ONLY ONCE THE SUPPLIERS HAVE ARRIVED (the server's answer, or a copy that holds some): with
  // none, the supplier it is filed under is unknown and an untouched Save would re-file it under «No supplier». A broken
  // suppliers stream shows the «could not load» panel instead.
  const itemReady = id === null ? waited : item !== null && waited && snapshot.suppliersLoaded && !snapshot.suppliersBroken;

  // ⚠️ A PRICE WRITER'S CARD OPENS ONLY ONCE THE ITEM'S PRICE IS KNOWN (parity C28): the card copies the item once, and Save
  // writes the price it holds — a card opened on a list that has not heard the prices yet would show an empty price and an
  // untouched Save would write «no price» over the real one. Until the SERVER has answered the prices, the card reads its own
  // price document first; if that fails the card does not open at all.
  const needsPriceRead = id !== null && mayPrice && !snapshot.pricesFromServer;
  const [priceRead, setPriceRead] = useState<{ readonly id: string; readonly doc: Record<string, unknown> | null; readonly failed: boolean } | null>(null);
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!needsPriceRead || !itemReady || id === null || asked.current === id) return;
    asked.current = id;
    store.readPrice(id).then(
      doc => { setPriceRead({ id, doc, failed: false }); },
      (error: unknown) => {
        console.error('Reading the ingredient price failed:', error);
        setPriceRead({ id, doc: null, failed: true });
      },
    );
  }, [needsPriceRead, itemReady, id]);
  const read = priceRead !== null && priceRead.id === id ? priceRead : null;
  const priceFailed = needsPriceRead && itemReady && read?.failed === true;
  const canOpen = itemReady && (!needsPriceRead || (read !== null && !read.failed));
  const cardItem = item !== null && needsPriceRead && read !== null && !read.failed ? itemWithPrice(item, read.doc) : item;

  // The id whose card has been shown: an item that leaves the list afterwards is not «gone» for this screen.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && id !== null && shownFor !== id) setShownFor(id);
  // ⚠️ THE KIND IS TAKEN ONCE, WHEN THE CARD OPENS: a packaging item deleted on another phone while its card is open must not
  // turn into an ingredient (and be saved as one).
  const [kindShown, setKindShown] = useState<{ readonly id: string; readonly kind: CardKind } | null>(null);
  if (canOpen && id !== null && kindShown?.id !== id) setKindShown({ id, kind: kindFor(item, packaging) });
  const kind: CardKind = id !== null && kindShown?.id === id ? kindShown.kind : kindFor(item, packaging);
  const hasForm = canOpen || (id !== null && shownFor === id);
  const broken = !hasForm && (snapshot.suppliersBroken || (id !== null && snapshot.ingredientsBroken));
  const cannotOpen = !hasForm && !broken && priceFailed;
  const gone = !hasForm && !broken && id !== null && item === null && snapshot.ingredientsLoaded && waited && !deletions.has(id);
  const waiting = !hasForm && !gone && !broken && !cannotOpen;

  // ── Where Back goes ──────────────────────────────────────────────────────────────────────────────────────────
  // One level up: the list the card was opened from (the row, or «New …», takes the focus back), or the supplier's own screen
  // it was opened from (the row there, or «Add ingredient»). Opened by its address, there is nothing behind it: it replaces
  // itself with the tab it belongs to.
  const supplierOrigin = supplierScreenOf(state);
  const kindTab = kind === 'packaging' ? 'packaging' : 'ingredients';
  const fallback = tabPath(tabOfState(state) ?? kindTab);
  const owed = (afterDelete: boolean) => {
    if (supplierOrigin !== null) {
      handBack.wantOn(supplierOrigin, afterDelete || id === null ? ADD_INGREDIENT_OPENER : supplierItemOpener(id));
    } else {
      // ⚠️ AFTER A DELETE THE FOCUS GOES TO THE SEARCH BOX, never to the deleted item's own row.
      handBack.expect(afterDelete ? SEARCH_OPENER : id === null ? NEW_OPENER : itemOpener(id));
    }
  };
  const leave = useLeave(fallback, () => { owed(false); }, cameFromListOrSupplierScreen);
  const leaveAfterDelete = useLeave(fallback, () => { owed(true); }, cameFromListOrSupplierScreen);

  useEffect(() => {
    if (!gone) return;
    say(t('sup.ingredientGone'));
    void navigate(fallback, { replace: true, state: KEEP_FOCUS });
  }, [gone]);

  // Opened from a tap, the page does not move the focus: it goes to this title. Not on a POP (Back arriving here again).
  useEffect(() => {
    if (waiting || gone || broken || cannotOpen) return;
    if ((cameFromList(state) || supplierOrigin !== null) && navigationType !== 'POP') title.current?.focus();
  }, [waiting, gone, broken, cannotOpen]);

  const packs = useMemo(
    () => packChoices({ ingredients: snapshot.ingredients, language, current: item?.packUnit }),
    [snapshot.ingredients, language, item],
  );
  // The card of before's «Order unit» menu: the venue's order units, and the one this item holds.
  const orderUnits = useMemo(
    () => unitChoices({ ingredients: snapshot.ingredients, language, current: item?.unit }),
    [snapshot.ingredients, language, item],
  );

  if (broken) {
    return (
      <section className={styles.waiting} aria-labelledby={titleId}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('sup.tab.ingredients')} titleId={titleId} titleRef={title} />
        <p className={styles.failed}>{t('sup.loadFailed')}</p>
      </section>
    );
  }
  if (cannotOpen) {
    return (
      <section className={styles.waiting} aria-labelledby={titleId}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('sup.tab.ingredients')} titleId={titleId} titleRef={title} />
        <p className={styles.failed}>{t('sup.price.openFailed')}</p>
      </section>
    );
  }
  if (waiting || gone) {
    return (
      <section className={styles.waiting} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  return (
    <>
      <IngredientCard
        key={id ?? 'new'}
        item={cardItem}
        kind={kind}
        preset={preset}
        suppliers={snapshot.suppliers}
        categories={store.categories(language)}
        packs={packs}
        orderUnits={orderUnits}
        language={language}
        mayPrice={mayPrice}
        country={location?.country}
        money={money}
        readHistory={store.readPriceHistory}
        titleRef={title}
        onSave={(payload, options) => {
          const saved = store.saveIngredient(id, payload, options);
          announceAction('ingredient-saved');
          if (saved.priceRecorded) announceAction('price-saved');
          say(t(kind === 'packaging' ? 'sup.packagingSaved' : 'sup.ingredientSaved'));
        }}
        onLeave={leave}
        deleting={counting}
        onDelete={canManage && item !== null && id !== null
          ? markClean => runDelete({ id, name: ingredientDisplayName(item) }, () => { markClean(); leaveAfterDelete(); })
          : undefined}
        // ⚠️ THE MERGE DOOR IS FOR A PRICE WRITER OF AN EXISTING INGREDIENT (parity I117); the card itself draws it for an ingredient only.
        onMerge={mayPrice && item !== null && id !== null
          ? () => { void navigate(ingredientMergePath(id), { state: fromCard(state) }); }
          : undefined}
        renderNewSupplier={host => <SupplierCard id={null} supplier={null} titleRef={noTitle} host={host} />}
        watchRefusedSupplier={listener => store.onMessage(message => {
          if (message.kind === 'supplier-not-saved') listener(message.name);
        })}
      />
      {deleteDialog}
    </>
  );
}
