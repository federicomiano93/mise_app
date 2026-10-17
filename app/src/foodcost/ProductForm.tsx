import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { BookOpen, Check, History, Trash2 } from 'lucide-react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import {
  PACK_UNITS, costProduct, productSnapshot, productsUsingRecipe, snapshotWorthTaking, vatRatesFor, vatSelection,
} from '@mise/shared/foodcost-model';
import type { LineUnit, PackUnit, Product, ProductDraft, SellingMode } from '@mise/shared/foodcost-model';
import {
  startWeighing, typeCooked, typeRaw, weighingPatches, withWeighings, otherProductsUsing,
} from '@mise/shared/foodcost-weighing';
import type { WeighingState } from '@mise/shared/foodcost-weighing';
import { countryOf } from '@mise/shared/market';
import { firstInvalidNumber } from '@mise/shared/product-limits';
import { isSectionAllowedFor } from '@mise/shared/sections';
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
import { FOODCOST_PATH, entryPath, historyPath, usingPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { FROM_PRODUCT, entryState, pushDepth, useBackToRecipe, useLeave } from './foodcostNav';
import { NEW_OPENER, productOpener, useHandBack } from './handBack';
import { LineRow } from './LineRow';
import type { LineKind } from './LineRow';
import { lineName, lineNote } from './lineNotes';
import { NameSuggest } from './NameSuggest';
import { NumberBox } from './NumberBox';
import { PickDialog } from './PickDialog';
import type { Choice, PickMode } from './PickDialog';
import { ProductAnswer, SuggestedPrice } from './ProductAnswer';
import {
  NUMBER_KEY, clearNumber, costable, emptyWorking, isNumberField, isShown, newLineKey, packSizeShown, piecesShown,
  plainNumber, recipeIdsOn, toProduct, vatRateOf, workingFrom, workingFromDraft,
} from './productEditorModel';
import type { NumberField, Working, WorkingComponent } from './productEditorModel';
import { VatGuideDialog } from './VatGuideDialog';
import { WeighingPair } from './WeighingPair';
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
} as const satisfies Record<NumberField, MessageKey>;

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

