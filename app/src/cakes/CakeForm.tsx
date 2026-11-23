import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { ingredientCardPath } from '@mise/shared/cake-label-model';
import { MAX_SELLING_PRICE, cakeGeometry, cakeLineCosts, cakeProduct, cakeProductId, cakeTotals, toCakeDocument } from '@mise/shared/cake-model';
import type { Cake, CakePart } from '@mise/shared/cake-model';
import { vatSelection } from '@mise/shared/foodcost-model';
import { localNumber } from '@mise/shared/currency';
import { fcMoney } from '@mise/shared/fc-number';
import { countryOf } from '@mise/shared/market';
import { firstInvalidNumber } from '@mise/shared/product-limits';
import { useFoodcost, useFoodcostStore } from '../foodcost/FoodcostContext';
import { FROM_LIST, useLeave } from '../foodcost/foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from '../foodcost/handBack';
import { marginPointFor } from '../foodcost/productEditorModel';
import { PartBoundary } from '../errors/PartBoundary';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { referenceFor, refIsCurrent } from '@mise/shared/cake-standard';
// ⚠️ DECLARED EXCEPTION to «a feature never imports another's folder» (docs/architecture.md, Cakes): «+ New recipe» makes the very
// recipe document the Recipes' own save makes, with the same id maker, and «Open in Recipes» opens that recipe's editor.
import { newRecipeData } from '../recipes/recipeDocument';
import { FROM_CAKE } from '../recipes/recipesNav';
import { editPath } from '../recipes/recipesPath';
import { newRecipeId } from '../recipes/recipesSource';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { visibleSectionIds } from '../session/visibility';
import { useMoney } from '../session/useMoney';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useCakeHeadingLevel } from './headingLevel';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import {
  addCard, costable, firstEmptyPack, followStandard, isDirty, NEW_DIAMETER_CM, referenceChanged, removeCard, setMeasure, setPrice, setTarget, setVat, takeReference, vatFromSelect,
  withoutMissingRecipeCards, workingFrom,
} from './cakeEditorModel';
import type { Selected } from './cakeEditorModel';
import { dropParked, flushRemembered, forgetCake, parkCake, parkedKeyOf, peekParked, rememberCake, useParkingOwner } from './cakeParking';
import { CakeStage } from './CakeStage';
import type { StageLabels } from './CakeStage';
import { useCakes } from './CakesContext';
import { CAKES_PATH, referencePath } from './cakesPath';
import type { CakeStart } from './cakesPath';
import { STEP_PARTS, partFigures, partKey, startStep } from './cakeStepsModel';
import type { StepKey } from './cakeStepsModel';
import { CakeLabelRow } from './CakeLabelRow';
import { CakeLabelView } from './CakeLabelView';
import { CostCard } from './CostCard';
import type { PriceField, PriceTexts } from './CostCard';
import { FoldTitle } from './FoldTitle';
import { MeasuresCard } from './MeasuresCard';
import { NeedDialog } from './NeedDialog';
import { TierParts } from './TierParts';
import type { OpenRequest } from './TierParts';
import styles from './CakeForm.module.css';

type Props = {
  // The open cake's id, or null for a new one.
  id: string | null;
  // The cake as the store holds it now: null when it is not there (a new one, or one deleted on another phone while this stayed open).
  cake: Cake | null;
  // How a NEW cake starts (the list's «How do you want to start?»): `zero` takes none of the venue's reference grams. Ignored for a saved cake.
  start?: CakeStart;
  titleRef: Ref<HTMLHeadingElement>;
  // Saved: the editor has nothing more to say (a new cake gets its own address).
  onSaved: (id: string) => void;
  // This form is about to set its own copy aside and mark its own history entry with the copy's key: the editor must not take that mark
  // for a «Resume» of some other copy (which remounts the form).
  onParking?: (key: string) => void;
};

// What each refused number is called, for «Check “…”».
const NUMBER_LABEL: Readonly<Record<PriceField, MessageKey>> = {
  sellingPrice: 'fc.sellingPriceIncludingVat',
  vatRate: 'fc.anotherVatRateAs',
  foodCostTarget: 'fc.foodCostTargetAs',
};

// The Parts card knows only the five parts: a saved 'cost' belongs to the Cost and price card.
const partOnly = (key: StepKey | null): CakePart | null => (key === 'cost' ? null : key);

type ParkedView = { working: Cake; initial: Cake; texts: PriceTexts; tier: number; openStepKey: StepKey | null; selected: Selected | null };

const textOf = (value: number | null): string => (value === null || !Number.isFinite(value) ? '' : String(value));

