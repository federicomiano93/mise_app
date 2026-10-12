import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { MAX_VISIBLE_RECIPES, cloneConfig, getIngredients, getProducts, getRecipes } from '@mise/shared/calculator-config';
import type { RecipeIngredient } from '@mise/shared/calculator-config';
import { isLinked, resolveRecipe } from '@mise/shared/calculator-recipe-source';
import type { ResolvedRecipe } from '@mise/shared/calculator-recipe-source';
import { withRowIds } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import type { ConfirmOptions } from '../ui/useConfirm';
import { FROM_PARENT, useLeave } from './calculatorNav';
import { SETTINGS_PATH, inRecipesEditor, recipeSettingsPath, recipesPath } from './calculatorPath';
import type { SettingsTarget } from './calculatorPath';
import type { StoredDoc } from './calculatorSource';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { recipeOpener, useHandBack } from './handBack';
import { RecipeList } from './RecipeList';
import { RecipeScreen } from './RecipeScreen';
import { RecipesEditorContext } from './recipesEditorContext';
import type { RecipesEditorState } from './recipesEditorContext';
import {
  addIngredient, chooseLeavening, firstBadTray, firstInvalid, isBlank, isEmptyRecipe, isFull, linkTo, newRecipe, patchIngredient,
  patchRecipe, removeIngredient, sameRecipes, settleRecipes, toEditable, unlink, visibleCount,
} from './recipesModel';
import type { EditableRecipe } from './recipesModel';
import { useSaveConfig } from './useSaveConfig';