const noExtra: { raw?: string; cooked?: string } = {};

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
export function ProductForm({ id, product, draft, origin, titleRef }: Props) {
  const { t, locale } = useT();
  const store = useFoodcostStore();
  const snap = useFoodcost();
  const { canManage, location, role } = useSession();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const { state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;

  // ⚠️ ASKED HERE, WHERE THE FIELDS ARE DRAWN: the venue — and so its country — arrives with the
  // session. The country decides the VAT menu; the section switch decides whether the weighing boxes
  // are offered at all (a venue with Food cost on and the catalogue off can read its recipes but not
  // write them, and a weighing whose save is always refused would still record a margin point).
  const country = countryOf(location);
  const canWeigh = isSectionAllowedFor(location, role, 'catalogue');

  // What the product was when this form opened: what a margin point is compared with.
  const [initial] = useState(product);
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

  const onLeaving = useCallback(() => {
    handBack.expect(id === null ? NEW_OPENER : productOpener(id));
  }, [handBack, id]);
  // Save and Delete leave for the list — the narrowed one when that is where the product was opened from.
  const leave = useLeave(origin.using === null ? FOODCOST_PATH : usingPath(origin.using), onLeaving);
  // Back, though, returns to the recipe when the recipe opened this screen.
  const backToRecipe = useBackToRecipe(origin.recipe);
  const goBack = origin.recipe === null ? leave : backToRecipe;

  // ── What is typed, and what it costs ───────────────────────────────────────────────────────────
  const [showNameError, setShowNameError] = useState(false);
  const [badNumber, setBadNumber] = useState<NumberField | null>(null);
  const [nameNote, setNameNote] = useState('');
  const [picking, setPicking] = useState<Picking | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  // The weighing typed on each recipe, held per recipe id OUTSIDE the rows: two lines carrying the
  // same recipe agree, and a rebuild loses nothing. An untouched one is read again from the recipe
  // each time, so a weighing saved on another phone shows up here.
  const [weighings, setWeighings] = useState<Readonly<Record<string, WeighingState>>>({});
  // What a person is typing in a weighing box right now (a half-typed «12.» is never rewritten).
  const [typedWeights, setTypedWeights] = useState<Readonly<Record<string, { raw?: string; cooked?: string }>>>({});

  const recipeIds = recipeIdsOn(working);
  const recipeKey = recipeIds.join('\n');
  const states = useMemo(() => {
    const out: Record<string, WeighingState> = {};
    for (const recipeId of recipeIds) {
      const recipe = snap.recipes[recipeId];
      if (!recipe) continue;
      const held = weighings[recipeId];
      out[recipeId] = held?.touched ? held : startWeighing(recipe);
    }
    return out;
    // `recipeIds` is read through its key.
  }, [snap.recipes, weighings, recipeKey]);
  // What Save would write onto the recipes, right now.
  const patches = useMemo(
    () => weighingPatches(snap.recipes, states, recipeIds),
    [snap.recipes, states, recipeKey],
  );
  // ⚠️ EVERY NUMBER ON THIS SCREEN COMES FROM HERE: the stored recipes with the weighings typed on
  // this product laid over them. Reading the stored tables would keep showing the old cost per kilo
  // until after Save.
  const live = useMemo(() => withWeighings(snap.tables, patches), [snap.tables, patches]);
  const costed = useMemo(() => costable(working, productId), [working, productId]);

  // A product deleted on another phone while this screen is open and nobody has typed on it: say so
  // and go back to the list. With typing on it, it is kept (Save would put it back).
  useEffect(() => {
    if (id === null || product !== null || touched.current || leaving.current) return;
    leaving.current = true;
    say(t('fc.productDeleted'));
    leave();
  }, [id, product, say, t, leave]);

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
    goBack();
  }

  // ── Focus ──────────────────────────────────────────────────────────────────────────────────────
  const nameBox = useRef<HTMLInputElement>(null);
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
            ? { key, kind: 'recipe', recipeId: choice.id, qty: '' }
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
        : [{ key, kind: 'recipe', recipeId, qty: '' }, ...current.components],
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

  const typeWeighing = (recipeId: string, box: 'raw' | 'cooked', text: string) => {
    touched.current = true;
    setDirtyBoth(true);
    setTypedWeights(current => ({ ...current, [recipeId]: { ...current[recipeId], [box]: text } }));
    setWeighings(current => {
      const held = current[recipeId];
      const base = held?.touched ? held : startWeighing(snap.recipes[recipeId]);
      const value = text.replace(',', '.');
      return { ...current, [recipeId]: box === 'raw' ? typeRaw(base, value) : typeCooked(base, value) };
    });
  };

  const leaveWeighingBox = (recipeId: string, box: 'raw' | 'cooked') => {
    setTypedWeights(current => {
      const { [box]: dropped, ...kept } = current[recipeId] ?? noExtra;
      void dropped;
      return { ...current, [recipeId]: kept };
    });
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
    let next = working;
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
    if (next !== working) setWorking(next);

    asking.current = true;
    try {
      const ok = await confirm({
        title: t('fc.saveProduct'),
        message: t('fc.saveTheseChanges'),
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
    // ⚠️ A WEIGHING COUNTS AS A CHANGE: it is typed on this very screen, on purpose, and it moves what
    // this product costs. The OTHER products using the same recipe record no point — the same gap as
    // an ingredient price drifting.
    const result = costProduct(clean, live);
    const worthRecording = snapshotWorthTaking(initial, clean) || Object.keys(patches).length > 0;
    const point = result.foodCostPct !== null && worthRecording
      ? productSnapshot(clean, result, new Date().toISOString(), live) as unknown as Record<string, unknown>
      : null;

    // Saved: nothing is unsaved any more, so leaving asks nothing.
    leaving.current = true;
    setDirtyBoth(false);
    store.saveProduct({ product: clean, snapshot: point, lossPatches: patches });
    announceAction('foodcost-saved');
    say(initial === null ? t('fc.productAdded') : t('fc.productSaved'));
    leave();
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
  const labourNeedsRate = (costed.labourMinutes ?? 0) > 0 && canManage && snap.settingsLoaded && !(Number(live.labourCostPerHour) > 0);
  const recipeCount = recipeIds.length;
  const heading = id === null ? t('fc.newProduct') : (initial?.name ?? '') || t('fc.untitledProduct');

  // A phone with no local copies has not heard the recipes or the prices yet: a line is not «gone»
  // until what it points at has been asked for.
  const loaded = { recipes: snap.recipesLoaded, ingredients: snap.ingredientsLoaded };

  const renderLine = (line: WorkingComponent | Working['packaging'][number], kind: LineKind) => (
    <LineRow
      key={line.key}
      rowKey={line.key}
      kind={kind}
      name={lineName(t, line, live, loaded)}
      note={lineNote(t, money, line, live, loaded)}
      qty={line.qty}
      unit={'unit' in line ? line.unit : undefined}
      registerQty={registerQty}
      onPick={() => { changeLine(line.key, kind); }}
      onQty={text => { setQty(line.key, text); }}
      onUnit={unit => { setUnit(line.key, unit); }}
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
        <ProductAnswer product={costed} tables={live} />

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

        <section className={styles.card} aria-labelledby={`${ids}-madeof`}>
          <h3 id={`${ids}-madeof`} className={styles.cardTitle}>{t('fc.madeOf')}</h3>
          {working.components.length === 0 ? null : (
            <ul className={styles.lines}>
              {working.components.map(line => renderLine(line, line.kind))}
            </ul>
          )}
          <Button className={styles.add} onPress={addLine}>
            {working.components.length > 0 ? t('fc.addRecipeOrIngredient') : t('fc.addRecipe')}
          </Button>
          {/* The weighings LAST, one pair per recipe however many lines carry it. */}
          {canWeigh ? recipeIds.map(recipeId => {
            const recipe = snap.recipes[recipeId];
            const weighing = states[recipeId];
            if (!recipe || !weighing) return null;
            return (
              <WeighingPair
                key={recipeId}
                recipe={recipe}
                title={recipeCount > 1 ? t('fc.weighFor', { name: String(recipe.name ?? '') }) : null}
                state={weighing}
                typed={typedWeights[recipeId] ?? noExtra}
                others={otherProductsUsing(snap.products, recipeId, id)}
                onRaw={text => { typeWeighing(recipeId, 'raw', text); }}
                onCooked={text => { typeWeighing(recipeId, 'cooked', text); }}
                onBlur={box => { leaveWeighingBox(recipeId, box); }}
              />
            );
          }) : null}
        </section>

        <section className={styles.card} aria-labelledby={`${ids}-packaging`}>
          <h3 id={`${ids}-packaging`} className={styles.cardTitle}>{t('fc.packaging')}</h3>
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
        </section>

        <section className={styles.card} aria-labelledby={`${ids}-labour`}>
          <h3 id={`${ids}-labour`} className={styles.cardTitle}>{t('fc.labour')}</h3>
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
          {/* Minutes typed but no rate to turn them into money: say where the rate is set — and only to
              somebody who can set it; an employee is simply shown no labour money. */}
          <p className={styles.note} aria-live="polite">{labourNeedsRate ? t('fc.labourSetRate') : ''}</p>
        </section>

        <section className={styles.card} aria-labelledby={`${ids}-sold`}>
          <h3 id={`${ids}-sold`} className={styles.cardTitle}>{t('fc.howItIsSold')}</h3>

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

          {/* The pieces box exists for what is sold by the piece, or by a pack counted in pieces; for
              anything else it is a number that would mean nothing and invite being filled in. */}
          {piecesShown(working) ? (
            <div className={styles.field}>
              <label htmlFor={`${ids}-pieces`} className={styles.label}>{t('fc.piecesPerBatch')}</label>
              {numberBox('piecesPerBatch', `${ids}-pieces`)}
              <p className={styles.note}>{t('fc.howManyFinishedPieces')}</p>
            </div>
          ) : null}

          {/* ⚠️ IN THE ORDER THE SUM IS DONE: the VAT and the target first, then the price — with, under
              it, the price those two suggest (13 Sep 2026). */}
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

          <SuggestedPrice
            product={costed}
            tables={live}
            sellingPrice={costed.sellingPrice}
            onUse={price => { setNumber('sellingPrice', String(price)); }}
          />
        </section>

        {/* History and Delete stay here, small and low-key; a new product has neither. */}
        {id === null ? null : (
          <div className={styles.actions}>
            <Button
              variant="quiet"
              onPress={() => {
                // On the split the history takes the product's place (so the list's rows still mean
                // «replace what is open»); on a phone it is one level down and Back is the browser's.
                void navigate(historyPath(id, origin), split ? { replace: true, state } : { state: { ...FROM_PRODUCT, ...pushDepth(state) } });
              }}
            >
              <History aria-hidden="true" />
              {t('fc.marginHistory')}
            </Button>
            {/* ⚠️ Whoever runs the place only. Deleting a product takes its margin history with it, and
                that history cannot be rebuilt — a snapshot exists only where somebody changed
                something, on the day they changed it. The bins on the lines above are NOT this: they
                edit the working copy and touch nothing until Save, so they stay for everybody. */}
            {canManage ? (
              <Button variant="quiet" className={styles.delete} onPress={() => { void remove(); }}>
                <Trash2 aria-hidden="true" />
                {t('fc.deleteProduct2')}
              </Button>
            ) : null}
          </div>
        )}
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