// One cake, on one page: the drawing, its parts, its measures, its cost and price.
//
// The editing pattern is the app's own (P20) and Food cost's, decision for decision (ProductForm): work on a COPY, nothing touches the
// stored cake until Save, Save is confirmed, the required name is checked first (blocked, jumped to, highlighted), Delete is low-key
// and confirmed, and leaving with unsaved edits asks first.
//
// ⚠️ THE COPY IS MADE ONCE, WHEN THIS FORM MOUNTS (CakeEditor mounts it only once the cake is in the list): a cake changed elsewhere
// afterwards NEVER replaces the copy. A new cake takes the venue's reference grams as they are at that moment.
//
// ⚠️ SAVE IS ONE WRITE: the cake and its Food cost card travel in the same batch (saveProduct with a companion), so a cake and its card
// can never be saved apart; Delete removes both the same way.
// The label view's flag in the location state.
const LABEL_STATE = 'cakeLabel';
const labelOpenIn = (state: unknown): boolean => typeof state === 'object' && state !== null && (state as Record<string, unknown>)[LABEL_STATE] === true;
function withoutLabel(state: unknown): object {
  const { [LABEL_STATE]: _flag, ...rest } = (typeof state === 'object' && state !== null ? state : {}) as Record<string, unknown>;
  return rest;
}

