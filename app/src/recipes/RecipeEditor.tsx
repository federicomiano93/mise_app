import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Camera, Check, ChevronDown, Trash2 } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { findInvalidRecipe, linkOf } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe, InvalidRecipeProblem } from '@mise/shared/catalogue-model';
import { normalizeLabelProfile } from '@mise/shared/label-template-model';
import { mayEditRecords } from '@mise/shared/records';
import { haccpSettingsOf } from '@mise/shared/haccp-label';
import { categoryOf, sortedCategories } from '@mise/shared/recipe-shelf';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
// ⚠️ THE ONE IMPORT FROM suppliers/ (docs/architecture.md, «The one exception»; pinned by RecipesSection.createIngredient.spec).
import { CreateIngredientOverlay } from '../suppliers/CreateIngredientOverlay';
import { KEEP_FOCUS } from '../shell/Page';
import { useRecipes, useRecipesStore } from './RecipesContext';
import {
  NAME_MAX_LENGTH, addRow, cleanWorking, dropWorkingRow, haccpStorageText, labelIngredientsBoxText, labelNameText, linkRowTo, netWeightText, notWeighedCount, removeRow, setCategory, setName, setRowFields, shelfLifeText,
  stepWorkingRow, totalText, workingFrom,
} from './editorModel';
import type { Chosen, DropPosition, Row, Working } from './editorModel';
import { imageLabelChoice } from './imageLabelData';
import { IngredientRow } from './IngredientRow';
import { HACCP_STORAGE_MAX, LABEL_NAME_MAX, LABEL_TEXT_MAX } from './labelTexts';
import { LinkDialog } from './LinkDialog';
import { CardBoundary } from './CardBoundary';
import { ReorderRows } from './ReorderRows';
import { NEW_OPENER, recipeOpener, useHandBack } from './handBack';
import { FROM_EDITOR, cameFromDuplicate, carryOwner, forgetHandover, hasTypedCopy, peekHandedOver, typedCopyOf, withTypedCopy, withoutTypedCopy } from './photoCarry';
import { recipePhotoOn } from './photoGate';
import { cameFromList, cameFromRecipe, recipeCameFromList, useLeave } from './recipesNav';
import { PHOTO_PATH, RECIPES_PATH, recipePath } from './recipesPath';
import { useDeleteRecipe } from './useDeleteRecipe';
import styles from './RecipeEditor.module.css';

type Props = {
  // The recipe being edited, or null for a new one.
  id: string | null;
  // The recipe as the list holds it now (null for a new one, or one deleted on another phone while this screen stayed open).
  recipe: CatalogueRecipe | null;
  titleRef: Ref<HTMLHeadingElement>;
  // Told when something is typed, so the screen knows a newer copy from the server must not replace the form.
  onTyped?: () => void;
};

