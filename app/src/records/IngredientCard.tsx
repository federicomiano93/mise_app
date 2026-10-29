import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, ReactNode, Ref } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { flushSync } from 'react-dom';
import { useBlocker } from 'react-router';
import type { BlockerFunction } from 'react-router';
import type { NutrientKey } from '@mise/shared/allergen-model';
import { FALLBACK_MONEY } from '@mise/shared/currency';
import { allergensOn, nutritionOn } from '@mise/shared/venue-features';
import type { Money } from '@mise/shared/currency';
import { formatSummary, usesLegacyCard } from '@mise/shared/pack-format';
import type { PackTranslate } from '@mise/shared/pack-format';
import { pricePatch as pricePatchOf } from '@mise/shared/price-model';
import type { PriceBasis, PricePatch } from '@mise/shared/price-model';
import { WEIGHT_UNIT_CHOICES } from '@mise/shared/pack-size';
import type { WeightUnit } from '@mise/shared/pack-size';
import { NEW_SUPPLIER_CHOICE } from '@mise/shared/record-choices';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { FormDialog } from '../ui/FormDialog';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import {
  BRAND_MAX, CATEGORY_MAX, NAME_MAX, NEW_CHOICE, NO_SUPPLIER_ID, PACK_WORD_MAX, SHORT_NAME_MAX,
  buildSave, firstRefusal, formState, isDirty, labelOf, readChoice, weightText, withFormat, withInner, workingFrom,
} from './ingredientCardModel';
import type { CardKind, ChoiceState, ItemLike, RefusedField, Working } from './ingredientCardModel';
import { AllergenSections } from './AllergenSections';
import type { AllergenControls, NutrientBoxes } from './AllergenSections';
import { allergenDirty, allergenPayload, allergenWorkingFrom, nutritionRefusal } from './allergenCardModel';
import type { AllergenWorking, NutritionRefusal } from './allergenCardModel';
import { PriceHistory } from './PriceHistory';
import { PriceSection } from './PriceSection';
import type { PriceBox } from './PriceSection';
import { LegacyPriceSection } from './LegacyPriceSection';
import {
  UNIT_MAX, buildLegacySave, isLegacyEdited, isLegacyProductEdited, legacyPatch, legacyProductFrom, legacyProductRefusal,
  legacyRefusal, legacySends, legacyStateFrom, legacyView as buildLegacyView,
} from './legacyPriceModel';
import type { LegacyBox, LegacyCtx, LegacyPriceState, LegacyProduct } from './legacyPriceModel';
import {
  chooseVat, followFormat, isPriceDirty, isPriceEdited, priceCtxOf, priceRefusal, priceStateFrom, priceView, readPrice,
  recompute, tapBasis, typeBox, typePieceKg, typeRate, typeUnit, weightHintOf,
} from './priceCardModel';
import type { PriceFacts, PriceState } from './priceCardModel';
import styles from './IngredientCard.module.css';

// What the card hands a «+ New supplier…» form: the supplier it made (its id and the label the app will show), or nothing.
export interface NewSupplierHost {
  onSaved(made: { id: string; name: string }): void;
  onCancel(): void;
  // The supplier form has (or no longer has) typing in it: the card then asks before the page is left, for both.
  onDirty(dirty: boolean): void;
}

// What a screen that draws the card in a dialog ABOVE itself (the Recipe catalogue's «+ Add … as an ingredient») gives it.
export interface IngredientCardHost {
  // The card has (or no longer has) edits of its own.
  onDirty(dirty: boolean): void;
  // The card keeps its own Back here while it is on screen: it asks «Discard changes?» if something was typed, and then calls
  // `onLeave`. The host calls it when the person leaves by another road (the browser's Back).
  backRef: MutableRefObject<(() => void) | null>;
}

type Props = {
  // The item as the list held it when the card opened, or null for a new one. Only read once, by the first render.
  item: ItemLike | null;
  // A NEW item's name, already typed elsewhere (a recipe row): the card STARTS from it, so an untouched card is not dirty.
  presetName?: string;
  // Hosted above another screen: the card then registers no router blocker (see LeaveBlocker) and reports through this.
  host?: IngredientCardHost;
  // The kind it is filed under: fixed while the card is open, and sent as `kind`.
  kind: CardKind;
  // A supplier to start a NEW item on; never applied to an existing one.
  preset: string | null;
  suppliers: readonly ItemLike[];
  // The words «Category» offers, and «what is inside the case» offers: the venue's lists in its OUTPUT language.
  categories: readonly string[];
  packs: readonly string[];
  // The words the card of before's «Order unit» offers (the venue's own list); only that card reads it.
  orderUnits?: readonly string[];
  // The venue's OUTPUT language (shared/market.ts outputLanguage): the carton word and the default package word follow it.
  language: string;
  titleRef: Ref<HTMLHeadingElement>;
  // Save, after the question was answered yes: the screen writes (local-first) and tells the usage record. The card leaves by
  // `onLeave` right after, without asking.
  onSave(
    payload: Readonly<Record<string, unknown>> & { readonly name: string },
    options: { unitChangedFrom: string; price?: { before: ItemLike | null; patch: PricePatch } },
  ): void;
  // One level up (to the list, or to the supplier's screen the card was opened from).
  onLeave(): void;
  // Delete, for whoever may: the bin is drawn only when this is given, and only for an existing item. The screen asks, deletes
  // and leaves; it calls `markClean` just before leaving, so the card then asks nothing about unsaved edits.
  // It may answer (later) whether the item was deleted: on «no» the focus goes back to the bin.
  onDelete?: (markClean: () => void) => void | Promise<boolean>;
  // The delete is counting what uses the item: the bin is disabled and says it is busy.
  deleting?: boolean;
  // «Merge another pack…»: the door is drawn only when this is given AND the card shows an EXISTING ingredient (never packaging, never a
  // new item). With unsaved edits it says so and does NOT call this: a merge closes and reopens the card, so typing must never be lost.
  onMerge?: () => void;
  // The merge door's element, so the screen can hand the focus back to it.
  mergeDoorRef?: Ref<HTMLButtonElement>;
  // The supplier card, to draw in a dialog above this one. Without it «+ New supplier…» is not offered (parity C40).
  renderNewSupplier?: (host: NewSupplierHost) => ReactNode;
  // Hears the store's refusal of a supplier save (the name it was saved under); returns the way to stop listening. See host.
  watchRefusedSupplier?: (listener: (name: string) => void) => () => void;
  // Somebody who may write prices (the role AND the venue's Food cost section, parity C4): the price section is drawn for them
  // and for nobody else — absent, never disabled. `item` must then carry its price (the screen lays it on).
  mayPrice?: boolean;
  // The venue's country (the VAT menu) and money (every figure on the price).
  country?: unknown;
  money?: Money;
  // The last price-history entries of an ingredient, from the server; rejects on failure.
  readHistory?: (id: string) => Promise<readonly Readonly<Record<string, unknown>>[]>;
};