export function CakeForm({ id, cake, start = 'standard', titleRef, onSaved, onParking }: Props) {
  const headingLevel = useCakeHeadingLevel();
  const { t } = useT();
  const store = useFoodcostStore();
  const snap = useFoodcost();
  const { standard, referenceLoaded } = useCakes();
  const { canManage, location, role } = useSession();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const { state, pathname } = useLocation();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;
  const country = countryOf(location);
  const owner = useParkingOwner();

  // ⚠️ A COPY SET ASIDE BY «OPEN IN RECIPES» (cakeParking.ts) COMES BACK WHOLE: the cake as it was typed, what «dirty» is measured
  // against, the price boxes' texts, the open step and the chosen part. It is found by the cake's id; a NEW cake's id travels in the
  // history entry's state. Read here without taking it (React may make this state twice); it is dropped once the form is on screen.
  const [parked] = useState(() => peekParked(id ?? parkedKeyOf(state), owner));

  // A new cake's id is made here, once, and kept by the form for as long as it lives: the same id from the first keystroke to the save.
  const [newId] = useState(() => (id === null ? parked?.key ?? store.newProductId() : ''));
  const cakeId = id ?? newId;
  const productId = cakeProductId(cakeId);

  // ⚠️ «FROM SCRATCH» TAKES NO REFERENCE GRAMS: the cake starts with `ref: null`, so every line needs its grams typed, and the bands about
  // the venue's reference grams stay quiet for it (the person chose to ignore them).
  const [fromScratch] = useState(() => parked?.fromScratch ?? (id === null && start === 'zero'));
  const [initial, setInitial] = useState<Cake>(() => parked?.initial ?? workingFrom(cake, fromScratch ? null : referenceFor(standard, NEW_DIAMETER_CM), newId));
  // A line pointing at a recipe card that has been taken off since (a refusal that arrived while the cake was set aside) does not come back.
  const [working, setWorking] = useState<Cake>(() => (parked ? withoutMissingRecipeCards(parked.working, cardId => snap.products.some(card => card.id === cardId)) : initial));
  const [texts, setTexts] = useState<PriceTexts>(() => {
    if (parked) return parked.texts;
    const vat = vatSelection(initial.vatRate, country);
    return { price: textOf(initial.sellingPrice), target: textOf(initial.foodCostTarget), vatSelect: vat.select, vatOther: vat.other };
  });
  const [tier, setTier] = useState(() => parked?.tier ?? 0);
  // The step that is open: the first one for a new cake, none for a saved one. «Cost and price» is a card of its own (never a step): a
  // copy set aside with it open (the saved key 'cost') brings it back open.
  const [openStepKey, setOpenStepKey] = useState<CakePart | null>(() => partOnly(parked ? parked.openStepKey : startStep(id !== null)));
  // The Parts card is open at the start; the Cost and price card is folded until someone opens it (or Save needs its price box).
  const [partsOpen, setPartsOpen] = useState(true);
  const [costOpen, setCostOpen] = useState(() => parked?.openStepKey === 'cost');
  const [selected, setSelected] = useState<Selected | null>(() => parked?.selected ?? null);
  // The 3D view's second tap on the chosen part: TierParts opens that part's step and puts the cursor in its search box.
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  // A part asked for (a tap in the 3D view, a recipe just made) while the Parts card is folded: the card opens so the request is heard.
  useLayoutEffect(() => { if (openRequest !== null) setPartsOpen(true); }, [openRequest]);
  const [showNameError, setShowNameError] = useState(false);
  const [badNumber, setBadNumber] = useState<PriceField | null>(null);
  const [needsOpen, setNeedsOpen] = useState(false);
  // The button that opened «What you need»: the focus goes back to it on close (the dialog is opened by state, so nothing else would).
  const needsOpener = useRef<HTMLElement | null>(null);
  // The cake's label is a full-screen view INSIDE this form: the form stays mounted behind it, only hidden, so nothing typed is lost and
  // nothing is remounted. ⚠️ IT LIVES IN THE ROUTER'S LOCATION STATE (`cakeLabel`), on a history entry of its own at the same address, so
  // the phone's Back gesture closes the VIEW and not the cake (one level at a time). The view's Back and Escape step that entry back; the
  // focus returns to the row that opened it, where the page was, whichever way it closed.
  const labelOpen = labelOpenIn(state);
  const openedHere = useRef(false);
  const editorRef = useRef<HTMLElement>(null);
  const labelButton = useRef<HTMLButtonElement>(null);
  const labelPlaces = useRef<{ node: HTMLElement; top: number }[] | null>(null);

  // ⚠️ DIRTY IS «DIFFERENT FROM WHAT WAS LAST SAVED» (what Save would write), also kept in a ref: the router's blocker reads it at the
  // moment of a navigation, and a state value read there could be one render behind. `touched` NEVER goes back to false: a cake deleted
  // elsewhere closes this screen only while nobody has typed anything on it.
  const dirty = isDirty(working, initial);
  const dirtyRef = useRef(false);
  useLayoutEffect(() => { dirtyRef.current = dirty; });
  // A restored copy has been typed on by definition.
  const touched = useRef(parked !== null);
  // Taken off the shelf now that it is on screen: from here on the form itself is the unsaved edit (`dirty` marks it busy).
  useEffect(() => {
    if (parked) dropParked(parked.key);
  }, [parked]);
  const edit = (change: (current: Cake) => Cake) => {
    touched.current = true;
    setWorking(current => followStandard(current, change(current), standard));
  };
  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const asking = useRef(false);
  const askingLeave = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Set once this screen is on its way out (deleted, or gone), so nothing asks or says twice.
  const leaving = useRef(false);
  // Set once the working copy has been set aside for the Recipes (openInRecipes): nothing is lost by that move, so the blocker stays quiet.
  const parkedAway = useRef(false);
  // What a parked copy holds, as of the last render (see openInRecipes).
  const onScreen = useRef<ParkedView>({ working: initial, initial, texts, tier, openStepKey, selected });
  useLayoutEffect(() => { onScreen.current = { working, initial, texts, tier, openStepKey: openStepKey ?? (costOpen ? 'cost' : null), selected }; });

  // ⚠️ THE UNSAVED CAKE IS ALSO KEPT ON THE DEVICE (cakeParking.ts): a moment after the last change while the form is dirty, so a window
  // or an app closed with no way to ask (a tablet's recent apps) still finds «Unsaved cake: …» in the list next time. Clean again (saved, or
  // every change taken back): nothing is kept. A form that goes away for any other reason (a part that fails) leaves its last copy there.
  // ⚠️ «CLEAN AGAIN» FORGETS ONLY WHAT THIS FORM HAS REMEMBERED: a form that opens clean (the page reloaded onto it) must not wipe a copy of the
  // same cake that Cakes has yet to offer.
  const remembering = useRef(false);
  useEffect(() => {
    if (owner === null || parkedAway.current) return;
    if (dirty) {
      remembering.current = true;
      rememberCake({ uid: owner.uid, locationId: owner.locationId, key: cakeId, savedId: id, ...onScreen.current, fromScratch });
    } else if (remembering.current) {
      remembering.current = false;
      forgetCake(cakeId);
    }
  }, [dirty, working, initial, texts, tier, openStepKey, costOpen, selected, owner, cakeId, id, fromScratch]);
  useEffect(() => () => { flushRemembered(); }, []);

  const onLeaving = useCallback(() => { handBack.expect(id === null ? NEW_OPENER : productOpener(id)); }, [handBack, id]);
  const leave = useLeave(CAKES_PATH, onLeaving);

  // A cake deleted on another phone while this screen is open and nobody has typed on it: say so and go back to the list. ⚠️ NOT WHEN IT
  // IS THIS FORM'S OWN FIRST SAVE still in the air (a stale snapshot may lack it for a moment) or refused (the store has said so).
  const firstSave = id === null ? null : store.firstSave(productId);
  useEffect(() => {
    if (id === null || cake !== null || touched.current || leaving.current || firstSave === 'sending') return;
    leaving.current = true;
    if (firstSave === null) say(t('cakes.gone'));
    leave();
  }, [id, cake, firstSave, say, t, leave]);

  // ── Leaving with unsaved changes ──────────────────────────────────────────────────────────────
  const discardQuestion = () => confirm({
    title: t('fc.discardChanges'),
    message: t('fc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, the rail and the tab bar
  // all navigate. Staying on the same address is never blocked.
  // ⚠️ ALSO A MOVE TO THE SAME ADDRESS THAT ASKS FOR ANOTHER SET-ASIDE COPY (the list's «Resume» while this new cake is open: both are
  // /cakes/new): the editor remounts the form for it, which would throw this cake's edits away unasked.
  const ownKey = useRef(cakeId);
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (parkedAway.current || !dirtyRef.current) return false;
    const asked = parkedKeyOf(nextLocation.state);
    return currentLocation.pathname !== nextLocation.pathname || (asked !== null && asked !== ownKey.current);
  }, []);
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked' || askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The form went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          forgetCake(cakeId);
          current.proceed();
        } else {
          // Staying: the Back button had already said whose button is owed the focus.
          handBack.forget();
          current.reset();
        }
      } finally {
        askingLeave.current = false;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails silently on a POP
  // to an entry it did not create (a page opened by its address). Once answered the form is clean, so the blocker does not ask again.
  async function back() {
    if (asking.current || askingLeave.current) return;
    if (dirtyRef.current) {
      asking.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        asking.current = false;
      }
      dirtyRef.current = false;
      forgetCake(cakeId);
    }
    leave();
  }

  // ── Focus ─────────────────────────────────────────────────────────────────────────────────────
  const nameBox = useRef<HTMLInputElement>(null);
  const priceBoxes = useRef<Partial<Record<PriceField, HTMLInputElement | null>>>({});
  // The box Save refused, waiting for its step to open (see save()).
  const revealAfterRender = useRef<PriceField | null>(null);
  // The Measures card starts open for a new cake and folded for a saved one. Save with an empty name opens it, and the name box takes the
  // focus once it is on the page.
  const [measuresOpen, setMeasuresOpen] = useState(id === null);
  const focusNameAfterRender = useRef(false);
  // The Cost and price card's title (the ✓ of the last part brings the focus there) and a packaging box Save refused while the Parts card
  // was folded: both wait for their card to be on the page.
  const costButton = useRef<HTMLButtonElement>(null);
  const focusCostAfterRender = useRef(false);
  const focusPackAfterRender = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (focusCostAfterRender.current && costButton.current) {
      focusCostAfterRender.current = false;
      costButton.current.focus();
      if (typeof costButton.current.scrollIntoView === 'function') costButton.current.scrollIntoView({ block: 'start' });
    }
    const pack = focusPackAfterRender.current;
    if (pack !== null && packBoxes.current.has(pack)) {
      focusPackAfterRender.current = null;
      reveal(packBoxes.current.get(pack));
    }
    if (focusNameAfterRender.current && nameBox.current) {
      focusNameAfterRender.current = false;
      reveal(nameBox.current);
    }
    const field = revealAfterRender.current;
    if (field === null) return;
    const node = priceBoxes.current[field];
    if (!node) return;
    revealAfterRender.current = null;
    reveal(node);
  });
  const registerPrice = useCallback((field: PriceField, node: HTMLInputElement | null) => { priceBoxes.current[field] = node; }, []);
  const packBoxes = useRef(new Map<string, HTMLInputElement>());
  const registerPack = useCallback((ingredientId: string, node: HTMLInputElement | null) => {
    if (node) packBoxes.current.set(ingredientId, node); else packBoxes.current.delete(ingredientId);
  }, []);
  const reveal = (node: HTMLElement | null | undefined) => {
    if (!node) return;
    node.focus();
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
  };

  // ── The price, the VAT and the target: typed as text, read into the cake ───────────────────────
  const setPriceText = (text: string) => {
    if (badNumber === 'sellingPrice') setBadNumber(null);
    setTexts(current => ({ ...current, price: text }));
    edit(current => setPrice(current, text));
  };
  const setTargetText = (text: string) => {
    if (badNumber === 'foodCostTarget') setBadNumber(null);
    setTexts(current => ({ ...current, target: text }));
    edit(current => setTarget(current, text));
  };
  const setVatSelect = (value: string) => {
    if (badNumber === 'vatRate') setBadNumber(null);
    // ⚠️ THE BOX SHOWS THE RATE THAT WILL BE SAVED: going back to «another rate» after picking one from the menu opens it on that rate.
    const other = value === 'other' ? textOf(vatFromSelect(texts.vatSelect, texts.vatOther)) : texts.vatOther;
    setTexts(current => ({ ...current, vatSelect: value, vatOther: other }));
    edit(current => setVat(current, vatFromSelect(value, other)));
  };
  const setVatOther = (text: string) => {
    if (badNumber === 'vatRate') setBadNumber(null);
    setTexts(current => ({ ...current, vatOther: text }));
    edit(current => setVat(current, vatFromSelect('other', text)));
  };
  // A rate chosen in the guide goes through the SAME rule the menu opens with: a rate the country's menu does not offer lands in
  // «another rate», unchanged.
  const applyVatRate = (rate: number) => {
    if (badNumber === 'vatRate') setBadNumber(null);
    const selection = vatSelection(rate, country);
    setTexts(current => ({ ...current, vatSelect: selection.select, vatOther: selection.other }));
    edit(current => setVat(current, rate));
  };

  // ── Save and delete ───────────────────────────────────────────────────────────────────────────
  async function save() {
    if (asking.current || askingLeave.current || leaving.current) return;

    // The ONE required field. Everything else may be missing — the cost card says what, and refusing the save would mean losing the work.
    const name = working.name.trim();
    if (name === '') {
      setShowNameError(true);
      if (nameBox.current) reveal(nameBox.current);
      else {
        focusNameAfterRender.current = true;
        setMeasuresOpen(true);
      }
      say(t('cakes.nameEmpty'));
      return;
    }

    // ⚠️⚠️ A NUMBER THE DATABASE WILL REFUSE STOPS THE SAVE HERE, WHILE THE WORK IS ON SCREEN (shared/product-limits): past this point
    // the save is local-first, the screen leaves, the refusal arrives later and the rollback throws the cake away.
    // The cakes rule also caps the price (products have no ceiling), so the form asks for it too.
    const product = cakeProduct(working);
    const invalid = firstInvalidNumber(product) ?? (product.sellingPrice !== null && product.sellingPrice > MAX_SELLING_PRICE ? 'sellingPrice' : null);
    if (invalid === 'sellingPrice' || invalid === 'vatRate' || invalid === 'foodCostTarget') {
      setBadNumber(invalid);
      // The price, VAT and target boxes live in the Cost and price card: it opens, and the box takes the focus once it is on the page.
      setCostOpen(true);
      revealAfterRender.current = invalid;
      reveal(priceBoxes.current[invalid]);
      say(t('fc.checkNumber', { field: t(NUMBER_LABEL[invalid]) }));
      return;
    }
    const emptyPack = firstEmptyPack(working);
    if (emptyPack !== null) {
      if (packBoxes.current.has(emptyPack)) reveal(packBoxes.current.get(emptyPack));
      else {
        focusPackAfterRender.current = emptyPack;
        setPartsOpen(true);
      }
      const named = snap.ingredients[emptyPack];
      say(t('cakes.checkPack', { name: String(named?.name ?? '') }));
      return;
    }

    asking.current = true;
    try {
      const ok = await confirm({
        title: t('cakes.saveQ'),
        message: t('cakes.saveBody'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }

    const nowIso = new Date().toISOString();
    const named = { ...working, id: cakeId, name };
    const clean = cakeProduct(named);
    // The margin point (productEditorModel.marginPointFor): only when the price or the composition changed, against the card as it is stored now.
    const stored = snap.products.find(candidate => candidate.id === productId) ?? null;
    const point = marginPointFor(stored, clean, snap.tables, nowIso);

    // Saved: nothing is unsaved any more, so leaving asks nothing. The blocker reads the ref at the moment of the navigation below.
    dirtyRef.current = false;
    forgetCake(cakeId);
    touched.current = true;
    setInitial(named);
    setWorking(named);
    store.saveProduct({ product: clean, snapshot: point, lossPatches: {}, companion: { kind: 'cake', id: cakeId, data: toCakeDocument(named, nowIso) } });
    announceAction('cakes-saved');
    say(t('cakes.saved'));
    // ⚠️ STAYS ON THE CAKE (it is saved to the price list, not closed): a new cake only gets its own address.
    onSaved(cakeId);
  }

  async function remove() {
    if (id === null || asking.current || askingLeave.current || leaving.current) return;
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('cakes.deleteQ'),
        message: t('cakes.deleteBody'),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }
    leaving.current = true;
    dirtyRef.current = false;
    forgetCake(cakeId);
    store.deleteProduct(productId, { kind: 'cake', id });
    say(t('cakes.deleted'));
    leave();
  }

  // ── «+ New recipe» ────────────────────────────────────────────────────────────────────────────
  // ⚠️ ONLY SOMEONE WHO MAY USE THE RECIPES gets the option: the same question the rail asks about its door (visibility.ts); the rules
  // (recipes: canUse 'catalogue') are the real guard, this is the courtesy that keeps the option from ending in a refusal.
  const mayMakeRecipes = useMemo(() => visibleSectionIds(location, canManage, role).has('recipes'), [location, canManage, role]);
  const mayOpenIngredients = useMemo(() => visibleSectionIds(location, canManage, role).has('suppliers'), [location, canManage, role]);
  // Where each card made here was put, so a refusal can take it off the cake again.
  const madeHere = useRef(new Map<string, { tier: number; part: CakePart }>());
  const latestEdit = useRef(edit);
  useLayoutEffect(() => { latestEdit.current = edit; });
  useEffect(() => store.onMessage(message => {
    if (message.kind !== 'recipe-not-created') return;
    const placed = madeHere.current.get(message.productId);
    if (!placed) return;
    madeHere.current.delete(message.productId);
    latestEdit.current(current => removeCard(current, placed.tier, placed.part, message.productId));
  }), [store]);

  // «+ “…” from Recipes»: the recipe exists and has no Food cost card, so only the card is made (never a second recipe). The card of a
  // recipe with real ingredients carries its real weight, exactly as Food cost's «Cards from the Recipes» makes it. Server-checked, so
  // offline it fails and says so; the part takes the card only once it exists.
  async function cardFromBook(recipeId: string): Promise<boolean> {
    const recipe = snap.recipes[recipeId];
    if (!recipe) return false;
    const result = await store.createProductsFromRecipes([recipe], { [recipeId]: 'semi' });
    if (!mounted.current) return false;
    if (result.failed > 0) {
      say(t('cakes.newRecipe.bookFailed', { name: String(recipe.name ?? '').trim() }));
      return false;
    }
    return true;
  }

  // The recipe's name is bounded by the rules (under 200 characters).
  const MAX_RECIPE_NAME = 199;

  async function newRecipe(typed: string, part: CakePart) {
    const name = typed.trim().slice(0, MAX_RECIPE_NAME);
    if (name === '') return;
    const recipeId = newRecipeId();
    const cardId = store.createRecipeWithCard(recipeId, newRecipeData(name));
    madeHere.current.set(cardId, { tier: shownTier, part });
    edit(current => addCard(current, shownTier, part, cardId));

    asking.current = true;
    let open = false;
    try {
      // «Continue the cake» is the safe answer, the default and what Escape means.
      open = await confirm({
        title: t('cakes.newRecipe.createdTitle'),
        message: t('cakes.newRecipe.createdBody', { name }),
        okLabel: t('cakes.newRecipe.open'),
        cancelLabel: t('cakes.newRecipe.continue'),
      });
    } finally {
      asking.current = false;
    }
    if (!mounted.current) return;
    if (open) {
      await openInRecipes(recipeId);
      return;
    }
    // After the dialog's own focus restore (it runs on the next frame), the new card's grams box has the last word, as after any pick.
    // ⚠️ NOT THE SEARCH BOX: it opens its list on focus (menuTrigger "focus"), and the list would cover the line just added.
    requestAnimationFrame(() => { requestAnimationFrame(() => { if (mounted.current) setOpenRequest({ part, productId: cardId }); }); });
  }

  // ⚠️ THE UNSAVED COPY IS SET ASIDE, NOT ASKED ABOUT: it is parked in memory (cakeParking.ts) and the move is not blocked, so the
  // person comes back to exactly this cake, and the dirty mark with it. A NEW cake's history entry is marked with its id first (the same
  // address, replaced, so nothing is blocked) because /cakes/new alone cannot tell which copy is meant.
  async function parkAndGo(path: string, to: object) {
    // ⚠️ READ FROM THE REF: this runs after a dialog was answered, from the closure of the render that opened it, which does not have the card just added.
    if (owner === null) return;
    parkedAway.current = true;
    parkCake({ uid: owner.uid, locationId: owner.locationId, key: cakeId, savedId: id, ...onScreen.current, fromScratch });
    onParking?.(cakeId);
    await navigate(pathname, { replace: true, state: { ...withoutLabel(state), parkedCake: cakeId } });
    await navigate(path, { state: to });
  }

  async function openInRecipes(recipeId: string) {
    await parkAndGo(editPath(recipeId), FROM_CAKE);
  }

  // ⚠️ THE SAME SET-ASIDE FOR THE LABEL'S «Open the ingredient» (the ingredient's card in Ingredients & suppliers): its Back is the browser's
  // Back (`fromList`), which lands on this cake's own entry, marked with the copy's key — the cake comes back as it was typed.
  async function openIngredient(ingredientId: string) {
    const path = ingredientCardPath(ingredientId);
    if (path !== null) await parkAndGo(path, { ...KEEP_FOCUS, fromList: true });
  }

  // ── The cake's label ──────────────────────────────────────────────────────────────────────────
  // The scrolling ancestors of the form (the shell's area, and the open cake's own layer from 700px): the view starts at the top of them and
  // Back puts the form back where it was.
  const openLabel = () => {
    const places: { node: HTMLElement; top: number }[] = [];
    for (let node = editorRef.current?.parentElement ?? null; node !== null; node = node.parentElement) {
      const overflow = window.getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') places.push({ node, top: node.scrollTop });
    }
    labelPlaces.current = places;
    openedHere.current = true;
    void navigate(pathname, { state: { ...(state as object | null), ...KEEP_FOCUS, [LABEL_STATE]: true } });
  };
  // A view that is open on an entry this form did not push (the page was reloaded onto it) has no entry under it to step back to.
  const closeLabel = () => {
    if (openedHere.current) void navigate(-1);
    else void navigate(pathname, { replace: true, state: withoutLabel(state) });
  };
  const wasLabelOpen = useRef(false);
  useLayoutEffect(() => {
    if (labelOpen) {
      wasLabelOpen.current = true;
      labelPlaces.current?.forEach(place => { place.node.scrollTop = 0; });
      return;
    }
    if (!wasLabelOpen.current) return;
    wasLabelOpen.current = false;
    openedHere.current = false;
    labelPlaces.current?.forEach(place => { place.node.scrollTop = place.top; });
    labelPlaces.current = null;
    labelButton.current?.focus({ preventScroll: true });
  }, [labelOpen]);

  // ── What is drawn ─────────────────────────────────────────────────────────────────────────────
  const forCost = useMemo(() => costable(working), [working]);
  const totals = useMemo(() => cakeTotals(forCost, snap.tables), [forCost, snap.tables]);
  const geometry = useMemo(() => cakeGeometry(working), [working]);
  const showLabour = Number(snap.tables.labourCostPerHour) > 0;
  const shownTier = Math.min(tier, working.tiers - 1);
  const heading = id === null ? t('cakes.new') : initial.name.trim() === '' ? t('cakes.untitled') : initial.name;

  const cardNames = useMemo(() => new Map(snap.products.map(card => [card.id, card.name] as const)), [snap.products]);
  // What each part of each tier holds, for its callout on the 3D view: grams and the raw-material cost of its cards.
  const figures = useMemo(() => partFigures(cakeLineCosts(working, snap.tables)), [working, snap.tables]);
  // «Raw materials so far»: the cake's raw materials as the cost step says them (a figure with «+?» is a floor, not the cost).
  const partial = totals.partial || totals.unpricedIds.length > 0 || totals.missingLines > 0;
  const rawText = totals.materials === null ? '—' : `${fcMoney(totals.materials, money)}${partial ? ' +?' : ''}`;
  const hasParts = working.lines.some(line => line.tier < working.tiers) || working.packaging.length > 0;
  // Folded, the Parts card names the parts that hold a recipe (on any tier), in the order a cake is built.
  const filledParts = STEP_PARTS.filter(part => working.lines.some(line => line.tier < working.tiers && line.part === part));
  const partsSummary = filledParts.length === 0
    ? t('cakes.parts.summaryNone', { total: STEP_PARTS.length })
    : t('cakes.parts.summary', { names: filledParts.map(part => t(`cakes.part.${part}`)).join(', '), done: filledParts.length, total: STEP_PARTS.length });
  // Folded, the Cost and price card says the raw materials, and the price once one is set.
  const costBase = hasParts ? t('cakes.steps.costSummary', { cost: rawText }) : '—';
  const costSummary = forCost.sellingPrice === null ? costBase : t('cakes.cost.summaryPrice', { cost: costBase, price: fcMoney(forCost.sellingPrice, money) });
  const labels = useMemo<StageLabels>(() => ({
    summary: t('cakes.stage.summary', { n: working.tiers, discs: t('cakes.stage.discCount', { n: working.discs }) }),
    part: {
      decoration: t('cakes.part.decoration'), coating: t('cakes.part.coating'), filling: t('cakes.part.filling'),
      soak: t('cakes.part.soak'), base: t('cakes.part.base'),
    },
    cardName: cardId => (cardNames.get(cardId) ?? '').trim(),
    grams: grams => t('cakes.grams', { g: localNumber(String(Math.round(grams)), money) }),
    diameter: diameterCm => t('cakes.row.diameter', { d: diameterCm }),
    callout: (tierIndex, part) => {
      const held = figures.get(partKey(tierIndex, part));
      if (!held) return '';
      if (held.missingGrams) return t('cakes.gramsToType');
      const grams = t('cakes.grams', { g: localNumber(String(Math.round(held.grams)), money) });
      // ⚠️ A CARD WITH NO COST (a recipe still empty, or never priced) says the cost is incomplete, never a money figure.
      return t('cakes.callout.figures', { grams, cost: held.materials === null ? t('cakes.row.incomplete') : fcMoney(held.materials, money) });
    },
    total: hasParts ? t('cakes.stage.total', { cost: rawText }) : '',
  }), [t, money, working.tiers, working.discs, cardNames, figures, hasParts, rawText]);

  const venueRef = referenceFor(standard, working.diameterCm);
  // ⚠️ A CAKE WITH NO REFERENCE OF ITS OWN IS «TYPED BY HAND» once the venue has reference grams: a saved «from scratch» cake (it keeps
  // `ref: null`) must not claim its grams were left out. With no venue reference at all it is the «no reference» case below.
  const typedByHand = fromScratch || (working.ref === null && venueRef !== null);
  // «The reference changed → update» is useful to a cake with no reference of its own only while some line has no grams at all.
  // ⚠️ A cake WITH a reference differs only when it is not the table's figures at the reference's own diameter (refIsCurrent).
  const refDiffers = !fromScratch && venueRef !== null && (working.ref !== null
    ? !refIsCurrent(working.ref, standard)
    : referenceChanged(working, venueRef) && working.lines.some(line => line.grams === null));
  // An existing cake with none of its own does not claim «no reference» before the venue's has answered.
  const noReference = !fromScratch && working.ref === null && venueRef === null && (id === null || referenceLoaded);

  return (
    <>
    <section ref={editorRef} className={styles.editor} aria-labelledby={titleId} hidden={labelOpen}>
      <FormBar
        level={headingLevel}
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={heading}
        titleId={titleId}
        titleRef={titleRef}
        {...(cake === null ? {} : { titleAfter: <span className={styles.pill}>{t('cakes.pill.listed')}</span> })}
        action={
          <div className={styles.actions}>
            {id !== null && canManage ? (
              <Button variant="bare" className={styles.trash} aria-label={t('cakes.deleteAria')} onPress={() => { void remove(); }}>
                <Trash2 aria-hidden="true" />
              </Button>
            ) : null}
            <Button variant="primary" onPress={() => { void save(); }}>
              <Check aria-hidden="true" />
              {t('cakes.save')}
            </Button>
          </div>
        }
      />

      <div className={styles.body}>
        {refDiffers ? (
          <div className={styles.band} role="note">
            <p>{t('cakes.band.refChanged')}</p>
            <Button onPress={() => { edit(current => takeReference(current, venueRef)); }}>{t('cakes.band.refUpdate')}</Button>
          </div>
        ) : null}
        {noReference ? (
          <div className={styles.band} role="note">
            <p>{t('cakes.band.refNone')}</p>
            <Button onPress={() => { void navigate(referencePath, { state: FROM_LIST }); }}>{t('cakes.band.refOpen')}</Button>
          </div>
        ) : null}

        <div className={styles.grid}>
          <div className={styles.main}>
            <div className={`${styles.card} ${styles.stage}`}>
              <PartBoundary>
                <CakeStage
                  geometry={geometry}
                  selected={selected}
                  tier={shownTier}
                  onSelect={next => { setTier(next.tier); setSelected(next); }}
                  onOpenPart={next => { setTier(next.tier); setSelected(next); setOpenRequest({ part: next.part }); }}
                  labels={labels}
                />
              </PartBoundary>
            </div>
          </div>
          <div className={styles.side}>
            <div className={styles.measures}>
              <MeasuresCard cake={working} edit={edit} nameRef={nameBox} nameInvalid={showNameError && working.name.trim() === ''} open={measuresOpen} onToggle={setMeasuresOpen} />
            </div>
            <section className={`${styles.card} ${styles.parts}`} aria-labelledby={`${ids}-parts`}>
              <h3 id={`${ids}-parts`} className={styles.cardTitle}>
                <FoldTitle title={t('cakes.parts.title')} summary={partsSummary} open={partsOpen} onToggle={setPartsOpen} bodyId={`${ids}-parts-body`} />
              </h3>
              {partsOpen ? (
                <div id={`${ids}-parts-body`} role="group" aria-labelledby={`${ids}-parts`}>
                  <PartBoundary>
                    <TierParts
                      cake={working}
                      typedByHand={typedByHand}
                      edit={edit}
                      tier={shownTier}
                      onTier={next => { setTier(next); }}
                      selected={selected}
                      onSelect={next => { setSelected(next); }}
                      registerPack={registerPack}
                      openRequest={openRequest}
                      onNewRecipe={mayMakeRecipes ? (name, part) => { void newRecipe(name, part); } : undefined}
                      onCardFromBook={mayMakeRecipes ? cardFromBook : undefined}
                      onOpenHandled={() => { setOpenRequest(null); }}
                      open={openStepKey}
                      onOpen={setOpenStepKey}
                      onOpenCost={() => {
                        setOpenStepKey(null);
                        setCostOpen(true);
                        focusCostAfterRender.current = true;
                      }}
                    />
                  </PartBoundary>
                </div>
              ) : null}
            </section>
            <section className={`${styles.card} ${styles.cost}`} aria-labelledby={`${ids}-cost`}>
              <h3 id={`${ids}-cost`} className={styles.cardTitle}>
                <FoldTitle title={t('cakes.cost.title')} summary={costSummary} open={costOpen} onToggle={setCostOpen} bodyId={`${ids}-cost-body`} buttonRef={costButton} />
              </h3>
              {costOpen ? (
                <div id={`${ids}-cost-body`} role="group" aria-labelledby={`${ids}-cost`}>
                  <PartBoundary>
                    <CostCard
                      totals={totals}
                      sellingPrice={forCost.sellingPrice}
                      texts={texts}
                      showLabour={showLabour}
                      invalid={badNumber}
                      slices={working.slices}
                      onSlices={n => { edit(current => setMeasure(current, 'slices', n)); }}
                      assemblyMinutes={working.assemblyMinutes}
                      onAssembly={n => { edit(current => setMeasure(current, 'assemblyMinutes', n)); }}
                      onPrice={setPriceText}
                      onTarget={setTargetText}
                      onVatSelect={setVatSelect}
                      onVatOther={setVatOther}
                      onVatGuide={applyVatRate}
                      registerBox={registerPrice}
                      onOpenNeeds={opener => {
                        needsOpener.current = opener;
                        setNeedsOpen(true);
                      }}
                    />
                  </PartBoundary>
                </div>
              ) : null}
            </section>
            <section className={`${styles.card} ${styles.label}`} aria-labelledby={`${ids}-label`}>
              <h3 id={`${ids}-label`} className={styles.cardTitle}>
                <CakeLabelRow cake={working} onOpen={openLabel} buttonRef={labelButton} />
              </h3>
            </section>
          </div>
        </div>
      </div>
      {confirmDialog}
      {needsOpen ? (
        <PartBoundary>
          <NeedDialog
            cake={working}
            onClose={() => {
              setNeedsOpen(false);
              const opener = needsOpener.current;
              needsOpener.current = null;
              // After the dialog's own focus restore (it runs on the next frame) so the opener has the last word.
              if (opener) requestAnimationFrame(() => { requestAnimationFrame(() => { if (opener.isConnected) opener.focus(); }); });
            }}
          />
        </PartBoundary>
      ) : null}
    </section>
    {labelOpen ? (
      <CakeLabelView
        cake={working}
        onBack={closeLabel}
        onOpenIngredient={mayOpenIngredients ? ingredientId => { void openIngredient(ingredientId); } : undefined}
        onOpenRecipe={mayMakeRecipes ? recipeId => { void openInRecipes(recipeId); } : undefined}
      />
    ) : null}
    </>
  );
}