// The Recipes editor (a port of js/recipes.js): ONE working copy of the whole recipe list, held HERE, above the list
// and the recipe screen, so going from the list to a recipe and back keeps every edit. Nothing is saved until Save;
// Save commits the whole `recipes` array over the LATEST configuration (no other key of it is touched — the store's
// normaliser then rebuilds the ingredient registry and the per-recipe maps from it), asking first.
//
// Opened by SettingsGate, which waits for the venue's real configuration: the copy below is made ONCE, when the
// editor opens, so it must not be made from the empty default.
//
// ⚠️ THE DISCARD QUESTION FIRES ONLY WHEN THE EDITOR IS LEFT ALTOGETHER: every way out goes through the router's
// blocker, which lets a move between the editor's own addresses through (the Clients editor's design). A SAVE IN
// FLIGHT IS PENDING, NOT GONE: Save ignores a second tap and Back waits (port of createSaveGuard). A refused save
// leaves the screen exactly as it was — dirty, with its edits — and Save is given back.
//
// ⚠️ THE WORKING COPY IS ALSO KEPT IN A REF, written in the same breath as the state: the router's blocker and the
// moves that follow an edit (dropping a fresh recipe, then leaving) read «is anything unsaved» before React has
// rendered the edit.
export function RecipesEditor({ target }: { target: SettingsTarget }) {
  const { t } = useT();
  const store = useCalculatorStore();
  const { config, linked } = useCalculator();
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = location;
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const [saveConfig, saveDialog] = useSaveConfig();
  const leaveToHub = useLeave(SETTINGS_PATH);
  const leaveToList = useLeave(recipesPath);

  // The list as the editor opened with it (or as it was last saved), and the copy being edited.
  const openingRef = useRef<EditableRecipe[]>(null as unknown as EditableRecipe[]);
  const copy = useRef<EditableRecipe[]>(null as unknown as EditableRecipe[]);
  const [recipes, setRecipes] = useState<readonly EditableRecipe[]>(() => {
    const first = toEditable(cloneConfig(getRecipes(config)));
    openingRef.current = first;
    copy.current = first;
    return first;
  });
  const [openId, setOpenId] = useState<string | null>(null);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [checkTick, setCheckTick] = useState(0);
  const [saving, setSaving] = useState(false);
  // The Catalogue recipes the person chose from, as stamped: a recipe linked in this visit is not watched by the
  // store until it is saved, so its rows come from here until then.
  const [chosen, setChosen] = useState<Readonly<Record<string, StoredDoc>>>({});
  const dirty = !sameRecipes(openingRef.current, recipes);

  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  // Every edit goes through here.
  const edit = useCallback((change: (known: EditableRecipe[]) => EditableRecipe[]) => {
    const next = change(copy.current);
    copy.current = next;
    dirtyRef.current = !sameRecipes(openingRef.current, next);
    setRecipes(next);
  }, []);

  // The recipe on show was just added and is still empty: leaving it asks to drop it.
  const freshEmpty = target.kind === 'one' && freshId === target.id
    && isEmptyRecipe(recipes.find(known => known.id === target.id));
  const freshEmptyRef = useRef(freshEmpty);
  useLayoutEffect(() => { freshEmptyRef.current = freshEmpty; }, [freshEmpty]);
  // Recipes removed on purpose; a screen whose recipe is in here draws nothing while it leaves. Forgotten once the
  // editor has moved on, so an address that comes back (the browser's Forward) is an unknown recipe again.
  const dropped = useRef(new Set<string>());
  const shownId = target.kind === 'one' ? target.id : null;
  useEffect(() => {
    for (const id of [...dropped.current]) if (id !== shownId) dropped.current.delete(id);
  }, [shownId]);
  // The list has been drawn in this visit (see cameFromList).
  const listSeen = useRef(false);
  if (target.kind === 'list') listSeen.current = true;
  const leavingClean = useRef(false);
  const busy = useRef(false);
  const askingLeave = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const discardQuestion = useCallback(() => confirm({
    title: t('calc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  const askDiscardNewRecipe = useCallback(() => confirm({
    title: t('calc.discardThisNewRecipe'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // Set while the editor moves between its own screens by itself (Save opening the recipe to fix): the recipe being
  // left must not ask «discard this new recipe?» of a move it did not make.
  const quiet = useRef(false);
  const quietly = useCallback((move: () => void) => {
    quiet.current = true;
    try {
      move();
    } finally {
      quiet.current = false;
    }
  }, []);

  function dropRecipe(recipeId: string) {
    dropped.current.add(recipeId);
    freshEmptyRef.current = false;
    edit(known => known.filter(recipe => recipe.id !== recipeId));
    setFreshId(known => (known === recipeId ? null : known));
    setOpenId(known => (known === recipeId ? null : known));
  }

  // ── Leaving ───────────────────────────────────────────────────────────────────────────────
  // ⚠️ A ROUTER SUPPORTS ONE BLOCKER, so this one asks both questions. Out of the editor altogether with unsaved
  // changes: «leave without saving?». Between its own addresses (the browser's Back from a new, empty recipe):
  // «discard this new recipe?». A move to the editor's own other screen with anything else asks nothing.
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (leavingClean.current) return false;
    if (!inRecipesEditor(nextLocation.pathname)) return dirtyRef.current;
    return !quiet.current && freshEmptyRef.current && nextLocation.pathname !== currentLocation.pathname;
  }, []);
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    // ⚠️ THE QUESTION STAYS «BEING ASKED» UNTIL THE ROUTER HAS LEFT ITS 'blocked' STATE, not until the answer (see
    // the Clients editor): a render in between would ask the same question again.
    if (blocker.state !== 'blocked') {
      askingLeave.current = false;
      return;
    }
    if (askingLeave.current) return;
    askingLeave.current = true;
    const leavingEditor = !inRecipesEditor(blocker.location.pathname);
    void (async () => {
      try {
        const discard = await (leavingEditor ? discardQuestion() : askDiscardNewRecipe());
        // The screen went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          if (!leavingEditor) dropRecipe(target.kind === 'one' ? target.id : '');
          current.proceed();
        } else {
          current.reset();
        }
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // The list's Back asks for itself BEFORE it navigates: its navigate(-1) is a POP, and the router's blocker fails
  // silently on a POP to an entry it did not create (a page opened by its address).
  const leaveEditor = useCallback(async () => {
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
    leaveToHub();
  }, [discardQuestion, leaveToHub]);

  // ── «Add a recipe» from the work view: /recipes/new makes the recipe and shows it at its own address ──
  const madeFor = useRef<string | null>(null);
  useEffect(() => {
    if (target.kind !== 'new' || madeFor.current === location.key) return;
    madeFor.current = location.key;
    const fresh = newRecipe(copy.current.length, !isFull(copy.current));
    edit(known => [...known, fresh]);
    setFreshId(fresh.id);
    void navigate(recipeSettingsPath(fresh.id), { replace: true, state });
  }, [target.kind, location.key, edit, navigate, state]);

  function open(recipeId: string) {
    if (target.kind === 'one' && target.id === recipeId) return;
    quietly(() => {
      void navigate(recipeSettingsPath(recipeId), {
        replace: target.kind === 'one',
        state: target.kind === 'one' ? state : FROM_PARENT,
      });
    });
  }

  async function save() {
    if (busy.current || askingLeave.current) return;
    busy.current = true;
    setSaving(true);
    try {
      // Required first: the first recipe with no name, or no named ingredient, is opened, its blank fields are
      // marked, and the sentence is said. The focus moves to the first marked field once it has been read.
      const invalid = firstInvalid(copy.current);
      if (invalid !== null) {
        setShowErrors(true);
        open(invalid);
        await alert({ message: t('calc.pleaseGiveEveryRecipe'), okLabel: t('common.ok') });
        if (mounted.current) setCheckTick(tick => tick + 1);
        return;
      }
      // A trays recipe needs a tray weight: no sentence, the list opens that recipe's row, marks the box and jumps
      // to it.
      const badTray = firstBadTray(copy.current);
      if (badTray !== null) {
        setShowErrors(true);
        setOpenId(badTray);
        if (target.kind === 'one') quietly(leaveToList);
        setCheckTick(tick => tick + 1);
        return;
      }
      const ok = await confirm({
        title: t('calc.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      const settled = settleRecipes(copy.current);
      // The latest configuration, with only the recipes written over it: another phone's change to any other part
      // must not be undone by this save.
      const latest = cloneConfig(store.getSnapshot().config);
      if (!(await saveConfig({ ...latest, recipes: settled }))) return;
      if (!mounted.current) return;
      // Saved (or kept on this phone, and said so). The copy is re-synced from the normalised configuration the
      // store now holds (keys made unique, numbers tidied).
      const saved = toEditable(cloneConfig(getRecipes(store.getSnapshot().config)));
      dirtyRef.current = false;
      openingRef.current = saved;
      copy.current = saved;
      setRecipes(saved);
      setShowErrors(false);
      setFreshId(null);
      setOpenId(null);
      // P20: after a successful save, back to the list; the row that was being edited takes the focus.
      if (target.kind === 'one') {
        if (listSeen.current) handBack.expect(recipeOpener(target.id));
        leaveToList();
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  // ── The Catalogue ─────────────────────────────────────────────────────────────────────────
  // ⚠️ THE LIST OF CATALOGUE RECIPES IS READ THE FIRST TIME THE PICKER ASKS, ONCE. Rare and deliberate — never on the
  // app's boot path, where it would be the v207 cost mistake again. A failed read is forgotten, so the next opening
  // tries again.
  const catalogueRead = useRef<Promise<StoredDoc[]> | null>(null);
  const loadCatalogue = useCallback((): Promise<StoredDoc[]> => {
    if (!catalogueRead.current) {
      const reading = store.listCatalogueRecipes();
      catalogueRead.current = reading;
      reading.catch(() => { if (catalogueRead.current === reading) catalogueRead.current = null; });
    }
    return catalogueRead.current;
  }, [store]);

  // ⚠️ LINKING STAMPS A STABLE id ON EVERY CATALOGUE ROW FIRST, and that order is the whole reason this is not a
  // one-line assignment. The recipes in the Catalogue may carry no row ids (they predate the guided-mixing work that
  // mints them on save), and the Calculator finds the leavening BY that id: without this step it would fall back to
  // matching by NAME, which is the defect being designed out. withRowIds is idempotent, so a recipe already carrying
  // ids is written back as it was.
  const link = useCallback(async (recipeId: string, source: StoredDoc): Promise<boolean> => {
    try {
      const stamped = withRowIds(Array.isArray(source.ingredients) ? source.ingredients : []);
      await store.stampRowIds(source.id, stamped);
      if (!mounted.current) return false;
      setChosen(known => ({ ...known, [source.id]: { ...source, ingredients: stamped } }));
      edit(known => known.map(recipe => (recipe.id === recipeId ? linkTo(recipe, source.id) : recipe)));
      return true;
    } catch (error) {
      console.error('Could not give the Catalogue rows stable ids:', error);
      return false;
    }
  }, [store, edit]);

  const catalogueById = useMemo(() => ({ ...chosen, ...linked }), [chosen, linked]);
  const resolved = (recipe: EditableRecipe): ResolvedRecipe => resolveRecipe(recipe, catalogueById);
  const linkedRows = (recipe: EditableRecipe): RecipeIngredient[] | null => (isLinked(recipe) ? resolved(recipe).ingredients : null);

  const find = (recipeId: string) => copy.current.find(recipe => recipe.id === recipeId);

  const value: RecipesEditorState = {
    recipes,
    ingredientNames: getIngredients(config).map(known => known.name),
    dirty,
    saving,
    showErrors,
    checkTick,
    freshId,
    openId,
    setOpenId,
    patch: (recipeId, patch) => { edit(known => patchRecipe(known, recipeId, patch)); },
    addIngredient: recipeId => {
      const index = find(recipeId)?.ingredients.length ?? 0;
      edit(known => known.map(recipe => (recipe.id === recipeId ? addIngredient(recipe) : recipe)));
      return index;
    },
    patchIngredient: (recipeId, index, patch) => {
      edit(known => known.map(recipe => (recipe.id === recipeId ? patchIngredient(recipe, index, patch) : recipe)));
    },
    removeIngredient: (recipeId, index) => {
      edit(known => known.map(recipe => (recipe.id === recipeId ? removeIngredient(recipe, index) : recipe)));
    },
    chooseLeavening: (recipeId, picked) => {
      edit(known => known.map(recipe => (recipe.id === recipeId ? chooseLeavening(recipe, picked, linkedRows(recipe)) : recipe)));
    },
    setVisible: async (recipeId, visible) => {
      const recipe = find(recipeId);
      if (!recipe) return;
      if (visible && recipe.visible === false && visibleCount(copy.current) >= MAX_VISIBLE_RECIPES) {
        await alert({ message: t('calc.recipe.limitReached', { n: MAX_VISIBLE_RECIPES }), okLabel: t('common.ok') });
        return;
      }
      edit(known => patchRecipe(known, recipeId, { visible }));
    },
    addRecipe: async () => {
      // At the limit the new recipe can only be created hidden: say so before making it.
      const full = isFull(copy.current);
      if (full && !(await confirm({
        title: t('calc.recipe.addLimitConfirm', { n: MAX_VISIBLE_RECIPES }),
        okLabel: t('calc.recipe.createHidden'),
        cancelLabel: t('common.cancel'),
      }))) return null;
      if (!mounted.current) return null;
      const fresh = newRecipe(copy.current.length, !full);
      edit(known => [...known, fresh]);
      setFreshId(fresh.id);
      return fresh.id;
    },
    deleteRecipe: async recipeId => {
      const recipe = find(recipeId);
      if (!recipe) return false;
      const used = getProducts(store.getSnapshot().config).filter(product => product.recipeId === recipeId).length;
      if (used > 0) {
        await alert({ message: t('calc.recipeUsedByProducts', { n: used }), okLabel: t('common.ok') });
        return false;
      }
      const ok = await confirm({
        title: isBlank(recipe.name) ? t('calc.deleteThisRecipe') : t('calc.deleteRecipeNamed', { name: recipe.name }),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok || !mounted.current) return false;
      dropRecipe(recipeId);
      return true;
    },
    dropRecipe,
    productCount: recipeId => getProducts(store.getSnapshot().config).filter(product => product.recipeId === recipeId).length,
    keep: () => {
      freshEmptyRef.current = false;
      setFreshId(null);
    },
    resolved,
    linkedRows,
    loadCatalogue,
    link,
    unlink: recipeId => { edit(known => known.map(recipe => (recipe.id === recipeId ? unlink(recipe) : recipe))); },
    say: message => alert({ message, okLabel: t('common.ok') }),
    save,
    leaveEditor,
    leaveToList,
    cameFromList: () => listSeen.current,
    quietly,
    askDiscardNewRecipe,
    wasDropped: recipeId => dropped.current.has(recipeId),
    confirm: (options: ConfirmOptions) => confirm(options),
  };

  return (
    <RecipesEditorContext.Provider value={value}>
      {target.kind === 'one' ? <RecipeScreen key={target.id} recipeId={target.id} /> : null}
      {target.kind === 'list' ? <RecipeList /> : null}
      {confirmDialog}
      {alertDialog}
      {saveDialog}
    </RecipesEditorContext.Provider>
  );
}
