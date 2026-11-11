import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { BookOpen, Check } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import {
  PACK_UNITS, costProduct, currentProduct, productCooking, productSnapshot, productsUsingRecipe, snapshotWorthTaking, vatRatesFor, vatSelection,
} from '@mise/shared/foodcost-model';
import { otherProductsUsing, readWeighing, weighingPatches } from '@mise/shared/foodcost-weighing';
import type { LineUnit, PackUnit, Product, ProductDraft, SellingMode } from '@mise/shared/foodcost-model';
import type { KiloLineUnit } from '@mise/shared/line-quantity';
import { normalizeLossPct } from '@mise/shared/catalogue-model';
import { countryOf } from '@mise/shared/market';
import { firstInvalidNumber } from '@mise/shared/product-limits';
import { isSectionAllowed } from '@mise/shared/sections';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SPLIT_QUERY } from '../ui/split';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import { entryPath, historyPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { FROM_PRODUCT, entryState, pushDepth } from './foodcostNav';
import { useHandBack } from './handBack';
import { LineRow } from './LineRow';
import type { LineKind } from './LineRow';
import { lineMoney, lineName, lineNote } from './lineNotes';
import { NameSuggest } from './NameSuggest';
import { NumberBox } from './NumberBox';
import { PickDialog } from './PickDialog';
import type { Choice, PickMode } from './PickDialog';
import { CardSection, CardStack, FullCard } from './FullCard';
import { CookingSection } from './CookingSection';
import { ProductActions } from './ProductActions';
import { ProductAnswer, SuggestedPrice } from './ProductAnswer';
import { PerKgBlock } from './PerKgBlock';
import { ProductSummary } from './ProductSummary';
import {
  NUMBER_KEY, RECIPE_LINE_OPENS_IN, clearNumber, costable, emptyWorking, firstBadWeight, followsTotal, isNumberField, isShown, newLineKey,
  packSizeShown, piecesShown, plainNumber, rawBoxText, recipeLineKg, recipeLossHint, recipeWeighing, settleRaw, toProduct, vatRateOf,
  workingFrom, workingFromDraft,
} from './productEditorModel';
import type { NumberField, WeightField, Working, WorkingComponent } from './productEditorModel';
import { VatGuideDialog } from './VatGuideDialog';
import { useProductExit } from './useProductExit';
import shell from './ProductEditor.module.css';
import styles from './ProductForm.module.css';

type Props = {
  // The open product's id, or null for a new one.
  id: string | null;
  // The product as the list holds it now: null when it is not there (a new one, or one deleted on
  // another phone while this screen stayed open).
  product: Product | null;
  // A new product started from a recipe (draftFromRecipe), or null.
  draft: ProductDraft | null;
  // Where the person came from, when it was a recipe: the product's Back (and the draft's) returns to
  // the recipe, or to the narrowed list for «using».
  origin: Origin;
  titleRef: Ref<HTMLHeadingElement>;
  // Saved: the screen has nothing more to say, and the read view of the saved product (a new one included) takes its place.
  onSaved: (id: string) => void;
  // Opened with the pencil from the read view of the same product: Back returns to it (one level up) instead of leaving. Null for
  // a form opened straight (a new product, one with nothing costed), which has no read view below it.
  onBackToRead: (() => void) | null;
};

type Picking = { mode: PickMode; query: string; apply: (choice: Choice) => void };

// The words that name each number, for «Check “…”» and for the box's own name.
const NUMBER_LABEL = {
  piecesPerBatch: 'fc.howManyPiecesCome',
  packSize: 'fc.packHoldsAs',
  labourMinutes: 'fc.labourMinutes',
  labourPeople: 'fc.labourPeople',
  sellingPrice: 'fc.sellingPriceIncludingVat',
  vatRate: 'fc.anotherVatRateAs',
  foodCostTarget: 'fc.foodCostTargetAs',
  rawGrams: 'fc.rawDough',
  cookedGrams: 'fc.cookedDough',
} as const satisfies Record<NumberField | WeightField, MessageKey>;

const PACKAGING_PER = {
  piece: 'fc.packagingPer.piece',
  pack: 'fc.packagingPer.pack',
  weight: 'fc.packagingPer.kg',
} as const satisfies Record<SellingMode, MessageKey>;

// Keys, resolved when the menu is drawn.
const VAT_WORDS: Readonly<Record<string, MessageKey>> = {
  'fc.vat.standard': 'fc.vat.standard',
  'fc.vat.reduced': 'fc.vat.reduced',
  'fc.vat.minimum': 'fc.vat.minimum',
  'fc.vat.zero': 'fc.vat.zero',
};

// One product, on one page.
//
// ONE PAGE, NOT A WIZARD (the design's decision): the fields that only apply to one way of selling
// appear and disappear with the choice, rather than the product being built through a sequence nobody
// can go back through.
//
// The editing pattern is the app's own (P20): work on a COPY, nothing touches the stored product until
// Save, Save is confirmed, the required field is validated before saving, Delete is low-key and
// confirmed, and leaving with unsaved edits asks first. A port of js/foodcost/foodcost-editor.js,
// decision for decision.
//
// ⚠️ THE COPY IS MADE ONCE, WHEN THIS FORM MOUNTS — and ProductEditor mounts it only once the product
// is in the list (the Pastries' editor-copies-too-early trap). A product changed elsewhere afterwards
// NEVER replaces the copy; the lines and every answer pick up new recipes and prices as they arrive.
export function ProductForm({ id, product, draft, origin, titleRef, onSaved, onBackToRead }: Props) {
  const { t, locale } = useT();
  const store = useFoodcostStore();
  const snap = useFoodcost();
  const { canManage, location } = useSession();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const { state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;

  // ⚠️ ASKED HERE, WHERE THE FIELDS ARE DRAWN: the venue — and so its country — arrives with the session, and decides the VAT menu.
  const country = countryOf(location);
  // ⚠️ THE VENUE'S SECTION, NOT THE ROLE'S: a product made of one recipe writes that recipe's weighing too, and only a venue that has the
  // catalogue section may (a venue with Food cost on and the catalogue off can read its recipes but not write them, and a write that is
  // always refused would still record a margin point). The owner of the sales side has no catalogue role and may still write these three
  // numbers (weighsRecipeLoss in firestore.rules): asking the role's sections would hide the write from the very person meant to make it.
  const canWeigh = isSectionAllowed(location, 'catalogue');

  // What the product was when this form opened: what a margin point is compared with. ⚠️ THE CONVERTED PRODUCT (model 3): a product
  // saved before holds finished kilos on its recipe lines, and the copy below must hold the raw kilos they now mean. ProductEditor
  // mounts the form only once the server has answered about the recipes (waitsForTables) — or, with no signal or a recipes
  // stream that died, on this phone's copy, which is then all there will be, and only when it holds every recipe on the product's
  // lines (recipesOnLinesHere).
  const [initial] = useState(() => (product === null ? null : currentProduct(product, snap.tables)));
  const [working, setWorking] = useState<Working>(() => {
    if (initial) return workingFrom(initial, country);
    return draft ? workingFromDraft(draft) : emptyWorking();
  });
  const productId = id ?? '';

  // ⚠️ DIRTY IS «SOMETHING WAS TYPED SINCE THE LAST SAVE», also kept in a ref: the router's blocker
  // reads it at the moment of a navigation, and a state value read there could be one render behind.
  // `touched` NEVER goes back to false: a product deleted elsewhere closes this screen only while
  // nobody has typed anything on it.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const touched = useRef(false);
  const setDirtyBoth = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };
  const edit = (change: (current: Working) => Working) => {
    touched.current = true;
    setDirtyBoth(true);
    setWorking(change);
  };

  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  // Set once this screen is on its way out (saved, deleted, or gone), so nothing asks or says twice.
  const leaving = useRef(false);

  // Delete leaves for the list — the narrowed one when that is where the product was opened from. Back, though, returns to the
  // recipe when the recipe opened this screen.
  const { leave, goBack } = useProductExit(id, origin);

  // ── What is typed, and what it costs ───────────────────────────────────────────────────────────
  const [showNameError, setShowNameError] = useState(false);
  const [badNumber, setBadNumber] = useState<NumberField | WeightField | null>(null);
  const [nameNote, setNameNote] = useState('');
  const [picking, setPicking] = useState<Picking | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  const costed = useMemo(() => costable(working, productId), [working, productId]);
  // The lines' raw total in grams: what the raw box shows while nothing is typed apart, and what «use the total» brings back.
  const cooking = productCooking(costed, snap.tables);
  const totalGrams = cooking.rawTotalKg * 1000;

  // A product deleted on another phone while this screen is open and nobody has typed on it: say so
  // and go back to the list. With typing on it, it is kept (Save would put it back).
  // ⚠️ NOT WHEN IT IS A NEW PRODUCT'S OWN FIRST SAVE that went wrong: still in the air it waits (a stale snapshot may only lack it for
  // a moment), refused it leaves without a word — the store has said «… wasn't saved», and «Product deleted.» would overwrite it.
  const firstSave = id === null ? null : store.firstSave(id);
  useEffect(() => {
    if (id === null || product !== null || touched.current || leaving.current || firstSave === 'sending') return;
    leaving.current = true;
    if (firstSave === null) say(t('fc.productDeleted'));
    leave();
  }, [id, product, firstSave, say, t, leave]);

  // ⚠️ THE DRAFT GIVES WAY (the current app's reconsiderDraft). A product made with the recipe that was not
  // known when this draft opened (a slow first load, another phone) must win: saving the draft would be a
  // DUPLICATE with a margin history of its own. So, while NOTHING has been typed and no save is under way,
  // the entry decides again — it finds the real product, or the narrowed list.
  const draftRecipe = draft === null ? null : origin.recipe;
  const madeWithIt = draftRecipe !== null && productsUsingRecipe(snap.products, draftRecipe).length > 0;
  useEffect(() => {
    if (draftRecipe === null || !madeWithIt) return;
    if (touched.current || leaving.current || asking.current || askingLeave.current) return;
    void navigate(entryPath(draftRecipe), { replace: true, state: entryState(state) });
  }, [draftRecipe, madeWithIt]);

  // ── Leaving with unsaved changes ───────────────────────────────────────────────────────────────
  const discardQuestion = () => confirm({
    title: t('fc.discardChanges'),
    message: t('fc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's
  // Back, a product picked in the split's list, the rail and the tab bar all navigate. Staying on
  // the same address is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const askingLeave = useRef(false);
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

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the
  // router's blocker fails silently on a POP to an entry it did not create (a page opened by its
  // address). Once answered the form is clean, so the blocker does not ask again.
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
      setDirtyBoth(false);
    }
    // A form opened by the pencil goes back to the read view it came from; any other leaves.
    if (onBackToRead !== null) onBackToRead();
    else goBack();
  }

  // ── Focus ──────────────────────────────────────────────────────────────────────────────────────
  const nameBox = useRef<HTMLInputElement>(null);
  const rawBox = useRef<HTMLInputElement>(null);
  const cookedBox = useRef<HTMLInputElement>(null);
  const numberBoxes = useRef<Partial<Record<NumberField, HTMLInputElement | null>>>({});
  const boxRef = (field: NumberField) => (node: HTMLInputElement | null) => { numberBoxes.current[field] = node; };
  const qtyBoxes = useRef(new Map<string, HTMLInputElement>());
  const registerQty = useCallback((key: string, node: HTMLInputElement | null) => {
    if (node) qtyBoxes.current.set(key, node); else qtyBoxes.current.delete(key);
  }, []);
  // The line just added: straight to its amount, the next thing a person fills in.
  const focusQtyOf = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focusQtyOf.current;
    if (key === null) return;
    const node = qtyBoxes.current.get(key);
    if (!node) return;
    focusQtyOf.current = null;
    node.focus();
  });

  const reveal = (node: HTMLElement | null | undefined) => {
    if (!node) return;
    node.focus();
    if (typeof node.scrollIntoView === 'function') node.scrollIntoView({ block: 'center' });
  };

  // ── Editing ────────────────────────────────────────────────────────────────────────────────────
  const setNumber = (field: NumberField, text: string) => {
    if (badNumber === field) setBadNumber(null);
    edit(current => ({ ...current, [NUMBER_KEY[field]]: text }));
  };

  // ⚠️ A TYPED BOX IS «A PERSON TYPED IN COTTURA» (cookingTyped): only then does a product made of one recipe write that recipe's weighing.
  const setRaw = (text: string) => {
    if (badNumber === 'rawGrams') setBadNumber(null);
    edit(current => ({ ...current, rawText: text, cookingTyped: true }));
  };

  const setCooked = (text: string) => {
    if (badNumber === 'cookedGrams') setBadNumber(null);
    edit(current => ({ ...current, cookedText: text, cookingTyped: true }));
  };

  // Leaving the raw box: empty, or within 0.05 g of the total, goes back to following the total. Not a change a person made, so it marks nothing.
  const settleRawBox = () => { setWorking(current => settleRaw(current, totalGrams)); };

  const useTotal = () => {
    if (badNumber === 'rawGrams') setBadNumber(null);
    edit(current => ({ ...current, rawText: null, cookingTyped: true }));
    // The button disappears: the focus goes where the weight it brought back is.
    rawBox.current?.focus();
  };

  const setVatSelect = (value: string) => {
    if (badNumber === 'vatRate') setBadNumber(null);
    edit(current => {
      if (value !== 'other') return { ...current, vatSelect: value };
      // ⚠️ THE BOX SHOWS THE RATE THAT WILL BE SAVED: going back to «another rate» after picking one
      // from the menu left the box on its OLD number while Save stored the one just picked.
      const rate = vatRateOf(current);
      return { ...current, vatSelect: 'other', vatOther: rate === null || Number.isNaN(rate) ? '' : String(rate) };
    });
  };

  // A rate chosen in the guide goes through the SAME rule the menu opens with: a rate the country's
  // menu does not offer — Italy's 5% — lands in «another rate», unchanged.
  const applyVat = (rate: number) => {
    const selection = vatSelection(rate, country);
    if (badNumber === 'vatRate') setBadNumber(null);
    edit(current => ({ ...current, vatSelect: selection.select, vatOther: selection.other }));
  };

  const addLine = () => {
    setPicking({
      mode: working.components.length > 0 ? 'line' : 'recipe',
      query: '',
      apply: choice => {
        const key = newLineKey();
        edit(current => ({
          ...current,
          components: [...current.components, choice.kind === 'recipe'
            ? { key, kind: 'recipe', recipeId: choice.id, qty: '', unit: RECIPE_LINE_OPENS_IN }
            : { key, kind: 'ingredient', ingredientId: choice.id, qty: '', unit: 'g' }],
        }));
        focusQtyOf.current = key;
      },
    });
  };

  const addPackaging = () => {
    setPicking({
      mode: 'packaging',
      query: '',
      apply: choice => {
        const key = newLineKey();
        edit(current => ({ ...current, packaging: [...current.packaging, { key, ingredientId: choice.id, qty: '' }] }));
        focusQtyOf.current = key;
      },
    });
  };

  // Point an existing line at something else of the same kind.
  const changeLine = (key: string, kind: LineKind) => {
    setPicking({
      mode: kind,
      query: '',
      apply: choice => {
        edit(current => ({
          ...current,
          components: current.components.map<WorkingComponent>(line => {
            if (line.key !== key) return line;
            return line.kind === 'recipe' ? { ...line, recipeId: choice.id } : { ...line, ingredientId: choice.id };
          }),
          packaging: current.packaging.map(line => (line.key === key ? { ...line, ingredientId: choice.id } : line)),
        }));
      },
    });
  };

  const setQty = (key: string, text: string) => {
    edit(current => ({
      ...current,
      components: current.components.map(line => (line.key === key ? { ...line, qty: text } : line)),
      packaging: current.packaging.map(line => (line.key === key ? { ...line, qty: text } : line)),
    }));
  };

  const setUnit = (key: string, unit: LineUnit) => {
    edit(current => ({
      ...current,
      components: current.components.map<WorkingComponent>(line => (line.key === key && line.kind === 'ingredient' ? { ...line, unit } : line)),
    }));
  };

  // ⚠️ A RECIPE LINE'S g/kg SWITCH KEEPS THE TYPED NUMBER and changes what it means (owner, 8 Nov 2026: «quando cambio da kg
  // a g la quantità non deve cambiare»; current app a7f4c75d): 522 in g → kg still shows 522 and stores 522 kg. So the
  // stored kilos DO change and the form is dirty — unless they do not (an empty box): then only the unit moves, which is
  // never saved, and nothing is marked.
  const setRecipeUnit = (key: string, unit: KiloLineUnit) => {
    const line = working.components.find(one => one.key === key);
    if (!line || line.kind !== 'recipe' || line.unit === unit) return;
    const moved = (current: Working): Working => ({
      ...current,
      components: current.components.map<WorkingComponent>(one => (one.key === key && one.kind === 'recipe' ? { ...one, unit } : one)),
    });
    if (recipeLineKg({ ...line, unit }) === recipeLineKg(line)) setWorking(moved);
    else edit(moved);
  };

  const removeLine = (key: string) => {
    edit(current => ({
      ...current,
      components: current.components.filter(line => line.key !== key),
      packaging: current.packaging.filter(line => line.key !== key),
    }));
  };

  // A recipe picked for the name: the product is named after it (the name can still be edited) and
  // the recipe goes first in «Made of».
  const useRecipeForName = (recipeId: string) => {
    const recipe = snap.recipes[recipeId];
    if (!recipe) return;
    const name = String(recipe.name ?? '').trim();
    const present = working.components.some(line => line.kind === 'recipe' && line.recipeId === recipeId);
    const key = present ? (working.components[0]?.key ?? newLineKey()) : newLineKey();
    edit(current => ({
      ...current,
      name,
      components: current.components.some(line => line.kind === 'recipe' && line.recipeId === recipeId)
        ? current.components
        : [{ key, kind: 'recipe', recipeId, qty: '', unit: RECIPE_LINE_OPENS_IN }, ...current.components],
    }));
    // Said, never prevented: two products on one recipe is normal (a small and a large loaf), but
    // making the same one twice by accident is what this catches.
    const others = productsUsingRecipe(snap.products.filter(other => other.id !== id), recipeId).length;
    setNameNote(others > 0 ? t('fc.recipeAlreadyUsed', { n: others, name }) : '');
    focusQtyOf.current = key;
  };

  const seeAllRecipes = (typed: string) => {
    setPicking({ mode: 'recipe', query: typed, apply: choice => { useRecipeForName(choice.id); } });
  };

  // ── Save and delete ────────────────────────────────────────────────────────────────────────────
  async function save() {
    if (asking.current || askingLeave.current || leaving.current) return;

    // The ONE required field. Everything else may be missing — the answer panel says what, and
    // refusing the save would mean losing the work.
    const name = working.name.trim();
    if (name === '') {
      setShowNameError(true);
      reveal(nameBox.current);
      say(t('fc.pleaseEnterAProduct'));
      return;
    }

    // ⚠️⚠️ A NUMBER THE DATABASE WILL REFUSE STOPS THE SAVE HERE, WHILE THE WORK IS ON SCREEN
    // (shared/product-limits). Past this point the save is local-first: the editor leaves, the
    // refusal arrives later, and the rollback throws the product away. A value in a box that is not
    // shown (pieces on a product sold by weight) means nothing, so it is cleared rather than asked
    // about — nobody could find the box to correct it.
    // ⚠️ A RAW WEIGHT WITHIN 0.05 g OF THE TOTAL IS THE TOTAL, settled here as well as at blur: Save never depends on the box having lost the focus.
    let next = settleRaw(working, totalGrams);
    let invalid = firstInvalidNumber(toProduct(next, productId, name));
    while (invalid !== null && isNumberField(invalid) && !isShown(next, invalid)) {
      next = clearNumber(next, invalid);
      invalid = firstInvalidNumber(toProduct(next, productId, name));
    }
    if (invalid !== null) {
      const field = isNumberField(invalid) ? invalid : null;
      setBadNumber(field);
      reveal(field === null ? null : numberBoxes.current[field]);
      say(t('fc.checkNumber', { field: field === null ? invalid : t(NUMBER_LABEL[field]) }));
      return;
    }
    // The two weights of «Cottura» are numbers the products rules bound too (above 0, at most ten tonnes).
    const badWeight = firstBadWeight(toProduct(next, productId, name));
    if (badWeight !== null) {
      setBadNumber(badWeight);
      reveal(badWeight === 'rawGrams' ? rawBox.current : cookedBox.current);
      say(t('fc.checkNumber', { field: t(NUMBER_LABEL[badWeight]) }));
      return;
    }
    if (next !== working) setWorking(next);

    // ⚠️ A COOKED WEIGHT HEAVIER THAN THE RAW ONE NEVER BLOCKS THE SAVE (owner, Nov 2026: «in ogni caso posso salvare lo stesso»). It is
    // pointed at — scrolled to, focused, named — and then the usual question says so in its own words, so one tap on Save keeps the
    // numbers as typed.
    const heavier = productCooking(costable(next, productId), snap.tables).heavier;
    if (heavier) {
      reveal(cookedBox.current);
      say(t('fc.cooking.check'));
    }

    asking.current = true;
    try {
      const ok = await confirm({
        title: t('fc.saveProduct'),
        message: heavier ? t('fc.cooking.saveAnyway').split('\n') : t('fc.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }

    const clean = toProduct(next, productId, name);
    // A margin is recorded only when the PRICE or the COMPOSITION changed, and only when there is a
    // real answer to record. Renaming a product records nothing — a history of non-events cannot
    // answer «when did this change?».
    const result = costProduct(clean, snap.tables);
    const worthRecording = snapshotWorthTaking(initial, clean, snap.tables);
    const point = result.foodCostPct !== null && worthRecording
      ? productSnapshot(clean, result, new Date().toISOString(), snap.tables) as unknown as Record<string, unknown>
      : null;

    // Saved: nothing is unsaved any more, so leaving asks nothing.
    leaving.current = true;
    setDirtyBoth(false);
    // ⚠️ BACK TO THE READ VIEW OF THE SAVED PRODUCT, not the list (7 Nov 2026). saveProduct returns the id — minted for a new
    // product — so the page can find it again.
    // ⚠️ A PRODUCT OF ONE RECIPE WRITES THAT RECIPE'S WEIGHING TOO, only when a person typed in «Cottura» here (recipeWeighing): a converted
    // product's cooked weight is the product's, and opening and saving it must not move the recipe.
    const weighing = canWeigh ? recipeWeighing(next, totalGrams, snap.recipes) : null;
    const lossPatches = weighing === null ? {} : weighingPatches(snap.recipes, { [weighing.recipeId]: weighing.state }, [weighing.recipeId]);
    const savedId = store.saveProduct({ product: clean, snapshot: point, lossPatches });
    announceAction('foodcost-saved');
    say(initial === null ? t('fc.productAdded') : t('fc.productSaved'));
    onSaved(savedId);
  }

  async function remove() {
    if (id === null || asking.current || askingLeave.current || leaving.current) return;
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('fc.deleteProduct'),
        message: t('fc.deleteProductQ', { name: initial?.name || t('fc.thisProduct') }),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }
    leaving.current = true;
    setDirtyBoth(false);
    store.deleteProduct(id);
    say(t('fc.productDeleted'));
    leave();
  }

  // ── What is drawn ──────────────────────────────────────────────────────────────────────────────
  const modeKey = working.sellingMode === '' ? null : working.sellingMode;
  const vatChoices = vatRatesFor(country);
  const nameInvalid = showNameError && working.name.trim() === '';
  const labourNeedsRate = (costed.labourMinutes ?? 0) > 0 && canManage && snap.settingsLoaded && !(Number(snap.tables.labourCostPerHour) > 0);
  const heading = id === null ? t('fc.newProduct') : (initial?.name ?? '') || t('fc.untitledProduct');

  // A phone with no local copies has not heard the recipes or the prices yet: a line is not «gone»
  // until what it points at has been asked for.
  const loaded = { recipes: snap.recipesLoaded, ingredients: snap.ingredientsLoaded };

  const renderLine = (line: WorkingComponent | Working['packaging'][number], kind: LineKind) => (
    <LineRow
      key={line.key}
      rowKey={line.key}
      kind={kind}
      name={lineName(t, line, snap.tables, loaded)}
      cost={lineMoney(t, money, line, snap.tables).text}
      note={lineNote(t, money, line, snap.tables, loaded)}
      qty={line.qty}
      unit={'unit' in line ? line.unit : undefined}
      registerQty={registerQty}
      onPick={() => { changeLine(line.key, kind); }}
      onQty={text => { setQty(line.key, text); }}
      onUnit={unit => { setUnit(line.key, unit); }}
      onRecipeUnit={unit => { setRecipeUnit(line.key, unit); }}
      onRemove={() => { removeLine(line.key); }}
    />
  );

  // Every box has a visible <label htmlFor>, which names it; only the «another VAT rate» box has none, so
  // only it carries a name of its own.
  // The rate's own word; an unknown kind shows the rate alone — never another kind's word.
  const vatOptionText = (key: string, rate: number) => {
    const word = VAT_WORDS[key];
    return word === undefined ? `${plainNumber(rate, locale)}%` : t(word, { rate: String(rate) });
  };

  // The note under the pair: this Save changes the recipe's loss, and a product saved before the switch is still costed through it.
  const recipeWrite = canWeigh ? recipeWeighing(working, totalGrams, snap.recipes) : null;
  const recipeReading = recipeWrite === null ? null : readWeighing(snap.recipes[recipeWrite.recipeId], recipeWrite.state);
  // ⚠️ ONLY WHEN THE LOSS ITSELF MOVES: two new weights that work out to the loss the recipe already holds change nothing for anyone.
  const patchedLoss = recipeReading?.patch?.lossPct;
  const storedLoss = recipeWrite === null ? 0 : normalizeLossPct((snap.recipes[recipeWrite.recipeId] as { lossPct?: unknown } | null | undefined)?.lossPct);
  const sharedWith = recipeWrite !== null && recipeReading !== null && !recipeReading.keepsOnly
    && patchedLoss !== undefined && patchedLoss !== storedLoss
    ? otherProductsUsing(snap.products, recipeWrite.recipeId, id)
    : 0;

  const numberBox = (field: NumberField, domId: string, placeholder?: string, unlabelled = false) => (
    <NumberBox
      id={domId}
      {...(unlabelled ? { label: t(NUMBER_LABEL[field]) } : {})}
      value={working[NUMBER_KEY[field]]}
      invalid={badNumber === field}
      inputRef={boxRef(field)}
      onChange={text => { setNumber(field, text); }}
      {...(placeholder === undefined ? {} : { placeholder })}
    />
  );

  return (
    <section className={shell.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={heading}
        titleId={titleId}
        titleRef={titleRef}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      <div className={shell.body}>
        <ProductSummary product={costed} tables={snap.tables} />

        {/* «Full card» (Federico, 7 Nov 2026): inputs in the order they are filled, results last. The form's box cannot be closed,
            so a field Save checks can never sit hidden inside it. */}
        <FullCard read={false}>
          <CardSection title={t('fc.section.product')}>
            <div className={styles.field}>
              <label htmlFor={`${ids}-name`} className={styles.label}>{t('fc.name')}</label>
              <NameSuggest
                id={`${ids}-name`}
                value={working.name}
                invalid={nameInvalid}
                enabled={working.components.length === 0}
                recipes={snap.recipes}
                inputRef={nameBox}
                onChange={text => { edit(current => ({ ...current, name: text })); }}
                onPick={useRecipeForName}
                onSeeAll={seeAllRecipes}
              />
              <p className={styles.nameNote} aria-live="polite">{nameNote}</p>
            </div>

            <div className={styles.field}>
              <label htmlFor={`${ids}-mode`} className={styles.label}>{t('fc.sold')}</label>
              <select
                id={`${ids}-mode`}
                className={styles.select}
                value={working.sellingMode}
                onChange={event => { edit(current => ({ ...current, sellingMode: event.target.value as SellingMode | '' })); }}
              >
                <option value="">{t('fc.choose')}</option>
                <option value="piece">{t('fc.byThePiece')}</option>
                <option value="weight">{t('fc.byWeightPerKg')}</option>
                <option value="pack">{t('fc.byThePack')}</option>
              </select>
            </div>

            {/* «By the pack»: what one pack holds, as a weight or as a number of pieces. */}
            {packSizeShown(working) ? (
              <div className={styles.field}>
                <label htmlFor={`${ids}-packsize`} className={styles.label}>{t('fc.packHolds')}</label>
                <div className={styles.row}>
                  {numberBox('packSize', `${ids}-packsize`)}
                  <select
                    className={styles.select}
                    aria-label={t('fc.aria.unit')}
                    value={working.packUnit}
                    onChange={event => { edit(current => ({ ...current, packUnit: event.target.value as PackUnit | '' })); }}
                  >
                    <option value="">{t('fc.choose')}</option>
                    {PACK_UNITS.map(unit => (
                      <option key={unit} value={unit}>{unit === 'pcs' ? t('fc.unit.pieces') : unit}</option>
                    ))}
                  </select>
                </div>
                <p className={styles.note}>{t('fc.packHoldsNote')}</p>
              </div>
            ) : null}

            {/* The pieces box exists for what is sold by the piece, or by a pack counted in pieces; for anything else it is a
                number that would mean nothing and invite being filled in. */}
            {piecesShown(working) ? (
              <div className={styles.field}>
                <label htmlFor={`${ids}-pieces`} className={styles.label}>{t('fc.piecesPerBatch')}</label>
                {numberBox('piecesPerBatch', `${ids}-pieces`)}
                <p className={styles.note}>{t('fc.howManyFinishedPieces')}</p>
              </div>
            ) : null}
          </CardSection>

          <CardSection title={t('fc.madeOf')}>
            {working.components.length === 0 ? null : (
              <ul className={styles.lines}>
                {working.components.map(line => renderLine(line, line.kind))}
              </ul>
            )}
            <Button className={styles.add} onPress={addLine}>
              {working.components.length > 0 ? t('fc.addRecipeOrIngredient') : t('fc.addRecipe')}
            </Button>
          </CardSection>

          {/* The product's own baking, for EVERY product (step 2b): the loss is the product's, not its recipes'. */}
          <CardSection title={t('fc.cooking.title')}>
            <CookingSection
              product={costed}
              tables={snap.tables}
              rawText={rawBoxText(working, totalGrams)}
              cookedText={working.cookedText}
              totalGrams={totalGrams}
              rawApart={totalGrams > 0 && working.rawText !== null && !followsTotal(working.rawText, totalGrams)}
              invalid={{ raw: badNumber === 'rawGrams', cooked: badNumber === 'cookedGrams' }}
              hint={recipeLossHint(working, snap.recipes)}
              sharedWith={sharedWith}
              onRaw={setRaw}
              onCooked={setCooked}
              onRawBlur={settleRawBox}
              onUseTotal={useTotal}
              rawRef={rawBox}
              cookedRef={cookedBox}
            />
          </CardSection>

          <CardSection title={t('fc.packaging')}>
            {working.packaging.length === 0 ? null : (
              <>
                <p className={styles.label}>
                  {t('fc.packagingQtyFor', { per: t(modeKey === null ? 'fc.packagingPer.unit' : PACKAGING_PER[modeKey]) })}
                </p>
                <ul className={styles.lines}>
                  {working.packaging.map(line => renderLine(line, 'packaging'))}
                </ul>
              </>
            )}
            <Button className={styles.add} onPress={addPackaging}>{t('fc.addPackaging')}</Button>
            <p className={styles.note}>{t('fc.packagingPerNote')}</p>
          </CardSection>

          <CardSection title={t('fc.labour')}>
            <div className={styles.pair}>
              <div className={styles.field}>
                <label htmlFor={`${ids}-minutes`} className={styles.label}>{t('fc.labourMinutes')}</label>
                {numberBox('labourMinutes', `${ids}-minutes`)}
              </div>
              <div className={styles.field}>
                <label htmlFor={`${ids}-people`} className={styles.label}>{t('fc.labourPeople')}</label>
                {numberBox('labourPeople', `${ids}-people`, '1')}
              </div>
            </div>
            <p className={styles.note}>{t('fc.labourNote')}</p>
            {/* Minutes typed but no rate to turn them into money: say where the rate is set — and only to somebody who can set
                it; an employee is simply shown no labour money. */}
            <p className={styles.note} aria-live="polite">{labourNeedsRate ? t('fc.labourSetRate') : ''}</p>
          </CardSection>

          {/* ⚠️ IN THE ORDER THE SUM IS DONE: the VAT and the target first, then the price — with, under it, the price those two
              suggest (13 Sep 2026). */}
          <CardSection title={t('fc.section.price')}>
            <div className={styles.field}>
              <label htmlFor={`${ids}-vat`} className={styles.label}>{t('fc.vatRate')}</label>
              <div className={styles.row}>
                <select
                  id={`${ids}-vat`}
                  className={styles.select}
                  value={working.vatSelect}
                  onChange={event => { setVatSelect(event.target.value); }}
                >
                  <option value="">{t('fc.choose')}</option>
                  {vatChoices.map(choice => (
                    <option key={choice.rate} value={String(choice.rate)}>
                      {vatOptionText(choice.key, choice.rate)}
                    </option>
                  ))}
                  <option value="other">{t('fc.anotherRate')}</option>
                </select>
                <Button
                  className={styles.guide}
                  aria-label={t('fc.vatGuide.open')}
                  onPress={() => { setGuideOpen(true); }}
                >
                  <BookOpen aria-hidden="true" />
                </Button>
              </div>
              {working.vatSelect === 'other' ? numberBox('vatRate', `${ids}-vatother`, undefined, true) : null}
            </div>

            <div className={styles.field}>
              <label htmlFor={`${ids}-target`} className={styles.label}>{t('fc.foodCostTarget')}</label>
              {numberBox('foodCostTarget', `${ids}-target`)}
              <p className={styles.note}>{t('fc.theShareOfThe')}</p>
            </div>

            <div className={styles.field}>
              <label htmlFor={`${ids}-price`} className={styles.label}>{t('fc.sellingPriceVat', { currency: money.symbol })}</label>
              {numberBox('sellingPrice', `${ids}-price`)}
              <p className={styles.note}>{t('fc.thePriceOnThe')}</p>
            </div>

            <CardStack>
              <SuggestedPrice
                product={costed}
                tables={snap.tables}
                sellingPrice={costed.sellingPrice}
                onUse={price => { setNumber('sellingPrice', String(price)); }}
              />
            </CardStack>
          </CardSection>

          <CardSection title={t('fc.section.results')}>
            <CardStack>
              <ProductAnswer product={costed} tables={snap.tables} />
              <PerKgBlock product={costed} tables={snap.tables} />
            </CardStack>
          </CardSection>

          {/* History and Delete stay at the bottom of the box, small and low-key; a new product has neither. */}
          {id === null ? null : (
            <ProductActions
              onHistory={() => {
                // On the split the history takes the product's place (so the list's rows still mean «replace what is open»); on a
                // phone it is one level down and Back is the browser's.
                void navigate(historyPath(id, origin), split ? { replace: true, state } : { state: { ...FROM_PRODUCT, ...pushDepth(state) } });
              }}
              onDelete={canManage ? () => { void remove(); } : null}
            />
          )}
        </FullCard>
      </div>

      {picking === null ? null : (
        <PickDialog
          mode={picking.mode}
          initialQuery={picking.query}
          onChoose={choice => {
            const { apply } = picking;
            setPicking(null);
            apply(choice);
          }}
          onClose={() => { setPicking(null); }}
        />
      )}
      {guideOpen ? (
        <VatGuideDialog
          country={country}
          currentRate={vatRateOf(working)}
          onUse={rate => {
            setGuideOpen(false);
            applyVat(rate);
          }}
          onClose={() => { setGuideOpen(false); }}
        />
      ) : null}
      {confirmDialog}
    </section>
  );
}
