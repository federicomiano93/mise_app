import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { Archive, ArchiveRestore, ChartPie, Copy, Download, Import, Maximize2, Pencil, Trash2, Undo2 } from 'lucide-react';
import { batchWarning, calculatorRefusal, formatWeight, hasDividerAfter, importFailureKey, scaleFromRow, unitOf, weighableTotalGrams } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe, RowScaleResult } from '@mise/shared/catalogue-model';
import { FROM_RECIPE_LINK, foodCostForRecipePath, mayOpenFoodCost, mayOpenOrders, ordersForIngredientPath } from '@mise/shared/recipe-link';
import { orderTargetOf, rowKeysOf, splitAmount, splitBlockReason } from '@mise/shared/row-actions-model';
import { isArchivedRecipe } from '@mise/shared/recipe-shelf';
import { isSectionAllowed } from '@mise/shared/sections';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { useExportSheet } from '../ui/ExportSheet';
import { FormBar } from '../ui/FormBar';
import { RecipeFullScreen } from '../ui/RecipeFullScreen';
import { KEEP_FOCUS } from '../shell/Page';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { CATALOGUE_ZOOM_KEY } from '../ui/zoomStorage';
import { AllergenCard } from './AllergenCard';
import { BatchCard } from './BatchCard';
import { DeclarationCard } from './DeclarationCard';
import { ProcedureCard } from './ProcedureCard';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { amountNumber, amountText, recipeAmounts, unitWord, wholeNumber } from './recipeAmounts';
import { recipeExportModel } from './recipeExportModel';
import { resolveScale } from './recipeScale';
import type { RecipeScale } from './recipeScale';
import { FromRowDialog } from './FromRowDialog';
import { useRecipeReturn } from './recipeReturn';
import { duplicateWorking } from './editorModel';
import { RowMenu } from './RowMenu';
import type { RowMenuItem } from './RowMenu';
import { FROM_DUPLICATE, carryOwner, handOver } from './photoCarry';
import { FROM_RECIPE, cameFromList, cameFromSheet } from './recipesNav';
import { NEW_PATH, editPath } from './recipesPath';
import { useDeleteRecipe } from './useDeleteRecipe';
import styles from './RecipeView.module.css';

