import { useContext, useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { draftFromRecipe } from '@mise/shared/foodcost-model';
import type { Product } from '@mise/shared/foodcost-model';
import { useT } from '../i18n/useT';
import { FormBar } from '../ui/FormBar';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import { useCopyWait } from './copyWait';
import { FOODCOST_PATH, productPath, usingPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { ScrollTopContext, useBackToRecipe, useLeave, wantsTitleFocus } from './foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from './handBack';
import { ProductForm } from './ProductForm';
import { waitsForTables } from './productEditorModel';
import { ProductRead, summaryShows } from './ProductRead';
import { useProductExit } from './useProductExit';
import styles from './ProductEditor.module.css';

// What is on screen for one product: its READ view or the FORM. `fromRead`: the form was opened with the pencil from the read view
// of the same product, so Back returns to it.
type Mode = { id: string | null; edit: boolean; fromRead: boolean };

// The product's own screen: a product by its address, or a new one.
//
// ⚠️ A PRODUCT OPENS TO READ (Federico, 7 Nov 2026; current app 18679a38): the summary and a closed «Full card» of plain text; the
// pencil turns the same product into the form, on a copy; Save returns to the read view of the saved product (a new one gets its
// own address), Back from a form opened by the pencil returns to the read view. A NEW product, and a product with nothing costed
// yet (there is no summary to read), open straight in the form, as in the current app. The choice is made ONCE per product on
// screen — the data arriving afterwards never swaps a form for a read view under somebody's fingers.
//
// ⚠️ THREE THINGS THIS FILE KEEPS FROM THE PLACEHOLDER IT REPLACED:
//  - a product address WAITS for the first answer of the server (`productsFromServer`) before it
//    says the product no longer exists — a local copy can be a stale partial one;
//  - the section does NOT remount this component when the split goes from one product to another
//    (that would take the focus off the row that was pressed), so it follows `id` itself: the form
//    below is keyed on the id, and a form copies its product once, when it mounts;
//  - Back hands the focus to the button that opened it (`handBack`).
export function ProductEditor({ id, origin }: { id: string | null; origin: Origin }) {
  const { t } = useT();
  const { state } = useLocation();
  const navigate = useNavigate();
  const { products, productsFromServer, recipes, recipesFromServer, recipesLoaded, ingredientsLoaded, tables } = useFoodcost();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const product = id === null ? null : products.find(candidate => candidate.id === id) ?? null;

  // A NEW product opened from a recipe is prefilled from it (draftFromRecipe). ⚠️ It waits for the recipe
  // like a product address waits for its product: the recipe in the store's recipes, or the server's word
  // that there is none, or the deadline. A recipe still missing then is a plain empty new product.
  const draftFor = id === null ? origin.recipe : null;
  const recipeHere = draftFor !== null && recipes[draftFor] !== undefined;

  // ⚠️ AN EXISTING PRODUCT OPENS ON THE SERVER'S WORD, NOT ON THE LOCAL COPY ALONE (review finding):
  // the form copies its product ONCE and Save writes it WHOLE, so a form opened from a copy a week
  // old would write last week's price and lines back over another phone's changes. It waits for the
  // server's first answer — or, with no signal (or none after COPY_WAIT_MS), opens what this phone has.
  const answered = useCopyWait(id === null ? draftFor === null || recipeHere || recipesFromServer : productsFromServer);
  // A product just saved from the form of a NEW one is on screen at once: it was written here, nothing older can be on this phone.
  const [justSaved, setJustSaved] = useState<string | null>(null);
  // Another product picked (the split keeps this component): the one just saved is no longer forced to read when it comes back.
  // (Also New → Back: the id changes to anything but the product just saved.)
  const [lastId, setLastId] = useState<string | null>(id);
  if (id !== lastId) {
    setLastId(id);
    if (justSaved !== null && justSaved !== id) setJustSaved(null);
  }
  // ⚠️ A LEGACY PRODUCT WITH RECIPE LINES OPENS ONLY ONCE THE RECIPES AND THE PRICES ARE IN (ingredientsLoaded already means with
  // their prices): it is converted with them, and opened on unconverted lines — the form copies once, Save writes them as raw
  // kilos — would write a cost too low for ever. NO TIMEOUT: the store sets both flags even when a stream fails, so this cannot hang.
  const canOpen = product !== null && (answered || justSaved === id)
    && (!waitsForTables(product) || (recipesLoaded && ingredientsLoaded));
  const draftWaiting = draftFor !== null && !answered;
  // ⚠️ DECIDED ONCE: a recipe that arrives after the form opened plain must not swap the form for a
  // prefilled one (the key would change and what was typed would be lost).
  const [draftSeen, setDraftSeen] = useState<ReturnType<typeof draftFromRecipe> | undefined>(undefined);
  if (draftFor !== null && answered && draftSeen === undefined) setDraftSeen(draftFromRecipe(recipes[draftFor]));
  const draft = draftSeen ?? null;
  // The origin the form is drawn with: a recipe that turned out not to exist leaves a plain new product.
  const formOrigin = draftFor !== null && draft === null ? { recipe: null, using: null } : origin;

  // The id whose form has been shown. A product that leaves the list while its form is open (deleted
  // on another phone) keeps the form on screen: the form decides what to do about it, because only it
  // knows whether anything was typed.
  const [shownFor, setShownFor] = useState<string | null>(null);
  if (canOpen && shownFor !== id) setShownFor(id);

  // Waiting for the server: neither the screen of a product nor the sentence that it is gone.
  const hasForm = id === null || canOpen || shownFor === id;

  // The last version of the product seen in the list: the read view of a product deleted elsewhere keeps drawing it while it says so.
  const [seen, setSeen] = useState<Product | null>(null);
  if (product !== null && product !== seen) setSeen(product);
  const lastSeen = product ?? (seen !== null && seen.id === id ? seen : null);

  // Read or form, decided once for the id on screen.
  const [chosen, setChosen] = useState<Mode | null>(null);
  // ⚠️ A PRODUCT JUST SAVED FROM THE FORM OF A NEW ONE is read even with nothing costed (the current app forces it): the id arrives
  // with the new address, a render after the save, and the choice made for "no id yet" must not decide for it.
  const mode: Mode | null = chosen !== null && chosen.id === id
    ? chosen
    : !hasForm ? null
      : justSaved !== null && justSaved === id ? { id, edit: false, fromRead: false }
        : { id, edit: id === null || product === null || !summaryShows(product, tables), fromRead: false };
  if (mode !== null && mode !== chosen) setChosen(mode);

  // The focus follows a switch the person made (the pencil, Save, Back from the form): to the new view's own title.
  const switched = useRef(false);
  const scrollToTop = useContext(ScrollTopContext);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    // The other view starts at the top (the current app's swap()), whatever the one before was scrolled to.
    scrollToTop();
    title.current?.focus();
  }, [mode?.edit, mode?.id]);
  const edit = () => {
    if (product === null) return;
    switched.current = true;
    setChosen({ id, edit: true, fromRead: true });
  };
  const backToRead = () => {
    switched.current = true;
    setChosen({ id, edit: false, fromRead: false });
  };
  // Saved: the read view of the saved product takes the form's place. A new product has no address yet — it gets its own, replacing
  // the new-product entry, so Back still goes to the list and a reload comes back to the product.
  const saved = (savedId: string) => {
    switched.current = true;
    setJustSaved(savedId);
    if (id === null) void navigate(productPath(savedId, formOrigin), { replace: true, state });
    else setChosen({ id, edit: false, fromRead: false });
  };
  // ⚠️ A FIRST SAVE STILL IN THE AIR keeps a product that is missing from the list «loading», never «gone»: a stale snapshot (a cold
  // start queued one before the write) lacks it for a moment and the next one puts it back.
  const store = useFoodcostStore();
  const firstSave = id === null ? null : store.firstSave(id);
  const gone = !hasForm && product === null && productsFromServer && firstSave !== 'sending';

  // ⚠️ A FIRST SAVE REFUSED BEFORE ITS PRODUCT WAS EVER DRAWN (the store took it back, or the stream did, in the render between the
  // save and the new address): there is no read view to say so and nothing to wait for. The store has said «… wasn't saved»; the
  // person goes to the list, like the current app.
  const { leave } = useProductExit(id, formOrigin);
  const refusedBeforeShown = justSaved !== null && justSaved === id && !hasForm && product === null && firstSave === 'refused';
  const left = useRef(false);
  useEffect(() => {
    if (!refusedBeforeShown || left.current) return;
    left.current = true;
    leave();
  }, [refusedBeforeShown, leave]);
  const waiting = draftWaiting || (!hasForm && !gone);
  const shown = !waiting;

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only
  // when the screen first appears — picking another product beside it (the split) keeps the focus on
  // the row that was pressed.
  useEffect(() => {
    if (shown && wantsTitleFocus(state)) title.current?.focus();
  }, [shown]);

  if (waiting) {
    return (
      <section className={styles.editor} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  if (gone) return <Gone titleId={titleId} titleRef={title} id={id} origin={origin} />;

  if (mode !== null && !mode.edit && lastSeen !== null && id !== null) {
    return (
      <ProductRead
        key={id}
        id={id}
        product={lastSeen}
        gone={product === null}
        origin={formOrigin}
        titleRef={title}
        onEdit={edit}
      />
    );
  }

  return (
    <ProductForm
      key={id ?? `new:${draft?.components[0]?.recipeId ?? ''}`}
      id={id}
      product={product}
      draft={draft}
      origin={formOrigin}
      titleRef={title}
      onSaved={saved}
      onBackToRead={mode?.fromRead ? backToRead : null}
    />
  );
}

// A product address whose product is not among the products, once the server has said so.
function Gone({ titleId, titleRef, id, origin }: { titleId: string; titleRef: Ref<HTMLHeadingElement>; id: string | null; origin: Origin }) {
  const { t } = useT();
  const handBack = useHandBack();
  const leave = useLeave(origin.using === null ? FOODCOST_PATH : usingPath(origin.using), () => {
    handBack.expect(id === null ? NEW_OPENER : productOpener(id));
  }, origin.using !== null);
  const backToRecipe = useBackToRecipe(origin.recipe);
  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={origin.recipe === null ? leave : backToRecipe}
        title={t('fc.productGone')}
        titleId={titleId}
        titleRef={titleRef}
      />
    </section>
  );
}