// A Save refused on a price box, or on the weight box with the price's own sentence (`legacyPackWeight`: the card of before's
// own sentence), or on a «+ New …» box of the card of before's two menus.
type Refused = RefusedField | PriceBox | LegacyBox | 'priceWeight' | 'legacyPackWeight' | 'legacyPack' | 'legacyUnit';

// An ingredient's or packaging item's card, product data (parity C36–C57, C80–C81, C84–C97). Driven only by its props, so the
// Recipe catalogue can open the same card later.
//
// The editing pattern is the app's own (P20): work on a COPY, nothing touches the stored item until Save, Save is confirmed,
// a wrong box is shown, said and takes the focus, and leaving with unsaved edits asks.
//
// ⚠️ THE COPY IS MADE ONCE, WHEN THIS CARD MOUNTS — the screen mounts it only once the item is in the list (the server's word,
// or after the wait), keyed on the id. An item changed on another phone afterwards NEVER replaces the copy.
//
// ⚠️ THE FOOD WORDS (the categories, the package words, the carton word) COME FROM THE VENUE'S COUNTRY, never from `t()`.
export function IngredientCard({
  item, presetName, host, kind, preset, suppliers, categories, packs, orderUnits = [], language, titleRef, onSave, onLeave, onDelete, deleting = false, onMerge, mergeDoorRef, renderNewSupplier, watchRefusedSupplier,
  mayPrice = false, country, money = FALLBACK_MONEY, readHistory,
}: Props) {
  const { t, locale } = useT();
  const { location } = useSession();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;

  const [opened] = useState(item);
  const supplierIds = suppliers.map(supplier => String(supplier.id));
  // ⚠️ AN OLD PRICE SHAPE (decision T4) KEEPS THE CARD OF BEFORE (step 3e-5, legacyPriceModel.ts): decided ONCE, when the card
  // opens, for somebody who may write prices (an employee never gets it, C11). The new price block is then never drawn, the
  // format opens as for an employee and the two menus «Package» and «Order unit» replace «Single | Case».
  const [legacyCard] = useState(() => mayPrice && opened !== null && usesLegacyCard(opened));
  // ⚠️ THE NEW PRICE BLOCK TOO IS DECIDED AT OPEN, and only ever turned OFF later (the right lost: no price drawn or sent). A right
  // GAINED while the card is open (an employee made manager) must not switch the save to the price-reader's format machinery over a
  // copy that was opened without it (review of 24 Oct 2026): the price comes with the next opening.
  const [pricedAtOpen] = useState(() => mayPrice && !legacyCard);
  const priceActive = pricedAtOpen && mayPrice;
  const [baseline] = useState<Working>(() => {
    const started = workingFrom(opened, { supplierIds, preset, mayPrice: priceActive, lang: language });
    const first = !opened && presetName ? { ...started, name: presetName.slice(0, NAME_MAX) } : started;
    // C46: a case priced by an explicit size opens with the weight box empty, its unit menu on that unit (the size itself is
    // only a placeholder: an untouched Save writes nothing new).
    const hint = priceActive ? weightHintOf(opened, weightText(first)) : null;
    return hint && first.weight.amount === '' && (WEIGHT_UNIT_CHOICES as readonly string[]).includes(hint.unit)
      ? { ...first, weight: { ...first.weight, unit: hint.unit as WeightUnit } }
      : first;
  });
  const [working, setWorking] = useState<Working>(baseline);
  const workingRef = useRef(working);

  // ── The price's working copy (step 3e-3) ──
  const [openedFacts] = useState(() => ({ openedKind: baseline.format, initialWeight: weightText(baseline) }));
  const facts: PriceFacts = { item: opened, lang: language, money, locale, country, ...openedFacts };
  const ctxOf = (current: Working, state: PriceState | null) => priceCtxOf(current, facts, state ? isPriceDirty(state, opened) : !opened);
  const [price, setPrice] = useState<PriceState | null>(() => (priceActive
    ? priceStateFrom(opened, kind === 'packaging' && !opened ? 'pcs' : null, ctxOf(baseline, null))
    : null));
  const priceRef = useRef(price);

  // ── The card of before's working copy (step 3e-5): its price boxes and its two menus, made once at open ──
  const [legacyOpened] = useState<LegacyPriceState>(() => legacyStateFrom(opened, kind === 'packaging' ? 'pcs' : null, money));
  const [legacy, setLegacy] = useState<LegacyPriceState>(legacyOpened);
  const legacyRef = useRef(legacy);
  const [productOpened] = useState<LegacyProduct>(() => legacyProductFrom(opened));
  const [product, setProduct] = useState<LegacyProduct>(productOpened);
  const productRef = useRef(product);
  // What the block reads of the card NOW: the item as opened, and the weight, package word and order unit as they stand.
  const legacyCtxOf = (current: Working, menus: LegacyProduct): LegacyCtx => ({
    item: opened, weight: weightText(current), packUnit: readChoice(menus.pack), orderUnit: readChoice(menus.unit), locale, money, country,
  });

  // ── The pack list, allergens and nutrition's working copy (step 3e-4) ──
  // ⚠️ MADE ONCE, WHEN THE CARD OPENS, like the rest: the model's header says what a save writes from it.
  const [allergenBaseline] = useState<AllergenWorking>(() => allergenWorkingFrom(opened, money));
  const [allergenWork, setAllergenWork] = useState<AllergenWorking>(allergenBaseline);
  const allergenRef = useRef(allergenWork);
  const nutrientBoxes: NutrientBoxes = useRef({});
  const allergenControls = useRef<AllergenControls | null>(null);
  const [refusedNutrient, setRefusedNutrient] = useState<NutritionRefusal | null>(null);
  const dirtyOf = (
    current: Working, state: PriceState | null, allergenCopy: AllergenWorking = allergenRef.current,
    legacyNow: LegacyPriceState = legacyRef.current, menusNow: LegacyProduct = productRef.current,
  ) =>
    isDirty(current, baseline, state ? isPriceEdited(state, ctxOf(current, state)) : false)
    || allergenDirty(allergenCopy, allergenBaseline)
    || (legacyCard && (isLegacyEdited(legacyNow, legacyOpened) || isLegacyProductEdited(menusNow, productOpened)));

  // ⚠️ DIRTY IS «DIFFERENT FROM THE COPY TAKEN AT OPEN», also kept in a ref: the router's blocker reads it at the moment of a
  // navigation, and a state value read there could be one render behind.
  const dirty = dirtyOf(working, price, allergenWork, legacy, product);
  const dirtyRef = useRef(false);
  // ⚠️ THE SUPPLIER FORM OPEN ABOVE HAS TYPING: the router asks only its LAST blocker, so this card's is the only one (the
  // supplier form registers none in a dialog) and it counts that typing too — one question, for both.
  const dialogDirtyRef = useRef(false);
  const unsaved = () => dirtyRef.current || dialogDirtyRef.current;
  const [refused, setRefused] = useState<Refused | null>(null);
  const update = (next: Working, clears?: Refused) => {
    // ⚠️ A figure a tap wrote follows the weight and the count: the price hears every change of the format.
    let state = priceRef.current;
    if (state) {
      state = followFormat(state, ctxOf(next, state));
      priceRef.current = state;
      setPrice(state);
    }
    workingRef.current = next;
    dirtyRef.current = dirtyOf(next, state);
    setWorking(next);
    if (clears && (refused === clears || (clears === 'weight' && (refused === 'priceWeight' || refused === 'legacyPackWeight')))) setRefused(null);
  };
  function priceEvent(run: (state: PriceState, ctx: ReturnType<typeof ctxOf>) => PriceState, clears?: PriceBox) {
    const state = priceRef.current;
    if (!state) return;
    const current = workingRef.current;
    const next = run(state, ctxOf(current, state));
    if (next === state) return;
    priceRef.current = next;
    setPrice(next);
    dirtyRef.current = dirtyOf(current, next);
    if (clears && refused === clears) setRefused(null);
  }
  // The card of before's price boxes: set the matching field; typing in a refused box clears its sentence.
  function legacyEvent(change: Partial<LegacyPriceState>, clears?: LegacyBox) {
    const next = { ...legacyRef.current, ...change };
    legacyRef.current = next;
    setLegacy(next);
    dirtyRef.current = dirtyOf(workingRef.current, priceRef.current);
    if (clears ? refused === clears : refused === 'legacyPackWeight') setRefused(null);
  }
  // The card of before's two menus («Package», «Order unit»).
  function changeProduct(next: LegacyProduct, clears: Refused) {
    productRef.current = next;
    setProduct(next);
    dirtyRef.current = dirtyOf(workingRef.current, priceRef.current);
    if (refused === clears) setRefused(null);
  }
  function changeAllergen(next: AllergenWorking) {
    const previous = allergenRef.current;
    allergenRef.current = next;
    dirtyRef.current = dirtyOf(workingRef.current, priceRef.current, next);
    setAllergenWork(next);
    // Typing in the refused nutrition box clears its sentence.
    if (refusedNutrient !== null && next.nutrition[refusedNutrient.key] !== previous.nutrition[refusedNutrient.key]) setRefusedNutrient(null);
  }
  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const leavingClean = useRef(false);
  const busy = useRef(false);
  const askingLeave = useRef(false);

  // ── Leaving with unsaved changes ─────────────────────────────────────────────────────────────────────────────
  const discardQuestion = () => confirm({
    title: t('sup.discard.title'),
    message: t('sup.discard.message'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, another row picked in
  // the split's list, the rail and the tab bar all navigate. Staying on the same address is never blocked.
  // ⚠️ HOSTED ABOVE ANOTHER SCREEN (`host`, the Recipe catalogue's «+ Add … as an ingredient») THERE IS NO BLOCKER AT ALL: the
  // router asks only the LAST blocker registered, so one here would silence the editor underneath. That editor then turns every
  // move into «close this card» and calls the card's own Back (host.backRef), which asks when something was typed.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && unsaved() && currentLocation.pathname !== nextLocation.pathname,
    [],
  );

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails
  // silently on a POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (busy.current || askingLeave.current) return;
    if (unsaved()) {
      busy.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        busy.current = false;
      }
    }
    leavingClean.current = true;
    onLeave();
  }

  // Hosted: the host reaches this card's Back (the question included) through its ref, and hears whether the card has typing.
  useEffect(() => {
    if (!host) return undefined;
    const ref = host.backRef;
    ref.current = () => { void back(); };
    return () => { ref.current = null; };
  });
  useEffect(() => { host?.onDirty(dirty); }, [dirty]);

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const nameBox = useRef<HTMLInputElement>(null);
  const weightBox = useRef<HTMLInputElement>(null);
  const categoryBox = useRef<HTMLInputElement>(null);
  const innerBox = useRef<HTMLInputElement>(null);
  const countBox = useRef<HTMLInputElement>(null);
  const innerMenu = useRef<HTMLSelectElement>(null);
  const rateBox = useRef<HTMLInputElement>(null);
  const priceBox = useRef<HTMLInputElement>(null);
  const pieceBox = useRef<HTMLInputElement>(null);
  const casePriceBox = useRef<HTMLInputElement>(null);
  const caseCountBox = useRef<HTMLInputElement>(null);
  const caseSizeBox = useRef<HTMLInputElement>(null);
  const legacyPackBox = useRef<HTMLInputElement>(null);
  const legacyUnitBox = useRef<HTMLInputElement>(null);

  function show(field: Refused) {
    setRefused(field);
    const target = {
      name: nameBox, weight: weightBox, priceWeight: weightBox, legacyPackWeight: weightBox, category: categoryBox, inner: innerBox,
      count: countBox, innerEmpty: innerMenu, rate: rateBox, box: priceBox, pieceKg: pieceBox, casePrice: casePriceBox,
      caseCount: caseCountBox, caseSize: caseSizeBox, legacyPack: legacyPackBox, legacyUnit: legacyUnitBox,
    }[field].current;
    // Save is at the top, so the box can be far above the fold on a phone.
    target?.focus();
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  }

  // A nutrition box the Save refused: the fold opens (the box is hidden while it is shut), the box is marked, said and takes the
  // focus, and is scrolled into view — Save is at the top.
  function showNutrient(refusal: NutritionRefusal) {
    const key: NutrientKey = refusal.key;
    flushSync(() => {
      setRefusedNutrient(refusal);
      allergenControls.current?.openNutrition();
    });
    const target = nutrientBoxes.current[key];
    target?.focus();
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  }

  async function save() {
    if (deleting || busy.current || askingLeave.current || leavingClean.current) return;
    // ⚠️ FIRST OF ALL, a proposal still waiting on the pack text (the pause has not ended) is run now, so that what is checked and
    // written below is what the screen shows. The card's copy is updated synchronously by changeAllergen.
    allergenControls.current?.flushProposal();
    const current = workingRef.current;
    // The right to write prices is read NOW: Food cost switched off on another phone while this card is open must not send a
    // price the rules refuse, taking the whole ingredient save down with it.
    const state = priceActive ? priceRef.current : null;
    const priceDirty = state ? isPriceDirty(state, opened) : false;
    // C84: the card's own refusals first, then the price's (the weight a price by weight needs, then an unreadable price box).
    // The card of before (C83): its own product refusals, then — only while the right to write prices still stands — the price's.
    const menus = productRef.current;
    const legacyNow = legacyCard && opened ? legacyRef.current : null;
    const wrong = legacyNow ? legacyProductRefusal(current, menus) : firstRefusal(current, opened, { mayPrice: priceActive, lang: language, priceDirty });
    if (wrong) {
      show(wrong);
      return;
    }
    const legacyCtx = legacyCtxOf(current, menus);
    const wrongLegacy = legacyNow && mayPrice ? legacyRefusal(legacyNow, legacyCtx) : null;
    if (wrongLegacy) {
      show(wrongLegacy === 'packWeight' ? 'legacyPackWeight' : wrongLegacy);
      return;
    }
    const ctx = state ? ctxOf(current, state) : null;
    const wrongPrice = state && ctx ? priceRefusal(state, ctx) : null;
    if (wrongPrice) {
      show(wrongPrice === 'weight' ? 'priceWeight' : wrongPrice);
      return;
    }
    // Then the nutrition's: text that is not a number, or a negative one (a new rule of Mise 2, the model's header says why). Only
    // the boxes somebody changed, and only while the venue shows the nutrition (read now, like the sections do).
    const allergenCopy = allergenRef.current;
    const wrongNutrient = kind === 'ingredient' && nutritionOn(location) ? nutritionRefusal(allergenCopy, allergenBaseline) : null;
    if (wrongNutrient) {
      showNutrient(wrongNutrient);
      return;
    }
    // The card of before hands the store a price only when a price box or menu moved, or the weight did (legacySends), and only
    // for whoever may write prices NOW; it never reports a unit change (the order unit is a menu a person chose).
    const patch = legacyNow
      ? (mayPrice && legacySends(legacyNow, legacyOpened, weightText(current), weightText(baseline), legacyCtx)
        ? legacyPatch(legacyNow, legacyOpened, legacyCtx, new Date().toISOString())
        : null)
      : (state && ctx ? pricePatchOf(readPrice(state, ctx), new Date().toISOString(), weightText(current)) : null);
    const built = legacyNow && opened
      ? { payload: buildLegacySave({ working: current, product: menus, item: opened, kind, startSupplierId: baseline.supplierId }), unitChangedFrom: '' }
      : buildSave({
        working: current, item: opened, kind, lang: language, startSupplierId: baseline.supplierId,
        mayPrice: priceActive, priceDirty, pricePatch: patch,
      });
    // ⚠️ ONLY THE GROUPS THAT CHANGED are added, and `now` is taken once, here (the model's header).
    const payload = { ...built.payload, ...allergenPayload(
      allergenCopy, opened, kind, new Date().toISOString(), { allergens: allergensOn(location), nutrition: nutritionOn(location) },
    ) };
    busy.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t(kind === 'packaging' ? 'sup.pack.save.title' : 'sup.ing.save.title'),
        message: t('sup.save.question', { name: labelOf(built.payload) }),
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
    onSave(payload, { unitChangedFrom: built.unitChangedFrom, ...(patch ? { price: { before: opened, patch } } : {}) });
    onLeave();
  }

  // The bin is aria-disabled, never disabled, while the count runs: Chrome blurs a disabled button that has the focus, and the
  // question's Cancel would then give the focus back to the page body.
  const bin = useRef<HTMLButtonElement>(null);
  function remove() {
    if (!onDelete || deleting || busy.current || askingLeave.current) return;
    // The screen leaves by itself once the item is gone; `markClean` first, so that leaving asks nothing.
    const done = onDelete(() => { leavingClean.current = true; });
    if (done instanceof Promise) {
      void done.then(deleted => {
        if (!deleted && mounted.current) bin.current?.focus();
      });
    }
  }

  // ── The new supplier ─────────────────────────────────────────────────────────────────────────────────────────
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [made, setMade] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const supplierMenu = useRef<HTMLSelectElement>(null);
  // What the menu showed before each supplier made here was selected, to put back if the database refuses that supplier.
  const madeFrom = useRef(new Map<string, string>());
  // ⚠️ THE LABELS AS COPIED AT OPEN: a supplier deleted on another phone while the card is open leaves the list, and the menu
  // keeps an option for the value it holds, so what it shows is what Save writes.
  const [openLabels] = useState(() => new Map(suppliers.map(supplier => [String(supplier.id), supplierLabel(supplier)] as const)));
  const heldSupplier = working.supplierId;
  const supplierOptions = useMemo(() => {
    const listed = suppliers.map(supplier => ({ id: String(supplier.id), name: supplierLabel(supplier) }));
    // A supplier made from this card is in the menu at once, even before the list has heard of it.
    const extra = made.filter(one => !listed.some(known => known.id === one.id));
    const all = [...listed, ...extra];
    if (heldSupplier !== NO_SUPPLIER_ID && !all.some(known => known.id === heldSupplier)) {
      all.push({ id: heldSupplier, name: openLabels.get(heldSupplier) ?? heldSupplier });
    }
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, made, heldSupplier, openLabels]);

  const supplierHost: NewSupplierHost = {
    onSaved(one) {
      setCreatingSupplier(false);
      dialogDirtyRef.current = false;
      madeFrom.current.set(one.id, workingRef.current.supplierId);
      setMade(previous => [...previous, one]);
      update({ ...workingRef.current, supplierId: one.id });
    },
    onCancel() {
      setCreatingSupplier(false);
      dialogDirtyRef.current = false;
    },
    onDirty(dirty) {
      dialogDirtyRef.current = dirty;
    },
  };

  // ⚠️ A SUPPLIER MADE HERE IS SAVED LOCAL-FIRST AND SELECTED AT ONCE; if the database refuses it, it leaves the menu and, if the
  // menu still holds it, the menu goes back to what it showed before. The store says why. (If this card was already saved
  // meanwhile, nothing more is done: the ingredient then names a supplier that does not exist, which the lists read as «No
  // supplier». Accepted — the store's sentence is the cue.)
  useEffect(() => {
    if (!watchRefusedSupplier) return undefined;
    return watchRefusedSupplier(name => {
      const refusedOnes = made.filter(one => one.name === name && madeFrom.current.has(one.id));
      if (refusedOnes.length === 0) return;
      setMade(previous => previous.filter(one => !refusedOnes.includes(one)));
      for (const one of refusedOnes) {
        if (workingRef.current.supplierId === one.id) update({ ...workingRef.current, supplierId: madeFrom.current.get(one.id) ?? NO_SUPPLIER_ID });
        madeFrom.current.delete(one.id);
      }
    });
  });

  // ── What is drawn ────────────────────────────────────────────────────────────────────────────────────────────
  const invoiceName = typeof opened?.invoiceName === 'string' ? opened.invoiceName.trim() : '';
  const titleKey: MessageKey = kind === 'packaging'
    ? (opened ? 'sup.editPackaging' : 'sup.newPackaging')
    : (opened ? 'sup.editIngredient' : 'sup.newIngredient');
  const carton = working.format === 'carton' && !legacyCard;
  const weightRefused = refused === 'weight' || refused === 'priceWeight' || refused === 'legacyPackWeight';
  const legacyDrawn = legacyCard && mayPrice;
  const legacyViewNow = legacyDrawn ? buildLegacyView(legacy, legacyCtxOf(working, product), t, legacyOpened) : null;
  const weightHint = priceActive ? weightHintOf(opened, weightText(working)) : null;
  const view = price ? priceView(price, ctxOf(working, price), t) : null;

  const translate: PackTranslate = (key, params) => (key === 'orders.format.summary'
    ? t('sup.ing.summary', params)
    : t('sup.ing.summaryNoWeight', params));
  // A count that is not a whole number reads as none (NaN is not a count), so the line then says nothing.
  const shownCount = formState(working).count;
  const summary = carton
    ? formatSummary({
      kind: 'carton',
      count: typeof shownCount === 'number' && Number.isFinite(shownCount) ? shownCount : null,
      inner: working.inner.choice === NEW_CHOICE ? working.inner.typed.trim() : working.inner.choice,
    }, weightText(working), language, translate, locale)
    : '';

  const lists = (current: ChoiceState, words: readonly string[]) => {
    // A stored word the list lacks is added, so nothing is lost (parity C42).
    const own = current.choice !== '' && current.choice !== NEW_CHOICE && !words.includes(current.choice) ? [current.choice] : [];
    return [...words, ...own];
  };
  const categoryWords = lists(working.category, categories);
  const packWords = lists(working.inner, packs);

  // The card of before's two «+ New …» menus: «Package» (the venue's package words) and «Order unit» (its order units).
  const legacyMenu = (which: 'pack' | 'unit') => {
    const isPack = which === 'pack';
    const state = product[which];
    const field = isPack ? 'legacyPack' : 'legacyUnit';
    const words = lists(state, isPack ? packs : orderUnits);
    return (
      <div className={styles.field}>
        <label htmlFor={id(`legacy-${which}`)} className={styles.label}>{t(isPack ? 'sup.ing.pack' : 'sup.legacy.orderUnit')}</label>
        <select
          id={id(`legacy-${which}`)}
          className={styles.box}
          value={state.choice}
          onChange={event => { changeProduct({ ...product, [which]: { choice: event.target.value, typed: state.typed } }, field); }}
        >
          <option value="">{t('sup.ing.choiceNone')}</option>
          {words.map(word => <option key={word} value={word}>{word}</option>)}
          <option value={NEW_CHOICE}>{t(isPack ? 'sup.ing.newPack' : 'sup.legacy.newUnit')}</option>
        </select>
        {state.choice === NEW_CHOICE ? (
          <input
            ref={isPack ? legacyPackBox : legacyUnitBox}
            type="text"
            autoComplete="off"
            autoFocus
            className={styles.box}
            maxLength={isPack ? PACK_WORD_MAX : UNIT_MAX}
            placeholder={t(isPack ? 'sup.ing.packPlaceholder' : 'sup.legacy.unitPlaceholder')}
            aria-label={t(isPack ? 'sup.ing.packNewAria' : 'sup.legacy.unitAria')}
            {...aria(field, id(`legacy-${which}-error`))}
            value={state.typed}
            onChange={event => { changeProduct({ ...product, [which]: { choice: NEW_CHOICE, typed: event.target.value } }, field); }}
          />
        ) : null}
        <p id={id(`legacy-${which}-error`)} role="status" className={refused === field ? styles.error : styles.quiet}>
          {refused === field ? t(isPack ? 'sup.ing.packBlank' : 'sup.legacy.unitBlank') : ''}
        </p>
      </div>
    );
  };

  const aria = (field: Refused, errorId: string, ...more: string[]) => ({
    'aria-invalid': refused === field ? true : undefined,
    'aria-describedby': [...more, refused === field ? errorId : ''].filter(Boolean).join(' ') || undefined,
  });

  return (
    <section className={styles.screen} aria-labelledby={id('title')}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t(titleKey)}
        titleId={id('title')}
        titleRef={titleRef}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      <div className={styles.body}>
        {invoiceName === '' ? null : (
          <div className={styles.field}>
            <div role="group" aria-labelledby={id('invoice-label')} aria-describedby={id('invoice-hint')} className={styles.field}>
              <span id={id('invoice-label')} className={styles.label}>{t('sup.ing.invoiceName')}</span>
              <p className={styles.readonly}>{invoiceName}</p>
            </div>
            <p id={id('invoice-hint')} className={styles.hint}>{t('sup.ing.invoiceNameHint')}</p>
          </div>
        )}

        <div className={styles.field}>
          <label htmlFor={id('name')} className={styles.label}>{t('sup.ing.name')}</label>
          <input
            ref={nameBox}
            id={id('name')}
            type="text"
            autoComplete="off"
            className={styles.box}
            maxLength={NAME_MAX}
            aria-required="true"
            {...aria('name', id('name-error'), id('name-hint'))}
            value={working.name}
            onChange={event => { update({ ...working, name: event.target.value }, 'name'); }}
          />
          <p id={id('name-hint')} className={styles.hint}>{t('sup.ing.nameHint')}</p>
          {/* ⚠️ THE LIVE REGION IS THERE, EMPTY, BEFORE IT SPEAKS: text added to a region that was already on the page is
              announced; a region inserted already filled in often is not. */}
          <p id={id('name-error')} role="status" className={refused === 'name' ? styles.error : styles.quiet}>
            {refused === 'name' ? t('sup.ing.nameRequired') : ''}
          </p>
        </div>

        <div className={styles.field}>
          <label htmlFor={id('short')} className={styles.label}>{t('sup.ing.listName')}</label>
          <input
            id={id('short')}
            type="text"
            autoComplete="off"
            className={styles.box}
            maxLength={SHORT_NAME_MAX}
            aria-describedby={id('short-hint')}
            value={working.shortName}
            onChange={event => { update({ ...working, shortName: event.target.value }); }}
          />
          <p id={id('short-hint')} className={styles.hint}>{t('sup.ing.listNameHint')}</p>
        </div>

        <div className={styles.field}>
          <label htmlFor={id('supplier')} className={styles.label}>{t('sup.ing.supplier')}</label>
          <select
            ref={supplierMenu}
            id={id('supplier')}
            className={styles.box}
            value={working.supplierId}
            onChange={event => {
              // ⚠️ THE MARKER IS NEVER THE MENU'S VALUE: it opens the supplier card above this one, and the menu keeps showing
              // what it showed, so backing out puts nothing to put back.
              if (event.target.value === NEW_SUPPLIER_CHOICE) setCreatingSupplier(true);
              else update({ ...working, supplierId: event.target.value });
            }}
          >
            <option value={NO_SUPPLIER_ID}>{t('sup.ing.noSupplier')}</option>
            {supplierOptions.map(one => <option key={one.id} value={one.id}>{one.name}</option>)}
            {renderNewSupplier ? <option value={NEW_SUPPLIER_CHOICE}>{t('sup.ing.newSupplier')}</option> : null}
          </select>
        </div>

        <div className={styles.pair}>
          <div className={styles.field}>
            <label htmlFor={id('brand')} className={styles.label}>{t('sup.ing.brand')}</label>
            <input
              id={id('brand')}
              type="text"
              autoComplete="off"
              className={styles.box}
              maxLength={BRAND_MAX}
              placeholder={t('sup.ing.brandEg')}
              value={working.brand}
              onChange={event => { update({ ...working, brand: event.target.value }); }}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor={id('category')} className={styles.label}>{t('sup.ing.category')}</label>
            <select
              id={id('category')}
              className={styles.box}
              value={working.category.choice}
              onChange={event => { update({ ...working, category: { choice: event.target.value, typed: working.category.typed } }, 'category'); }}
            >
              <option value="">{t('sup.ing.choiceNone')}</option>
              {categoryWords.map(word => <option key={word} value={word}>{word}</option>)}
              <option value={NEW_CHOICE}>{t('sup.ing.newCategory')}</option>
            </select>
            {working.category.choice === NEW_CHOICE ? (
              <>
                <input
                  ref={categoryBox}
                  type="text"
                  autoComplete="off"
                  autoFocus
                  className={styles.box}
                  maxLength={CATEGORY_MAX}
                  placeholder={t('sup.ing.categoryPlaceholder')}
                  aria-label={t('sup.ing.categoryAria')}
                  {...aria('category', id('category-error'))}
                  value={working.category.typed}
                  onChange={event => { update({ ...working, category: { choice: NEW_CHOICE, typed: event.target.value } }, 'category'); }}
                />
              </>
            ) : null}
            <p id={id('category-error')} role="status" className={refused === 'category' ? styles.error : styles.quiet}>
              {refused === 'category' ? t('sup.ing.categoryBlank') : ''}
            </p>
          </div>
        </div>

        <div className={styles.pair}>
          <div role="group" aria-labelledby={id('weight-label')} className={styles.field}>
            <span id={id('weight-label')} className={styles.label}>{t('sup.ing.weight')}</span>
            <div className={styles.weightRow}>
              <input
                ref={weightBox}
                type="text"
                inputMode="decimal"
                autoComplete="off"
                className={`${styles.box} ${styles.amount}`}
                aria-label={t('sup.ing.weightAmount')}
                placeholder={weightHint ? weightHint.size.toLocaleString(locale) : t('sup.ing.weightEg')}
                aria-invalid={weightRefused ? true : undefined}
                aria-describedby={weightRefused ? id('weight-error') : undefined}
                value={working.weight.amount}
                onChange={event => { update({ ...working, weight: { ...working.weight, amount: event.target.value } }, 'weight'); }}
              />
              <select
                className={`${styles.box} ${styles.unit}`}
                aria-label={t('sup.ing.weightUnit')}
                value={working.weight.unit}
                onChange={event => { update({ ...working, weight: { ...working.weight, unit: event.target.value as WeightUnit } }, 'weight'); }}
              >
                {WEIGHT_UNIT_CHOICES.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
            <p id={id('weight-error')} role="status" className={weightRefused ? styles.error : styles.quiet}>
              {refused === 'weight'
                ? t('sup.ing.weightInvalid')
                : (refused === 'priceWeight' ? t('sup.price.weightNeeded') : (refused === 'legacyPackWeight' ? t('sup.legacy.packNeeded') : ''))}
            </p>
            {working.weight.legacy === '' ? null : (
              <div className={styles.legacy}>
                <p>{t('sup.ing.weightCurrent', { value: working.weight.legacy })}</p>
                <Button
                  variant="quiet"
                  aria-label={t('sup.ing.weightRemoveAria', { value: working.weight.legacy })}
                  onPress={() => {
                    update({ ...working, weight: { ...working.weight, legacy: '' } });
                    weightBox.current?.focus();
                  }}
                >
                  {t('sup.ing.weightRemove')}
                </Button>
              </div>
            )}
          </div>

          {legacyCard ? legacyMenu('pack') : (
            <div className={styles.field}>
              <span id={id('pack-label')} className={styles.label}>{t('sup.ing.pack')}</span>
              {/* ⚠️ NOT A <label>: a label around two buttons would press the first one when its text is tapped. */}
              <div role="group" aria-labelledby={id('pack-label')} className={styles.segments}>
                {(['single', 'carton'] as const).map(format => (
                  <button
                    key={format}
                    type="button"
                    className={styles.segment}
                    aria-pressed={working.format === format}
                    onClick={() => {
                      update(withFormat(working, format, language));
                      // A sentence about the case's count or word means nothing once the case is gone, and must not come back.
                      if (format === 'single' && (refused === 'count' || refused === 'inner' || refused === 'innerEmpty')) setRefused(null);
                    }}
                  >
                    {t(format === 'single' ? 'sup.ing.formatSingle' : 'sup.ing.formatCarton')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {legacyCard ? <div className={styles.pair}>{legacyMenu('unit')}</div> : null}

        {carton ? (
          <div role="group" aria-labelledby={id('contains-label')} className={styles.field}>
            <span id={id('contains-label')} className={styles.label}>{t('sup.ing.contains')}</span>
            <div className={styles.caseRow}>
              <input
                ref={countBox}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className={`${styles.box} ${styles.count}`}
                aria-label={t('sup.ing.count')}
                {...aria('count', id('count-error'))}
                value={working.count}
                onChange={event => { update({ ...working, count: event.target.value }, 'count'); }}
              />
              <span aria-hidden="true" className={styles.times}>×</span>
              <div className={styles.inner}>
                <select
                  ref={innerMenu}
                  className={styles.box}
                  aria-label={t('sup.ing.innerAria')}
                  {...aria('innerEmpty', id('inner-empty-error'))}
                  value={working.inner.choice}
                  onChange={event => {
                    update(withInner(working, { choice: event.target.value, typed: working.inner.typed }), 'innerEmpty');
                    if (refused === 'inner') setRefused(null);
                  }}
                >
                  <option value="">{t('sup.ing.choiceNone')}</option>
                  {packWords.map(word => <option key={word} value={word}>{word}</option>)}
                  <option value={NEW_CHOICE}>{t('sup.ing.newPack')}</option>
                </select>
                {working.inner.choice === NEW_CHOICE ? (
                  <input
                    ref={innerBox}
                    type="text"
                    autoComplete="off"
                    autoFocus
                    className={styles.box}
                    maxLength={PACK_WORD_MAX}
                    placeholder={t('sup.ing.packPlaceholder')}
                    aria-label={t('sup.ing.packNewAria')}
                    {...aria('inner', id('inner-error'))}
                    value={working.inner.typed}
                    onChange={event => { update(withInner(working, { choice: NEW_CHOICE, typed: event.target.value }), 'inner'); }}
                  />
                ) : null}
              </div>
            </div>
            <p id={id('count-error')} role="status" className={refused === 'count' ? styles.error : styles.quiet}>
              {refused === 'count' ? t('sup.ing.countInvalid') : ''}
            </p>
            <p id={id('inner-empty-error')} role="status" className={refused === 'innerEmpty' ? styles.error : styles.quiet}>
              {refused === 'innerEmpty' ? t('sup.ing.innerNeeded') : ''}
            </p>
            <p id={id('inner-error')} role="status" className={refused === 'inner' ? styles.error : styles.quiet}>
              {refused === 'inner' ? t('sup.ing.packBlank') : ''}
            </p>
            {summary === '' ? null : <p className={styles.hint}>{summary}</p>}
          </div>
        ) : null}

        {view && price ? (
          <PriceSection
            view={view}
            refused={refused === 'rate' || refused === 'box' || refused === 'pieceKg' ? refused : null}
            rateRef={rateBox}
            boxRef={priceBox}
            pieceRef={pieceBox}
            onUnit={unit => { priceEvent((state, ctx) => typeUnit(state, ctx, unit)); }}
            onRate={text => { priceEvent((state, ctx) => typeRate(state, ctx, text), 'rate'); }}
            onBox={text => { priceEvent((state, ctx) => typeBox(state, ctx, text), 'box'); }}
            onPieceKg={text => { priceEvent((state, ctx) => typePieceKg(state, ctx, text), 'pieceKg'); }}
            onVat={vat => { priceEvent((state, ctx) => chooseVat(state, ctx, vat)); }}
            onBasis={(basis: PriceBasis) => { priceEvent((state, ctx) => tapBasis(state, ctx, basis)); }}
            onRecompute={() => {
              priceEvent(recompute);
              (rateBox.current ?? priceBox.current)?.focus();
            }}
            history={opened && readHistory ? (
              <PriceHistory
                id={String(opened.id)}
                money={money}
                read={readHistory}
                onFailed={() => {
                  void alert({ message: t('sup.price.history.failed', { name: labelOf(opened) }), okLabel: t('common.ok') });
                }}
              />
            ) : null}
          />
        ) : null}
        {legacyViewNow ? (
          <LegacyPriceSection
            view={legacyViewNow}
            refused={refused === 'rate' || refused === 'pieceKg' || refused === 'casePrice' || refused === 'caseCount' || refused === 'caseSize' ? refused : null}
            boxRefs={{ rate: rateBox, pieceKg: pieceBox, casePrice: casePriceBox, caseCount: caseCountBox, caseSize: caseSizeBox }}
            onUnit={unit => { legacyEvent({ unit }); }}
            onBox={(box, text) => { legacyEvent({ [box]: text }, box); }}
            onItemUnit={caseItemUnit => { legacyEvent({ caseItemUnit }); }}
            onVat={vat => { legacyEvent({ vat }); }}
            history={opened && readHistory ? (
              <PriceHistory
                id={String(opened.id)}
                money={money}
                read={readHistory}
                onFailed={() => {
                  void alert({ message: t('sup.price.history.failed', { name: labelOf(opened) }), okLabel: t('common.ok') });
                }}
              />
            ) : null}
          />
        ) : null}

        {/* Packaging has none of it (parity C80). Each panel is read live from the venue's switches inside. */}
        {kind === 'ingredient' ? (
          <AllergenSections
            working={allergenWork}
            opened={opened}
            now={new Date().toISOString()}
            onChange={changeAllergen}
            refusedNutrient={refusedNutrient}
            nutrientBoxes={nutrientBoxes}
            controls={allergenControls}
          />
        ) : null}

        {/* «Merge another pack…» (3e-7): two ingredients that are one product bought in two packs. Existing ingredients only; the screen
            hands the door in to whoever may write prices. */}
        {opened && kind === 'ingredient' && onMerge ? (
          <Button
            variant="secondary"
            ref={mergeDoorRef}
            className={styles.mergeDoor}
            onPress={() => {
              if (unsaved()) {
                void alert({ message: t('sup.merge.saveFirst'), okLabel: t('common.ok') });
                return;
              }
              onMerge();
            }}
          >
            {t('sup.merge.button')}
          </Button>
        ) : null}

        {/* «Not in use at the moment» (3e-5b): an EXISTING item only, edited on the working copy like every other field and
            written by Save. Switched on, the item goes to the bottom of the lists and the pickers show it last; it never hides. */}
        {opened ? (
          <div className={styles.switchField}>
            <div className={styles.switchRow}>
              <span id={id('not-in-use')} className={styles.switchName}>{t('sup.ing.notInUse')}</span>
              <SettingSwitch
                selected={working.notInUse}
                onChange={notInUse => { update({ ...workingRef.current, notInUse }); }}
                labelledBy={id('not-in-use')}
                describedBy={id('not-in-use-hint')}
              />
            </div>
            <span id={id('not-in-use-hint')} className={styles.hint}>{t('sup.ing.notInUseHint')}</span>
          </div>
        ) : null}

        {/* ⚠️ THE BIN: only for an existing item and only when the screen hands the delete in (it does so to whoever runs the
            place). Small, low-key, icon only, the very end of the card; it counts what uses the item first and says it is busy. */}
        {opened && onDelete ? (
          <button
            type="button"
            className={styles.deleteIcon}
            ref={bin}
            aria-label={t(kind === 'packaging' ? 'sup.pack.delete' : 'sup.ing.delete')}
            title={t(kind === 'packaging' ? 'sup.pack.delete' : 'sup.ing.delete')}
            aria-disabled={deleting ? 'true' : undefined}
            aria-busy={deleting}
            onClick={remove}
          >
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {confirmDialog}
      {alertDialog}
      {creatingSupplier && renderNewSupplier ? (
        <FormDialog label={t('sup.newSupplier')}>{renderNewSupplier(supplierHost)}</FormDialog>
      ) : null}
      {host ? null : <LeaveBlocker shouldBlock={shouldBlock} ask={discardQuestion} asking={askingLeave} />}
    </section>
  );
}

// The router's blocker for a card drawn as a page (see the note on shouldBlock): asks «Discard changes?» when a navigation is
// blocked, and lets it go on or puts it back. A component of its own so that a hosted card can leave it out (SupplierCard's shape).
function LeaveBlocker({ shouldBlock, ask, asking }: {
  shouldBlock: BlockerFunction;
  ask: () => Promise<boolean>;
  asking: { current: boolean };
}) {
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const discard = await ask();
        // The card went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } catch (error) {
        asking.current = false;
        throw error;
      }
    })();
  });
  return null;
}