type Props = {
  recipe: CatalogueRecipe;
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// One recipe: the bar with Back and its name, then the cards in this order (his decisions, 14-15 Oct 2026): the
// ingredient list, the batch, «Food cost» (a door, only for whoever may open Food cost), the allergens and the
// declaration, the mixing procedure (3d-8), then Export, then «Import into Calculator» with its hint (a write, only where
// the venue uses the Calculator), then «Duplicate» with its hint (whoever may start a recipe), and last the small Delete icon.
//
// «Edit» is the bar's one action, for everybody who sees the section (employees write recipes too). Delete is a small
// icon at the very end of the page, for whoever runs the place only.
//
// ⚠️ THE TWO ALLERGEN CARDS FOLLOW THE LIVE DATA ON THEIR OWN (they read the store), so an ingredient
// declared on another phone reaches this screen without it being closed and reopened.
//
// It is keyed on the recipe's id by the caller, so a batch typed for one recipe never carries over
// to another; a live change of the SAME recipe redraws it in place and keeps what is typed.
export function RecipeView({ recipe, titleRef, onBack }: Props) {
  const { t } = useT();
  const store = useRecipesStore();
  // Read for its side effect: a batch set or cleared changes the snapshot, and this redraws.
  useRecipes();
  const titleId = useId();
  // The batch the recipe is shown at: a total typed in the batch box, or one worked out from an ingredient (that row named, and
  // shown exactly as typed). Every card below reads this ONE answer, so the table, the box, the export and «Use as base recipe» agree.
  const scale = resolveScale(recipe, store.scaledTarget(recipe.id), store.scaledBy(recipe.id));
  const target = scale?.target ?? null;
  const row = scale?.row ?? null;
  const hasWeight = weighableTotalGrams(recipe) > 0;
  const { canManage, location, role } = useSession();
  // Who may change this recipe: everybody who sees the section (employees write recipes too, step 3d-6), so the pencil is drawn
  // for all of them. ONE flag for every way of changing the recipe from this screen — «Edit» and «Use as base recipe».
  const canEdit = true;
  const navigate = useNavigate();
  const { state } = useLocation();
  const recipeReturn = useRecipeReturn();
  const [runDelete, deleteDialog] = useDeleteRecipe();
  const editButton = useRef<HTMLButtonElement>(null);
  const say = useStatusMessage();
  const [confirm, archiveDialog] = useConfirm();
  const archived = isArchivedRecipe(recipe);
  const asking = useRef(false);
  const restoreButton = useRef<HTMLButtonElement>(null);
  // Where the focus goes once the page has redrawn with the flag moved: «Restore» after an archive (it replaces the button
  // that was just tapped), the recipe's title after a restore (nobody is thrown to the foot of the page).
  const focusAfter = useRef<'restore' | 'title' | null>(null);

  useLayoutEffect(() => {
    const wanted = focusAfter.current;
    if (wanted === null) return;
    focusAfter.current = null;
    const target = wanted === 'restore' && restoreButton.current !== null ? restoreButton.current : document.getElementById(titleId);
    if (target === null) return;
    target.focus({ preventScroll: true });
    // The closing dialog hands the focus back to the button that opened it, which is gone: once more after it has done so.
    requestAnimationFrame(() => {
      if (target.isConnected && document.activeElement !== target) target.focus({ preventScroll: true });
    });
  }, [archived]);

  // ⚠️ THE PAGE STAYS OPEN. Archiving asks first; the store writes the flag alone, local-first, and says by itself when the
  // server refuses (and puts the recipe back). `false` = nothing moved: nothing more is done.
  async function archive() {
    if (asking.current) return;
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('cat.shelf.archiveTitle', { name: recipe.name }),
        message: t('cat.shelf.archiveMessage'),
        okLabel: t('cat.shelf.archiveOk'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      focusAfter.current = 'restore';
      if (!store.setArchived(recipe.id, true)) { focusAfter.current = null; return; }
      say(t('cat.shelf.archivedDone'));
    } finally {
      asking.current = false;
    }
  }

  // A restore asks nothing: nothing is lost.
  function restore() {
    focusAfter.current = 'title';
    if (!store.setArchived(recipe.id, false)) { focusAfter.current = null; return; }
    say(t('cat.shelf.restoredDone'));
  }

  // ⚠️ BACK FROM THIS RECIPE'S EDITOR the focus is on «Edit», where the person left (recipeReturn.ts); the recipe screen
  // then has nothing left to focus.
  useLayoutEffect(() => {
    if (!recipeReturn.pendingEdit(recipe.id) || editButton.current === null) return;
    editButton.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        title={recipe.name === '' ? t('cat.noName') : recipe.name}
        titleId={titleId}
        titleRef={titleRef}
        action={canEdit ? (
          <Button
            ref={editButton}
            variant="secondary"
            onPress={() => {
              recipeReturn.remember(recipe.id, 'edit');
              void navigate(editPath(recipe.id), { state: { ...FROM_RECIPE, recipeFromList: cameFromList(state) && !cameFromSheet(state) } });
            }}
          >
            <Pencil aria-hidden="true" />
            {t('ui.edit')}
          </Button>
        ) : undefined}
      />
      <div className={styles.body}>
        {archived ? <ArchivedBanner canManage={canManage} restoreRef={restoreButton} onRestore={restore} /> : null}
        <IngredientsCard recipe={recipe} scale={scale} />
        {/* A recipe of pieces and «to taste» has nothing to scale by weight: the whole card goes. */}
        {hasWeight ? <BatchCard recipe={recipe} target={target} row={row} canEdit={canEdit} /> : null}
        {/* ⚠️ A DOOR: drawn only for whoever Food cost lets in — the very question its own gate asks (shared recipe-link), asked on
            every draw, so a session that arrives late or changes venue redraws it. Absent, not disabled, for anyone else. */}
        {mayOpenFoodCost(location, canManage, role) ? <FoodCostCard recipe={recipe} /> : null}
        <AllergenCard recipe={recipe} />
        <DeclarationCard recipe={recipe} />
        {/* The mixing procedure (step 3d-8): after the declaration and before Export, the current app's order. */}
        <ProcedureCard recipe={recipe} target={target} />
        <ExportAction recipe={recipe} scale={scale} />
        {/* A WRITE, NOT A DOOR: judged by the venue's section only (the Calculator card being hidden from staff does not matter). */}
        {/* ⚠️ NOT ON AN ARCHIVED RECIPE: importing makes a NEW link, and an archived recipe is left out of those. */}
        {isSectionAllowed(location, 'calculator') && !archived ? <ImportAction recipe={recipe} /> : null}
        {/* «Duplicate» opens the new-recipe editor filled in from this one. Absent — not disabled — for whoever may not start a
            recipe (the gate of «New recipe» in the list: canManage). */}
        {canManage ? <DuplicateAction recipe={recipe} /> : null}
        {/* «Archive»: after Duplicate, before the Delete icon; whoever runs the place only, and only while it is not archived. */}
        {canManage && !archived ? <ArchiveAction onArchive={() => { void archive(); }} /> : null}
        {/* ⚠️ THE VERY END OF THE PAGE, after Export, Import and Duplicate: small, low-key, icon only. Absent — not disabled —
            for an employee. */}
        {canManage ? (
          <button
            type="button"
            className={styles.deleteIcon}
            aria-label={t('cat.deleteRecipe')}
            title={t('cat.deleteRecipe')}
            onClick={() => { void runDelete({ id: recipe.id, name: recipe.name }, onBack); }}
          >
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {deleteDialog}
      {archiveDialog}
    </section>
  );
}

// The calm notice at the top of an archived recipe: neutral colours (red, amber and green mean danger, check and done), what it
// means in one sentence, and — for whoever may — the one tap that puts the recipe back. Employees read it without the button.
function ArchivedBanner({ canManage, restoreRef, onRestore }: { canManage: boolean; restoreRef: Ref<HTMLButtonElement>; onRestore: () => void }) {
  const { t } = useT();
  const headingId = useId();
  return (
    <section className={styles.banner} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.bannerTitle}>
        <Archive aria-hidden="true" />
        {t('cat.shelf.bannerTitle')}
      </h3>
      <p className={styles.bannerText}>{t('cat.shelf.bannerText')}</p>
      {canManage ? (
        <button ref={restoreRef} type="button" className={styles.importAction} onClick={onRestore}>
          <ArchiveRestore aria-hidden="true" />
          {t('cat.shelf.restore')}
        </button>
      ) : null}
    </section>
  );
}

// «Archive» with its one-line hint, laid out like «Duplicate».
function ArchiveAction({ onArchive }: { onArchive: () => void }) {
  const { t } = useT();
  const hintId = useId();
  return (
    <div className={styles.importBlock}>
      <button type="button" className={styles.importAction} aria-describedby={hintId} onClick={onArchive}>
        <Archive aria-hidden="true" />
        {t('cat.shelf.archive')}
      </button>
      <p id={hintId} className={styles.note}>{t('cat.shelf.archiveHint')}</p>
    </div>
  );
}

// «Export» as PDF or Excel: ⚠️ AT THE END OF THE PAGE (then Import, Duplicate and the Delete icon, which is the very last),
// by Federico's choice (14 Oct 2026, «non è un'azione che si fa tutti i giorni»). Under the ingredient table it pushed the
// batch box — what this screen is opened for — further down. The file is made by recipeAmounts() from the same recipe, batch target and locale the table is drawn with, so
// it holds the very amounts on screen. Nothing to export without ingredients.
function ExportAction({ recipe, scale }: { recipe: CatalogueRecipe; scale: RecipeScale | null }) {
  const target = scale?.target ?? null;
  const row = scale?.row ?? null;
  const { t, locale } = useT();
  const [openExport, exportSheet, closeExport] = useExportSheet();

  // ⚠️ THE EXPORT SHEET HOLDS A COPY of the amounts drawn when Export was tapped: a recipe that changes under it
  // (a live update) or a batch target that is applied or cleared closes it, so no stale file is downloaded.
  useEffect(() => { closeExport(); }, [recipe, target, row?.index, row?.amount, closeExport]);

  if (recipe.ingredients.length === 0) return null;
  return (
    <>
      <button
        type="button"
        className={styles.export}
        onClick={() => {
          openExport({ model: recipeExportModel(recipe, recipeAmounts(recipe, target, t, locale, row)), totalLabel: t('cat.total') });
        }}
      >
        <Download aria-hidden="true" />
        {t('export.button')}
      </button>
      {exportSheet}
    </>
  );
}

// «Open in Food cost»: a card like the others, with the one button. It hands Food cost the recipe in the address and
// says in the navigation state that this recipe screen is the history entry behind it (Food cost's Back then steps
// to it instead of piling a second copy on).
function FoodCostCard({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const navigate = useNavigate();
  const recipeReturn = useRecipeReturn();
  const headingId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const path = foodCostForRecipePath(recipe.id);

  // ⚠️ BACK FROM FOOD COST the recipe comes back as it was left: the focus on this button and the scroll where it was
  // (recipeReturn.ts); the recipe screen then has nothing left to focus.
  useLayoutEffect(() => {
    if (!recipeReturn.pendingCost(recipe.id) || button.current === null) return;
    recipeReturn.restoreScroll(recipe.id);
    button.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);
  // ⚠️ AGAIN AFTER THE SHELL'S OWN RESET: the shell puts its scroll area back at the top when the section changes, in an
  // effect that runs after this card's. With the recipe already in the store (no wait for the data) that reset would win,
  // so the place is put back once every effect of this commit is done.
  useEffect(() => {
    if (recipeReturn.pendingCost(recipe.id)) queueMicrotask(() => { recipeReturn.restoreScroll(recipe.id); });
  }, []);

  if (path === null) return null;
  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.cardHead}>{t('cat.fc.title')}</h3>
      <p className={styles.note}>{t('cat.fc.note')}</p>
      <Button
        ref={button}
        variant="secondary"
        onPress={() => {
          recipeReturn.remember(recipe.id, 'cost');
          void navigate(path, { state: FROM_RECIPE_LINK });
        }}
      >
        <ChartPie aria-hidden="true" />
        {t('cat.fc.open')}
      </Button>
    </section>
  );
}

// «Import into Calculator» (from importRecipe of js/catalogue/catalogue-main.js, which COPIES; owner's decision, 18 Oct 2026:
// here it LINKS, so the Calculator follows the recipe): nothing to do for a recipe with no rows, a refusal that names the
// row for one the grams-only Calculator cannot follow, otherwise one question, then the transaction of the store. The
// answer is said in the section's status message.
//
// ⚠️ THE REFUSAL ASKS THE VERY FUNCTION THE CALCULATOR WILL ASK (`resolveRecipe` on a tab linked to this recipe): a linked
// tab with ANY row that is not in grams (pieces, spoons, «to taste», or 0 g) calculates nothing — decided 1 Aug 2026,
// because a dough quietly light by one ingredient is the one direction a recipe must not be wrong in. So the link is not
// made at all, rather than made into a tab that only says «cannot calculate».
//
// ⚠️ A SECOND TAP DURING THE QUESTION OR THE WRITE IS IGNORED, and markBusy is held until the store's promise has settled
// — NOT until this component goes away: the person can leave the recipe while the transaction is in the air, and a reload
// the app starts by itself must still wait for it. The button says it is busy meanwhile (aria-busy, and aria-disabled
// rather than the disabled attribute, so a keyboard user's focus stays on it).
function ImportAction({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const running = useRef(false);
  const [writing, setWriting] = useState(false);
  const hintId = useId();

  async function run() {
    if (running.current) return;
    const refusal = calculatorRefusal(recipe);
    if (refusal !== null) {
      say(refusal.kind === 'empty' ? t('cat.nothingToImport') : t(refusal.kind === 'noAmount' ? 'cat.rowNoAmount' : 'cat.rowNotByWeight', { row: refusal.row }));
      return;
    }
    running.current = true;
    try {
      const ok = await confirm({
        title: t('cat.importIntoCalculator2'),
        message: t('cat.linkIntoCalculator', { name: recipe.name }),
        okLabel: t('ui.import'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
      setWriting(true);
      const release = markBusy();
      try {
        const action = await store.importIntoCalculator(recipe, t('calc.marketOrderTitle'));
        say(t(action === 'already' ? 'cat.alreadyLinkedToCalculator' : action === 'updated' ? 'cat.nowFollowedByCalculator' : 'cat.linkedToCalculator', { name: recipe.name }));
      } catch (err) {
        console.error('Import into Calculator failed:', err);
        say(t(importFailureKey(err)));
      } finally {
        release();
        setWriting(false);
      }
    } finally {
      running.current = false;
    }
  }

  return (
    <div className={styles.importBlock}>
      <button
        type="button"
        className={styles.importAction}
        aria-describedby={hintId}
        aria-busy={writing || undefined}
        aria-disabled={writing || undefined}
        onClick={() => { void run(); }}
      >
        <Import aria-hidden="true" />
        {t('cat.importIntoCalculator')}
      </button>
      <p id={hintId} className={styles.note}>{t('cat.linksToCalculator')}</p>
      {confirmDialog}
    </div>
  );
}

// «Duplicate»: a copy of this recipe becomes the working copy of the NEW-recipe editor, which opens at once, DIRTY. Nothing is
// saved here — the person names it, changes what they want and saves, as for any new recipe. The copy travels in the hand-over
// the photo reader uses (photoCarry.ts), stamped for this person and venue and marked as a duplicate. ⚠️ What a copy takes
// and what it must never take (the original's id above all) is duplicateWorking's whitelist in editorModel.ts.
function DuplicateAction({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { user, locationId } = useSession();
  const { categories } = useRecipes();
  const recipeReturn = useRecipeReturn();
  const hintId = useId();
  const button = useRef<HTMLButtonElement>(null);
  // A second tap before the editor has opened must not push a second /recipes/new entry.
  const opening = useRef(false);

  // ⚠️ BACK FROM THE COPY'S EDITOR the focus is on this button, where the person left (recipeReturn.ts).
  useLayoutEffect(() => {
    if (!recipeReturn.pendingDuplicate(recipe.id) || button.current === null) return;
    button.current.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);

  return (
    <div className={styles.importBlock}>
      <button
        ref={button}
        type="button"
        className={styles.importAction}
        aria-describedby={hintId}
        onClick={() => {
          if (opening.current) return;
          opening.current = true;
          recipeReturn.remember(recipe.id, 'duplicate');
          handOver(duplicateWorking(recipe, name => t('cat.copyOf', { name }), categories), carryOwner(user?.uid, locationId), undefined, 'duplicate');
          void navigate(NEW_PATH, { state: FROM_DUPLICATE });
        }}
      >
        <Copy aria-hidden="true" />
        {t('cat.duplicate')}
      </button>
      <p id={hintId} className={styles.note}>{t('cat.duplicateHint')}</p>
    </div>
  );
}

// The ingredient list: each row's label and its amount in two aligned columns (numbers right-aligned,
// units left-aligned), whole numbers, «to taste» with no number, and a Total of the weighable rows.
// A batch applied shows the SCALED amounts.
//
// ⚠️ A TAP ON A ROW OPENS THE ROW'S MENU, NEVER THE FULL SCREEN (Federico, 31 Oct and 6 Nov 2026: a tap anywhere on the recipe
// zoomed it, and he wants to split an ingredient that does not fit the bowl and to order it from the recipe; the current app's
// 70325def). The full screen opens from the button in the card's head ONLY. The ingredient's name is the button (RowMenu) and a
// tap anywhere else on the row presses it, so the table stays a table for a screen reader.
//
// «Split into 2 parts» is DISPLAY ONLY: nothing is saved, the export is made from the same amounts, and the rows split are kept by
// their row key (shared/row-actions-model), so a live change that adds a row above one leaves it split.
// «Order» opens Orders on that ingredient's supplier (the Orders section, with the recipe in the address), and Back there returns
// here with the same row focused, the scroll where it was and the splits still shown (recipeReturn.ts, origin 'order').
// «Calculate from this ingredient» (Mise 2 only, 14 Nov 2026) asks «How much {name} do you want?» (FromRowDialog) and scales the
// whole recipe by (typed ÷ the row's amount): the row shows exactly what was typed, the batch box the new total, and a line under the
// table says which ingredient the batch was worked out from, with Undo back to the base recipe. The batch is remembered on this
// device like the box's (the store's `catalogue-scaled`, with the row's key), so the full screen, the export and «Use as base
// recipe» all read it. Offered for everybody (it only changes what is shown), and only on a row it can work from: a row with an
// amount (not 0, not «to taste») in a recipe that has something to weigh.
function IngredientsCard({ recipe, scale }: { recipe: CatalogueRecipe; scale: RecipeScale | null }) {
  const { t, locale } = useT();
  const { canManage, location, role } = useSession();
  const { ingredients, suppliers } = useRecipes();
  const store = useRecipesStore();
  const target = scale?.target ?? null;
  const fromRow = scale?.row ?? null;
  // The row whose «How much … do you want?» is open, by its place and its key.
  const [asking, setAsking] = useState<{ index: number; key: string } | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  // The row button owed the focus once the dialog (or the louder question) has closed: the menu item that opened it is gone.
  const focusRow = useRef<string | null>(null);
  const navigate = useNavigate();
  const recipeReturn = useRecipeReturn();
  const headingId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const [fullScreen, setFullScreen] = useState(false);
  // What a trip to Orders left behind, read once when the card is first drawn.
  const [back] = useState(() => recipeReturn.pendingOrder(recipe.id));
  const [splitKeys, setSplitKeys] = useState<ReadonlySet<string>>(() => new Set(back?.split ?? []));
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const amounts = recipeAmounts(recipe, target, t, locale, fromRow);
  const { rows, total } = amounts;
  const keys = rowKeysOf(recipe.ingredients);
  // ⚠️ Asked on every draw (the venue and the role can arrive late), the very question Orders' own gate asks.
  const mayOrder = mayOpenOrders(location, canManage, role);

  // ⚠️ BACK FROM ORDERS the recipe comes back as it was left: the focus on the row that opened the menu and the scroll where it was
  // (recipeReturn.ts); the recipe screen then has nothing left to focus.
  useLayoutEffect(() => {
    if (back === null) return;
    recipeReturn.restoreScroll(recipe.id);
    // ⚠️ Delivered only when a button took the focus: the row may be gone (deleted on another phone during the trip), and then the
    // screen's own title must still take it.
    const button = buttons.current.get(back.row);
    if (button === undefined) return;
    button.focus({ preventScroll: true });
    recipeReturn.markDelivered();
  }, []);
  // ⚠️ AGAIN AFTER THE SHELL'S OWN RESET, as the Food cost card does (the shell puts its scroll area at the top in an effect that
  // runs after this card's).
  useEffect(() => {
    if (back !== null) queueMicrotask(() => { recipeReturn.restoreScroll(recipe.id); });
  }, []);

  // ⚠️ THE FOCUS GOES BACK ONLY ONCE THE DIALOG IS CLOSED. While a modal <dialog> is open everything
  // outside it is inert and focus() on the opener does nothing; the dialog closes itself first
  // (ui/RecipeFullScreen), and this effect runs after it has been taken away.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !fullScreen && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    wasOpen.current = fullScreen;
  }, [fullScreen]);

  // The things a row's menu can do. The «Order» judgement is asked again when the item is chosen, not only when the menu was
  // drawn: the ingredients and suppliers may have changed meanwhile.
  function itemsFor(index: number): RowMenuItem[] {
    const ing = recipe.ingredients[index];
    const isSplit = splitKeys.has(keys[index] ?? '');
    const blocked = splitBlockReason(amounts.values[index], unitOf(ing));
    // A row that is already split can always be put back, whatever its amount has become.
    const canToggle = isSplit || blocked === null;
    const items: RowMenuItem[] = [{
      id: 'split',
      text: t(isSplit ? 'cat.split.undo' : 'cat.split.do'),
      disabled: !canToggle,
      ...(canToggle ? {} : { why: t(blocked === 'toTaste' ? 'cat.split.toTaste' : 'cat.split.tooSmall') }),
    }];
    // ⚠️ ABSENT, NOT DISABLED, on a row with nothing to work from (no amount, 0, «to taste», or nothing weighable in the recipe):
    // the very question the calculation asks, with the row's own amount.
    if (scaleFromRow(recipe, index, ing?.grams) !== null) items.push({ id: 'fromRow', text: t('cat.fromRow.do'), disabled: false });
    if (mayOrder) {
      const order = orderTargetOf(ing, ingredients, suppliers);
      items.push({
        id: 'order',
        text: t('cat.order.do'),
        disabled: !order.ok,
        ...(order.ok ? {} : { why: t(ORDER_WHY[order.reason]) }),
      });
    }
    return items;
  }

  function act(index: number, id: string) {
    const key = keys[index] ?? '';
    if (id === 'fromRow') {
      setAsking({ index, key });
      return;
    }
    if (id === 'split') {
      setSplitKeys(prev => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
      });
      return;
    }
    if (id !== 'order' || !mayOrder) return;
    const order = orderTargetOf(recipe.ingredients[index], ingredients, suppliers);
    if (!order.ok) return;
    const path = ordersForIngredientPath(ingredients[order.ingredientId]?.supplierId, recipe.id, order.ingredientId);
    if (path === null) return;
    recipeReturn.remember(recipe.id, 'order', { row: key, split: [...splitKeys] });
    // KEEP_FOCUS: Orders puts the focus on the quantity box itself, once its lists are in; the page must not take it to its title.
    void navigate(path, { state: { ...FROM_RECIPE_LINK, ...KEEP_FOCUS } });
  }

  // The focus goes back to the row's button once nothing modal is open any more (a modal makes the page behind it inert).
  useEffect(() => {
    if (asking !== null || confirmDialog !== null) return;
    const key = focusRow.current;
    if (key === null) return;
    focusRow.current = null;
    const button = buttons.current.get(key);
    if (button === undefined || !button.isConnected) return;
    button.focus({ preventScroll: true });
    // Once more after React Aria's modal has handed the focus back to what had it before it opened (the menu item, gone).
    requestAnimationFrame(() => { if (button.isConnected && document.activeElement !== button) button.focus({ preventScroll: true }); });
  });

  // A valid amount typed: the same louder question as the batch box for a batch past 100 kg or 50 times the recipe (never a block),
  // then the batch is remembered with the row it came from.
  async function calculateFrom(key: string, result: RowScaleResult) {
    focusRow.current = key;
    setAsking(null);
    const warning = batchWarning(result.target, weighableTotalGrams(recipe), t);
    if (warning !== null) {
      const ok = await confirm({
        title: t('cat.thatIsAVery'),
        message: [warning, t('cat.calculateFor', { recipe: recipe.name, amount: `${wholeNumber(result.target)} g (${formatWeight(result.target)})` })],
        okLabel: t('cat.calculate'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok) return;
    }
    store.setScaledTarget(recipe.id, result.target, { key, amount: result.amount });
  }

  function undoFromRow() {
    if (fromRow === null) return;
    // The line and its button go: the focus goes to the ingredient the batch was worked out from.
    focusRow.current = fromRow.key;
    store.clearScaledTarget(recipe.id);
  }

  const setButton = (key: string) => (node: HTMLButtonElement | null) => {
    if (node === null) buttons.current.delete(key);
    else buttons.current.set(key, node);
  };

  // The two parts of a split row, each written with the row's own number format.
  const partsOf = (index: number): { a: string; b: string } | null => {
    if (!splitKeys.has(keys[index] ?? '')) return null;
    const unit = unitOf(recipe.ingredients[index]);
    const parts = splitAmount(amounts.values[index], unit);
    return parts === null ? null : { a: amountNumber(parts.a, unit, locale), b: amountNumber(parts.b, unit, locale) };
  };

  return (
    <section className={styles.card} aria-labelledby={headingId}>
      <header className={styles.cardHeadRow}>
        <h3 id={headingId} className={styles.cardHead}>{t('cat.ingredients')}</h3>
        <button
          ref={opener}
          type="button"
          className={styles.fullScreen}
          aria-label={t('cat.fullScreen')}
          title={t('cat.fullScreen')}
          onClick={() => { setFullScreen(true); }}
        >
          <Maximize2 aria-hidden="true" />
        </button>
      </header>

      <table className={styles.table} aria-labelledby={headingId}>
        <tbody>
          {rows.map((row, index) => {
            const key = keys[index] ?? String(index);
            const parts = partsOf(index);
            const divided = hasDividerAfter(recipe.ingredients, index);
            const name = row.label === '' ? t('cat.noName') : row.label;
            return (
              <Fragment key={index}>
                <tr
                  // A split row's rule goes under its second line, not between the two.
                  className={parts !== null ? styles.noRule : divided ? styles.divided : undefined}
                  data-divider-after={divided ? 'true' : undefined}
                  // A tap anywhere on the row presses the name's button. ⚠️ Only a press INSIDE the row: the menu is drawn in a portal,
                  // and its events still bubble up the React tree to here.
                  onClick={event => {
                    if (!event.currentTarget.contains(event.target as Node)) return;
                    const button = buttons.current.get(key);
                    if (button !== undefined && !button.contains(event.target as Node)) button.click();
                  }}
                >
                  <th scope="row" className={styles.rowHead}>
                    <RowMenu
                      label={name}
                      menuLabel={t('cat.rowMenu.label', { name })}
                      items={itemsFor(index)}
                      onAction={id => { act(index, id); }}
                      buttonRef={setButton(key)}
                    />
                  </th>
                  <td className={styles.num}>{row.num}</td>
                  <td className={styles.unit}>{row.unit}</td>
                </tr>
                {parts === null ? null : (
                  <tr className={divided ? `${styles.splitSecond} ${styles.divided}` : styles.splitSecond}>
                    <td colSpan={2} className={styles.splitLine}>
                      {t('cat.split.line', { a: amountText({ num: parts.a, unit: row.unit }), b: parts.b })}
                    </td>
                    <td className={styles.unit}>{row.unit}</td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className={styles.totalRow}>
            <th scope="row" className={styles.label}>{t('cat.total')}</th>
            <td className={styles.num}>{total.num}</td>
            <td className={styles.unit}>{total.unit}</td>
          </tr>
        </tfoot>
      </table>

      {fromRow === null ? null : (() => {
        const ing = recipe.ingredients[fromRow.index];
        const unit = unitOf(ing);
        const name = !ing || ing.label === '' ? t('cat.noName') : ing.label;
        const amount = amountText({ num: amountNumber(fromRow.amount, unit, locale), unit: unitWord(t, unit) });
        return (
          <div className={styles.fromRow}>
            <p className={styles.fromRowText}>{t('cat.fromRow.line', { name, amount })}</p>
            <Button variant="quiet" className={styles.fromRowUndo} onPress={undoFromRow}>
              <Undo2 aria-hidden="true" />
              {t('cat.fromRow.undo')}
            </Button>
          </div>
        );
      })()}

      {asking === null ? null : (() => {
        const ing = recipe.ingredients[asking.index];
        const unit = unitOf(ing);
        return (
          <FromRowDialog
            recipe={recipe}
            index={asking.index}
            name={!ing || ing.label === '' ? t('cat.noName') : ing.label}
            unit={unit}
            unitWord={unitWord(t, unit)}
            onCancel={() => { focusRow.current = asking.key; setAsking(null); }}
            onCalculate={result => { void calculateFrom(asking.key, result); }}
          />
        );
      })()}
      {confirmDialog}

      {fullScreen ? (
        <RecipeFullScreen
          name={recipe.name === '' ? t('cat.noName') : recipe.name}
          rows={rows.map((row, index) => {
            const parts = partsOf(index);
            // The full screen writes the units out on both parts.
            const note = parts === null ? undefined : t('cat.split.line', { a: amountText({ num: parts.a, unit: row.unit }), b: amountText({ num: parts.b, unit: row.unit }) });
            return { name: row.label, amount: amountText(row), dividerAfter: hasDividerAfter(recipe.ingredients, index), ...(note === undefined ? {} : { note }) };
          })}
          total={{ name: t('cat.total'), amount: amountText(total) }}
          storageKey={CATALOGUE_ZOOM_KEY}
          onClose={() => { setFullScreen(false); }}
        />
      ) : null}
    </section>
  );
}

// Why «Order» is greyed out, by the reason shared/row-actions-model gives.
const ORDER_WHY = {
  recipe: 'cat.order.isRecipe',
  notInUse: 'cat.order.notInUse',
  noSupplier: 'cat.order.noSupplier',
} as const;