// A recipe's own screen for writing: a new one, or an existing one's editor. A port of js/catalogue/catalogue-editor.js,
// decision for decision, except what docs/parity/catalogue.md («Step 3d-6 as built») lists.
//
// The editing pattern is the app's own (P20): work on a COPY, nothing touches the stored recipe until Save, Save is
// confirmed, the required fields are checked before saving (the first wrong one is shown and takes the focus), Delete is
// small and low-key, and leaving with unsaved edits asks.
//
// ⚠️ THE COPY IS MADE ONCE, WHEN THIS FORM MOUNTS — and RecipeEditorScreen mounts it only once the recipe is in the list
// (the Pastries' editor-copies-too-early trap), keyed on the id. A recipe changed on another phone afterwards NEVER
// replaces the copy.
export function RecipeEditor({ id, recipe, titleRef, onTyped }: Props) {
  const { t, locale } = useT();
  const store = useRecipesStore();
  const { labelConfig, ingredients, recipes, suppliers, categories } = useRecipes();
  const { canManage, location: venue, user, locationId } = useSession();
  // Who typed what this editor may carry, and where (photoCarry.ts).
  const owner = carryOwner(user?.uid, locationId);
  const say = useStatusMessage();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const { state, pathname } = useLocation();
  const [confirm, confirmDialog] = useConfirm();
  const [runDelete, deleteDialog] = useDeleteRecipe();
  const ids = useId();
  const titleId = `${ids}-title`;
  const nameId = `${ids}-name`;
  const categoryId = `${ids}-category`;
  const headingId = `${ids}-ingredients`;
  const netId = `${ids}-net`;
  const shelfId = `${ids}-shelf`;
  const logoHeadId = `${ids}-logo`;
  const labelTitleId = `${ids}-labelTitle`;
  const labelTextId = `${ids}-labelText`;
  const haccpStorageId = `${ids}-haccpStorage`;
  const hintId = `${ids}-reorder-hint`;

  // ⚠️ A NEW RECIPE MAY START FROM SOMETHING CARRIED (photoCarry.ts), and then it starts DIRTY — it is unsaved work, typed or
  // already paid for: the recipe just read from a photograph, else the copy kept while the photo screen was open. Looked at
  // while drawing (nothing is taken yet, so a render run twice is harmless); taken off in the effect below.
  // `by`: 'photo' (just read), 'duplicate' (a copy of a saved recipe) or 'typed' (kept while the photo screen was open).
  const [carried] = useState<{ working: Working; by: 'photo' | 'duplicate' | 'typed' } | null>(() => {
    if (id !== null) return null;
    const handed = peekHandedOver(owner);
    if (handed !== null) return handed;
    const typedCopy = typedCopyOf(state, owner);
    return typedCopy === null ? null : { working: typedCopy, by: 'typed' };
  });
  const [working, setWorking] = useState<Working>(() => carried?.working ?? workingFrom(recipe, categories));
  // The name the recipe had when this screen opened: what the delete question calls it.
  const [storedName] = useState(recipe?.name ?? '');

  // ⚠️ THE MENU'S STARTING WORD FOLLOWS THE LIST UNTIL THE MENU IS TOUCHED: the form can open (after the patience of
  // RecipeEditorScreen) before the label profile, which holds the list, has arrived. Then the copy was made with an empty list and
  // would show «No category» for a recipe filed under a listed word. When the list arrives, the starting word (both halves,
  // so nothing counts as moved) is worked out again — but only while the person has not chosen: their choice stays. The rest of
  // the form is never rebuilt, so typing elsewhere survives.
  const [openedWith] = useState(recipe);
  const categoryTouched = useRef(false);
  const listedStart = id === null ? null : categoryOf(openedWith, categories);
  useEffect(() => {
    if (listedStart === null || categoryTouched.current) return;
    setWorking(current => (current.category === listedStart && current.categoryStart === listedStart
      ? current
      : { ...current, category: listedStart, categoryStart: listedStart }));
  }, [listedStart]);

  // ⚠️ DIRTY IS «SOMETHING WAS TYPED», also kept in a ref: the router's blocker reads it at the moment of a navigation, and a
  // state value read there could be one render behind.
  const [dirty, setDirty] = useState(carried !== null);
  const dirtyRef = useRef(carried !== null);
  const edit = (change: (current: Working) => Working) => {
    dirtyRef.current = true;
    onTyped?.();
    setDirty(true);
    setWorking(change);
  };
  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // «Fill from a photo» (a new recipe, a venue with the reader on), and the focus it is owed when this form comes back.
  const fillButton = useRef<HTMLButtonElement>(null);
  // ⚠️ WHAT WAS CARRIED IS TAKEN OFF ONCE IT HAS BEEN READ: the read draft is forgotten, and the typed copy leaves the history
  // entry (same address, replaced), so going Back to this entry again later does not bring it a second time. The focus goes
  // where the person left: the photo button after Back from the photo screen, this title after a read.
  useEffect(() => {
    if (id !== null) return;
    forgetHandover();
    if (hasTypedCopy(state)) void navigate(pathname, { replace: true, state: withoutTypedCopy(state) });
    if (carried?.by === 'typed') fillButton.current?.focus();
    // A read and a duplicate both open on the title: the first thing to do with either is to look at what it says.
    else if (carried !== null && typeof titleRef === 'object' && titleRef !== null) titleRef.current?.focus();
  }, []);
  // Set once the edits are saved or the recipe deleted, so leaving asks nothing.
  const leavingClean = useRef(false);
  // A second tap on Save (or Delete) while a question is open or a save is under way is ignored.
  const busy = useRef(false);
  const askingLeave = useRef(false);

  // ── Where Back goes ──────────────────────────────────────────────────────────────────────────────────────────
  // A new recipe steps up to the list and hands the focus to the button that opened it (or, once saved, to the row of the
  // recipe just made). An existing recipe's editor is one level below the recipe: Back is the browser's Back when the
  // recipe is the entry behind it, and replaces itself with the recipe when it was opened by its address.
  const landOn = useRef<string>(NEW_OPENER);
  const onLeaving = useCallback(() => {
    if (id === null) handBack.expect(landOn.current);
  }, [handBack, id]);
  const leave = useLeave(id === null ? RECIPES_PATH : recipePath(id), onLeaving, id === null ? cameFromList : cameFromRecipe);

  // ── Leaving with unsaved changes ─────────────────────────────────────────────────────────────────────────────
  const discardQuestion = () => confirm({
    title: t('cat.discardChanges'),
    message: t('cat.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, a recipe picked in
  // the split's list, the rail and the tab bar all navigate. Staying on the same address is never blocked.
  // ⚠️ WITH THE «ADD AS AN INGREDIENT» CARD OPEN, ANY MOVE IS BLOCKED, and turned into that card's own Back (below): the browser's
  // Back closes the card only, and the recipe under it stays as it is.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && (creatingRef.current || dirtyRef.current) && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      askingLeave.current = false;
      return;
    }
    // ⚠️ reset() lands a render later, and closing the card renders at once: without this that render would find the card gone
    // and the move still blocked, and ask the EDITOR's question for a move that was already turned back. It is remembered WHICH
    // blocked move was turned back (each one has its own reset function), not that one was: a flag cleared by a later render
    // could swallow the next Back for good if two came faster than React renders.
    if (turnedBack.current === blocker.reset) return;
    if (creatingRef.current) {
      turnedBack.current = blocker.reset;
      blocker.reset();
      cardBack.current?.();
      return;
    }
    if (askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The form went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails
  // silently on a POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (busy.current || askingLeave.current) return;
    if (dirtyRef.current) {
      busy.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        busy.current = false;
      }
    }
    leavingClean.current = true;
    leaveBack();
  }

  // ⚠️ A COPY OPENED BY «DUPLICATE» STEPS BACK ONE LEVEL, to the recipe it was copied from (Back, and Discard in the question
  // the blocker asks); the recipe page gives the focus back to its Duplicate button (recipeReturn). A Save still goes to the
  // list, like any new recipe (P20). An editor opened any other way leaves as before.
  const fromDuplicate = id === null && cameFromDuplicate(state);
  const leaveBack = () => { if (fromDuplicate) void navigate(-1); else leave(); };

  // ── What is wrong, and where ─────────────────────────────────────────────────────────────────────────────────
  const [showErrors, setShowErrors] = useState(false);
  const nameBox = useRef<HTMLInputElement>(null);
  const boxes = useRef(new Map<number, { name: HTMLInputElement | null; amount: HTMLInputElement | null; link: HTMLButtonElement | null }>());
  const register = useCallback((key: number, box: 'name' | 'amount' | 'link', node: HTMLInputElement | HTMLButtonElement | null) => {
    const held = boxes.current.get(key) ?? { name: null, amount: null, link: null };
    (held as Record<string, HTMLElement | null>)[box] = node;
    boxes.current.set(key, held);
  }, []);

  // ── Linking a row ────────────────────────────────────────────────────────────────────────────────────────────
  // The row whose chooser is open, and what it opened searching.
  const [chooser, setChooser] = useState<{ key: number; query: string } | null>(null);
  // After a pick the amount is the next thing a person fills in. Looked up AFTER the render (and, from the chooser, after the
  // dialog has given the focus back to its opener): the boxes are the same nodes, a «to taste» row has no amount to go to.
  // An object, so picking twice for the same row asks twice.
  const [amountFor, setAmountFor] = useState<{ key: number } | null>(null);
  useEffect(() => {
    if (amountFor === null) return undefined;
    const frame = requestAnimationFrame(() => { boxes.current.get(amountFor.key)?.amount?.focus(); });
    return () => { cancelAnimationFrame(frame); };
  }, [amountFor]);

  // ── Adding the ingredient a row names (T15) ──────────────────────────────────────────────────────────────────
  // The ingredient card open ABOVE this editor, for the row `key`: this editor, its working copy and its rows stay mounted
  // underneath, so closing the card — saved or not — leaves everything typed exactly where it was. Nothing is written to the
  // recipe until Save recipe.
  const [creating, setCreating] = useState<{ token: number; key: number; name: string; from: 'suggest' | 'chooser' } | null>(null);
  const creatingRef = useRef(false);
  const turnedBack = useRef<(() => void) | null>(null);
  const cardBack = useRef<(() => void) | null>(null);
  const tokens = useRef(0);
  const workingRef = useRef(working);
  workingRef.current = working;
  const mayCreate = mayEditRecords(venue, canManage);
  const knownIngredients = useMemo(() => Object.values(ingredients), [ingredients]);
  const knownSuppliers = useMemo(() => Object.values(suppliers), [suppliers]);
  // Where the focus is owed after the card closes without an ingredient: the name box (it was opened from the suggestions) or the
  // row's link line (from the chooser). Looked up after the render, after the dialog has given the focus back to its opener.
  const [refocus, setRefocus] = useState<{ key: number; box: 'name' | 'link' } | null>(null);
  useEffect(() => {
    if (refocus === null) return undefined;
    const frame = requestAnimationFrame(() => { boxes.current.get(refocus.key)?.[refocus.box]?.focus(); });
    return () => { cancelAnimationFrame(frame); };
  }, [refocus]);
  const openCreate = (key: number, name: string, from: 'suggest' | 'chooser') => {
    onTyped?.();
    creatingRef.current = true;
    tokens.current += 1;
    setCreating({ token: tokens.current, key, name, from });
  };

  // ── Reordering ───────────────────────────────────────────────────────────────────────────────────────────────
  // A MODE (the current app's, item 92): the rows are grips, names and amounts with nothing to type in. Turning it on or off
  // is not an edit; a move is (it goes through edit(), so dirty, markBusy and the leave guard follow).
  const [reordering, setReordering] = useState(false);
  // The grip owed the focus after a move, or on entering the mode.
  const [focusGrip, setFocusGrip] = useState<{ key: number } | null>(null);
  const reorderButton = useRef<HTMLButtonElement>(null);
  const toggleReorder = () => {
    if (reordering) {
      setReordering(false);
      setFocusGrip(null);
      // ⚠️ THE FOCUS IS PUT ON THE BUTTON, not left where it was: a tap does not focus a button everywhere (Safari), so the
      // focus can still be on a grip that is about to go, and it would fall to the page's body.
      reorderButton.current?.focus();
      return;
    }
    setReordering(true);
    const first = working.rows[0];
    if (first) setFocusGrip({ key: first.key });
  };
  const stepRow = (key: number, delta: -1 | 1) => {
    if (stepWorkingRow(working, key, delta) === working) return;
    edit(current => stepWorkingRow(current, key, delta));
    setFocusGrip({ key });
  };
  const dropRow = (movedKey: number, targetKey: number, position: DropPosition) => {
    if (dropWorkingRow(working, movedKey, targetKey, position) === working) return;
    edit(current => dropWorkingRow(current, movedKey, targetKey, position));
    setFocusGrip({ key: movedKey });
  };

  // ⚠️ THE ONE PLACE A ROW'S LINK IS WRITTEN (editorModel.linkRowTo → applyLink): the suggestion list and the chooser both
  // come here. `null` removes the link. Re-validation needs no call: what is wrong is derived from the copy at every render.
  const linkTo = (key: number, chosen: Chosen | null) => {
    edit(current => linkRowTo(current, key, chosen, ingredients, recipes));
    if (chosen !== null) setAmountFor({ key });
  };

  const reveal = (node: HTMLElement | null | undefined) => {
    if (!node) return;
    node.focus();
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
  };

  // The first field that is wrong for `problem`, with the cursor in it (P20): Save is at the top of the screen, so the row
  // can be far below the fold.
  const revealProblem = (problem: InvalidRecipeProblem) => {
    if (problem === 'name') {
      reveal(nameBox.current);
      return;
    }
    if (problem === 'ingredients') {
      const first = working.rows[0];
      if (first) reveal(boxes.current.get(first.key)?.name);
      return;
    }
    // 'weight': the first NAMED row whose amount box is drawn (a «to taste» row has none).
    const named = working.rows.filter(({ row }) => String(row.label ?? '').trim() !== '');
    const target = named.find(({ key }) => boxes.current.get(key)?.amount) ?? named[0];
    if (target) reveal(boxes.current.get(target.key)?.amount ?? boxes.current.get(target.key)?.name);
  };

  // A problem found while reordering is shown once the mode has gone and the ordinary rows (and their boxes) are drawn.
  const pendingProblem = useRef<InvalidRecipeProblem | null>(null);
  useEffect(() => {
    if (reordering || pendingProblem.current === null) return;
    const found = pendingProblem.current;
    pendingProblem.current = null;
    revealProblem(found);
  });

  // ── Save and delete ──────────────────────────────────────────────────────────────────────────────────────────
  const clean = cleanWorking(working);
  const problem = findInvalidRecipe(clean);

  async function save() {
    if (busy.current || askingLeave.current || leavingClean.current) return;
    if (problem !== null) {
      setShowErrors(true);
      if (reordering) {
        pendingProblem.current = problem;
        setReordering(false);
        setFocusGrip(null);
      } else {
        revealProblem(problem);
      }
      say(t(problem === 'name' ? 'cat.pleaseEnterARecipe' : problem === 'weight' ? 'cat.enterAnAmountFor' : 'cat.addAtLeastOne'));
      return;
    }
    busy.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t('cat.saveRecipe'),
        message: t('cat.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
    } finally {
      busy.current = false;
    }
    if (!ok || !mounted.current) return;
    // Saved: nothing is unsaved any more, so leaving asks nothing. Local-first: the list changes at once and the database
    // follows; a refused write is taken back and said by the store.
    leavingClean.current = true;
    const savedId = store.saveRecipe(clean);
    announceAction('recipe-saved');
    say(t(id === null ? 'cat.recipeAdded' : 'cat.recipeSaved'));
    if (id === null) {
      landOn.current = recipeOpener(savedId);
      leave();
    } else {
      // Back to the LIST (not to the recipe), the row of the saved recipe owed the focus.
      handBack.expect(recipeOpener(savedId));
      leaveForList();
    }
  }

  // ⚠️ AFTER A SAVE OR A DELETE the list is shown, and Back from it must leave the catalogue, not reopen the recipe (or a
  // recipe that is gone). Opened [list, recipe, editor] from the list, that is a jump of two steps; any other way in (an
  // address, the Allergen sheet) replaces the editor with the list, as before.
  const leaveForList = () => {
    if (cameFromRecipe(state) && recipeCameFromList(state)) void navigate(-2);
    else void navigate(RECIPES_PATH, { replace: true, state: KEEP_FOCUS });
  };

  async function remove() {
    if (id === null || busy.current || askingLeave.current || leavingClean.current) return;
    busy.current = true;
    try {
      await runDelete({ id, name: storedName }, () => {
        leavingClean.current = true;
        handBack.expect(recipeOpener(id));
        leaveForList();
      });
    } finally {
      busy.current = false;
    }
  }

  // ── Filling a NEW recipe from a photograph ───────────────────────────────────────────────────────────────────
  // ⚠️ IF ANYTHING HAS BEEN TYPED, IT ASKS FIRST. Leaving for the photo screen abandons this form; the typed copy is written
  // into this history entry (the entry is replaced, same address) so that Back from the photo screen — the button or the
  // phone's gesture — lands on it and brings the form back as it was left, once. The leave guard is dropped because this IS
  // the answer to it: nothing is thrown away.
  async function fillFromPhoto() {
    if (id !== null || busy.current || askingLeave.current || leavingClean.current) return;
    if (dirtyRef.current) {
      busy.current = true;
      let ok = false;
      try {
        ok = await confirm({
          title: t('cat.photo.replaceTitle'),
          message: t('cat.photo.replaceBody'),
          okLabel: t('cat.photo.replaceOk'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
      } finally {
        busy.current = false;
      }
      if (!ok || !mounted.current) return;
    }
    leavingClean.current = true;
    // One move after the other: a second navigation started before the first has landed would cancel it.
    if (dirtyRef.current) await navigate(pathname, { replace: true, state: withTypedCopy(state, working, owner) });
    await navigate(PHOTO_PATH, { state: FROM_EDITOR });
  }

  // ── What is drawn ────────────────────────────────────────────────────────────────────────────────────────────
  const profile = normalizeLabelProfile(labelConfig);
  const logoModel = imageLabelChoice(labelConfig).template === 'logo';
  // ⚠️ THE HACCP STORAGE BOX IS DRAWN ONLY WHEN THE VENUE PRINTS THAT FIELD (Settings → HACCP label → Storage → Printed): a box
  // whose text no label would carry is clutter. A recipe's stored text is kept either way (cleanWorking passes it through).
  const haccpStorageOn = haccpSettingsOf(labelConfig).fields.storage === 'print';
  // ⚠️ SHOWN ONLY WHEN THE VENUE PRINTS THEM: two boxes nobody can explain on a screen everybody uses are clutter, and a
  // control that changes nothing is one somebody sets wrongly and then trusts.
  const wantsWeight = profile.showWeight === true;
  const wantsShelfLife = profile.showDate === true;
  const nameInvalid = showErrors && working.name.trim() === '';
  const noAmount = showErrors && problem === 'weight';
  const skipped = notWeighedCount(clean);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t(id === null ? 'cat.newRecipe' : 'cat.editRecipe')}
        titleId={titleId}
        titleRef={titleRef}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      <div className={styles.body}>
        <div className={styles.field}>
          <label htmlFor={nameId} className={styles.label}>{t('cat.recipeName')}</label>
          <input
            ref={nameBox}
            id={nameId}
            type="text"
            autoComplete="off"
            className={styles.nameBox}
            placeholder={t('cat.recipeName')}
            maxLength={NAME_MAX_LENGTH}
            aria-invalid={nameInvalid ? true : undefined}
            value={working.name}
            onChange={event => { edit(current => setName(current, event.target.value)); }}
          />
        </div>

        {/* ⚠️ DRAWN ONLY WHEN THE VENUE HAS A CATEGORY: a menu with one option is clutter. It is a native select (the phone's own
            picker), with its chevron as a sibling like the unit menu. A recipe filed under a word that has left the list shows
            «No category» here, and an unrelated save leaves its word alone (editorModel.cleanWorking). */}
        {categories.length > 0 ? (
          <div className={styles.field}>
            <label htmlFor={categoryId} className={styles.label}>{t('cat.shelf.categoryLabel')}</label>
            <span className={styles.selectCell}>
              <select
                id={categoryId}
                className={styles.select}
                value={working.category}
                onChange={event => { categoryTouched.current = true; edit(current => setCategory(current, event.target.value)); }}
              >
                <option value="">{t('cat.shelf.categoryNone')}</option>
                {sortedCategories(categories, locale).map(word => <option key={word} value={word}>{word}</option>)}
              </select>
              <ChevronDown aria-hidden="true" className={styles.selectChevron} />
            </span>
          </div>
        ) : null}

        <section className={styles.ingredients} aria-labelledby={headingId}>
          <div className={styles.head}>
            <h3 id={headingId} className={styles.headLabel}>{t('cat.ingredients')}</h3>
            <span className={styles.count}>{working.rows.length}</span>
            {/* ABSENT, not disabled, with fewer than two rows: there is nothing to put in another order. */}
            {working.rows.length > 1 ? (
              <Button ref={reorderButton} variant="secondary" className={styles.reorder} aria-pressed={reordering} onPress={toggleReorder}>
                {t(reordering ? 'cat.reorderDone' : 'cat.reorder')}
              </Button>
            ) : null}
          </div>
          {reordering ? <p id={hintId} className={styles.note}>{t('cat.reorderHint')}</p> : null}

          <div className={styles.frame}>
            {reordering ? (
              <ReorderRows
                rows={working.rows}
                labelledBy={headingId}
                hintId={hintId}
                onDrop={dropRow}
                onStep={stepRow}
                focusGrip={focusGrip}
              />
            ) : (
              <ul className={styles.rows}>
                {working.rows.map(item => (
                  <IngredientRow
                    key={item.key}
                    item={item}
                    nameInvalid={showErrors && String(item.row.label ?? '').trim() === ''}
                    amountInvalid={noAmount && String(item.row.label ?? '').trim() !== ''}
                    register={register}
                    onChange={(key: number, fields: Row) => { edit(current => setRowFields(current, key, fields)); }}
                    onRemove={key => { edit(current => removeRow(current, key)); }}
                    linking={{
                      ingredients,
                      recipes,
                      suppliers,
                      excludeRecipeId: id,
                      onPick: linkTo,
                      onSeeAll: (key, typed) => { setChooser({ key, query: typed }); },
                      onOpen: key => { setChooser({ key, query: '' }); },
                      mayCreate,
                      onCreate: (key, name) => { openCreate(key, name, 'suggest'); },
                    }}
                  />
                ))}
              </ul>
            )}
            {/* ⚠️ THE TOTAL SITS IN THE SAME CELL SHAPE AS THE AMOUNTS ABOVE IT: «Total 8380 g» stops lining up with the column of
                numbers it is the sum of, which is the one thing it exists to do. */}
            <div className={styles.total}>
              <span className={styles.totalLabel}>{t('cat.total')}</span>
              <span className={styles.totalCell}>
                <span className={styles.totalNum}>{totalText(clean)}</span>
                <span className={styles.totalUnit}>g</span>
              </span>
              <span className={styles.totalSpacer} aria-hidden="true" />
            </div>
          </div>

          {skipped > 0 ? <p className={styles.note}>{t('cat.notWeighed', { n: skipped })}</p> : null}

          {reordering ? null : (
            <Button variant="secondary" className={styles.add} onPress={() => { edit(addRow); }}>
              {t('cat.addIngredient')}
            </Button>
          )}
        </section>

        {wantsWeight || wantsShelfLife ? (
          <div className={styles.labelFields}>
            <div className={styles.pair}>
              {wantsWeight ? (
                <div className={styles.cell}>
                  <label htmlFor={netId} className={styles.label}>{t('cat.netWeight')}</label>
                  <span className={styles.inputRow}>
                    <input
                      id={netId}
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      className={styles.numberBox}
                      placeholder="—"
                      value={netWeightText(working)}
                      onChange={event => { edit(current => ({ ...current, netWeight: event.target.value })); }}
                    />
                    <span className={styles.unitWord}>g</span>
                  </span>
                </div>
              ) : null}
              {wantsShelfLife ? (
                <div className={styles.cell}>
                  <label htmlFor={shelfId} className={styles.label}>{t('cat.shelfLife')}</label>
                  <span className={styles.inputRow}>
                    <input
                      id={shelfId}
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      className={styles.numberBox}
                      placeholder="—"
                      value={shelfLifeText(working)}
                      onChange={event => { edit(current => ({ ...current, shelfLife: event.target.value })); }}
                    />
                    <span className={styles.unitWord}>{t('cat.days')}</span>
                  </span>
                </div>
              ) : null}
            </div>
            <p className={styles.note}>{t('cat.labelFieldsNote')}</p>
          </div>
        ) : null}

        {/* ⚠️ THE TWO TEXTS OF THE «WITH LOGO» LABEL, shown only for the venue that prints that model: boxes nobody can use
            elsewhere are clutter. They go through edit() like every other box, so the editor turns dirty, holds the app
            busy and asks before it is left without any code of their own. */}
        {logoModel ? (
          <section className={styles.logoLabel} aria-labelledby={logoHeadId}>
            <h3 id={logoHeadId} className={styles.headLabel}>{t('cat.logoLabel')}</h3>
            <div className={styles.cell}>
              <label htmlFor={labelTitleId} className={styles.label}>{t('cat.labelTitle')}</label>
              <input
                id={labelTitleId}
                type="text"
                autoComplete="off"
                className={styles.nameBox}
                maxLength={LABEL_NAME_MAX}
                placeholder={working.name.trim().toUpperCase()}
                aria-describedby={`${labelTitleId}-note`}
                value={labelNameText(working)}
                onChange={event => { edit(current => ({ ...current, labelName: event.target.value })); }}
              />
              <p id={`${labelTitleId}-note`} className={styles.note}>{t('cat.labelTitleNote')}</p>
            </div>
            <div className={styles.cell}>
              <label htmlFor={labelTextId} className={styles.label}>{t('cat.labelIngredients')}</label>
              <textarea
                id={labelTextId}
                className={styles.textArea}
                rows={6}
                maxLength={LABEL_TEXT_MAX}
                aria-describedby={`${labelTextId}-note`}
                value={labelIngredientsBoxText(working)}
                onChange={event => { edit(current => ({ ...current, labelText: event.target.value })); }}
              />
              <p id={`${labelTextId}-note`} className={styles.note}>{t('cat.labelIngredientsNote')}</p>
            </div>
          </section>
        ) : null}

        {/* ⚠️ THE HACCP LABEL'S STORAGE TEXT: a single line, through edit() like every other box (dirty, busy, leave guard), the
            same working-copy rule as the logo label's two texts (nothing typed = the stored text goes through; emptied = removal). */}
        {haccpStorageOn ? (
          <div className={styles.cell}>
            <label htmlFor={haccpStorageId} className={styles.label}>{t('cat.haccpStorage')}</label>
            <input
              id={haccpStorageId}
              type="text"
              autoComplete="off"
              className={styles.nameBox}
              maxLength={HACCP_STORAGE_MAX}
              aria-describedby={`${haccpStorageId}-note`}
              value={haccpStorageText(working)}
              onChange={event => { edit(current => ({ ...current, haccpStorage: event.target.value })); }}
            />
            <p id={`${haccpStorageId}-note`} className={styles.note}>{t('cat.haccpStorageNote')}</p>
          </div>
        ) : null}

        {/* ⚠️ DELETE: whoever runs the place only (the same as the recipe page), absent — not disabled — for everybody else and
            for a new recipe. Small and low-key, at the bottom. */}
        {id !== null && canManage ? (
          <div className={styles.actions}>
            <button type="button" className={styles.delete} onClick={() => { void remove(); }}>
              <Trash2 aria-hidden="true" />
              <span>{t('cat.deleteRecipe')}</span>
            </button>
          </div>
        ) : null}

        {/* ⚠️ ONLY ON A NEW RECIPE, AND ONLY WHEN THE VENUE HAS THE READER ON, and LAST: it is an alternative to the form above
            it, not a step in the way of it (his note of 13 Sep 2026 in the current app). */}
        {id === null && recipePhotoOn(venue) ? (
          <div className={styles.actions}>
            <Button ref={fillButton} variant="secondary" onPress={() => { void fillFromPhoto(); }}>
              <Camera aria-hidden="true" />
              {t('cat.photo.fill')}
            </Button>
          </div>
        ) : null}
      </div>
      {chooser === null ? null : (
        <LinkDialog
          ingredients={ingredients}
          recipes={recipes}
          suppliers={suppliers}
          excludeRecipeId={id}
          hasLink={linkOf(working.rows.find(item => item.key === chooser.key)?.row) !== null}
          initialQuery={chooser.query}
          onChoose={chosen => {
            setChooser(null);
            linkTo(chooser.key, chosen);
          }}
          onClose={() => { setChooser(null); }}
          mayCreate={mayCreate}
          onCreate={name => {
            // The chooser closes FIRST; the card opens one frame later, so the two dialogs never stand at once.
            const key = chooser.key;
            setChooser(null);
            requestAnimationFrame(() => { if (mounted.current) openCreate(key, name, 'chooser'); });
          }}
        />
      )}
      {creating === null ? null : (
        <CardBoundary onFail={() => {
          creatingRef.current = false;
          cardBack.current = null;
          setCreating(null);
          say(t('sup.price.openFailed'));
        }}>
        <CreateIngredientOverlay
          key={creating.token}
          open
          name={creating.name}
          ingredients={knownIngredients}
          suppliers={knownSuppliers}
          backRef={cardBack}
          onDone={made => {
            creatingRef.current = false;
            const { key, from } = creating;
            setCreating(null);
            if (!workingRef.current.rows.some(item => item.key === key)) return;
            if (made === null) setRefocus({ key, box: from === 'suggest' ? 'name' : 'link' });
            else linkTo(key, { kind: 'ingredient', refId: made.id, name: made.name });
          }}
        />
        </CardBoundary>
      )}
      {confirmDialog}
      {deleteDialog}
    </section>
  );
}
