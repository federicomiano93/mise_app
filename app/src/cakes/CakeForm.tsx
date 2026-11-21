import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useBlocker, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { MAX_SELLING_PRICE, cakeGeometry, cakeLineCosts, cakeProduct, cakeProductId, cakeTotals, toCakeDocument } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
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
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import {
  costable, firstEmptyPack, isDirty, referenceChanged, setMeasure, setPrice, setTarget, setVat, takeReference, vatFromSelect, workingFrom,
} from './cakeEditorModel';
import type { Selected } from './cakeEditorModel';
import { CakeStage } from './CakeStage';
import type { StageLabels } from './CakeStage';
import { useCakes } from './CakesContext';
import { CAKES_PATH, referencePath } from './cakesPath';
import type { CakeStart } from './cakesPath';
import { partFigures, partKey, startStep } from './cakeStepsModel';
import type { StepKey } from './cakeStepsModel';
import { CostCard } from './CostCard';
import type { PriceField, PriceTexts } from './CostCard';
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
};

// What each refused number is called, for «Check “…”».
const NUMBER_LABEL: Readonly<Record<PriceField, MessageKey>> = {
  sellingPrice: 'fc.sellingPriceIncludingVat',
  vatRate: 'fc.anotherVatRateAs',
  foodCostTarget: 'fc.foodCostTargetAs',
};

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
export function CakeForm({ id, cake, start = 'standard', titleRef, onSaved }: Props) {
  const { t } = useT();
  const store = useFoodcostStore();
  const snap = useFoodcost();
  const { reference, referenceLoaded } = useCakes();
  const { canManage, location } = useSession();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;
  const country = countryOf(location);

  // A new cake's id is made here, once, and kept by the form for as long as it lives: the same id from the first keystroke to the save.
  const [newId] = useState(() => (id === null ? store.newProductId() : ''));
  const cakeId = id ?? newId;
  const productId = cakeProductId(cakeId);

  // ⚠️ «FROM SCRATCH» TAKES NO REFERENCE GRAMS: the cake starts with `ref: null`, so every line needs its grams typed, and the bands about
  // the venue's reference grams stay quiet for it (the person chose to ignore them).
  const [fromScratch] = useState(() => id === null && start === 'zero');
  const [initial, setInitial] = useState<Cake>(() => workingFrom(cake, fromScratch ? null : reference, newId));
  const [working, setWorking] = useState<Cake>(initial);
  const [texts, setTexts] = useState<PriceTexts>(() => {
    const vat = vatSelection(initial.vatRate, country);
    return { price: textOf(initial.sellingPrice), target: textOf(initial.foodCostTarget), vatSelect: vat.select, vatOther: vat.other };
  });
  const [tier, setTier] = useState(0);
  // The step that is open: the first one for a new cake, none for a saved one.
  const [openStepKey, setOpenStepKey] = useState<StepKey | null>(() => startStep(id !== null));
  const [selected, setSelected] = useState<Selected | null>(null);
  // The 3D view's second tap on the chosen part: TierParts opens that part's step and puts the cursor in its search box.
  const [openRequest, setOpenRequest] = useState<OpenRequest | null>(null);
  const [showNameError, setShowNameError] = useState(false);
  const [badNumber, setBadNumber] = useState<PriceField | null>(null);
  const [needsOpen, setNeedsOpen] = useState(false);
  // The button that opened «What you need»: the focus goes back to it on close (the dialog is opened by state, so nothing else would).
  const needsOpener = useRef<HTMLElement | null>(null);

  // ⚠️ DIRTY IS «DIFFERENT FROM WHAT WAS LAST SAVED» (what Save would write), also kept in a ref: the router's blocker reads it at the
  // moment of a navigation, and a state value read there could be one render behind. `touched` NEVER goes back to false: a cake deleted
  // elsewhere closes this screen only while nobody has typed anything on it.
  const dirty = isDirty(working, initial);
  const dirtyRef = useRef(false);
  useLayoutEffect(() => { dirtyRef.current = dirty; });
  const touched = useRef(false);
  const edit = (change: (current: Cake) => Cake) => {
    touched.current = true;
    setWorking(change);
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
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
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
    }
    leave();
  }

  // ── Focus ─────────────────────────────────────────────────────────────────────────────────────
  const nameBox = useRef<HTMLInputElement>(null);
  const priceBoxes = useRef<Partial<Record<PriceField, HTMLInputElement | null>>>({});
  // The box Save refused, waiting for its step to open (see save()).
  const revealAfterRender = useRef<PriceField | null>(null);
  useLayoutEffect(() => {
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
      reveal(nameBox.current);
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
      // The price, VAT and target boxes live in the cost step: it opens, and the box takes the focus once it is on the page.
      setOpenStepKey('cost');
      revealAfterRender.current = invalid;
      reveal(priceBoxes.current[invalid]);
      say(t('fc.checkNumber', { field: t(NUMBER_LABEL[invalid]) }));
      return;
    }
    const emptyPack = firstEmptyPack(working);
    if (emptyPack !== null) {
      reveal(packBoxes.current.get(emptyPack));
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
    store.deleteProduct(productId, { kind: 'cake', id });
    say(t('cakes.deleted'));
    leave();
  }

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
      return t('cakes.callout.figures', { grams, cost: held.materials === null ? t('cakes.row.noPrice') : fcMoney(held.materials, money) });
    },
    total: hasParts ? t('cakes.stage.total', { cost: rawText }) : '',
  }), [t, money, working.tiers, working.discs, cardNames, figures, hasParts, rawText]);

  const venueRef = reference;
  // ⚠️ A CAKE WITH NO REFERENCE OF ITS OWN IS «TYPED BY HAND» once the venue has reference grams: a saved «from scratch» cake (it keeps
  // `ref: null`) must not claim its grams were left out. With no venue reference at all it is the «no reference» case below.
  const typedByHand = fromScratch || (working.ref === null && venueRef !== null);
  // «The reference changed → update» is useful to a cake with no reference of its own only while some line has no grams at all.
  const refDiffers = !fromScratch && referenceChanged(working, venueRef) && (working.ref !== null || working.lines.some(line => line.grams === null));
  // An existing cake with none of its own does not claim «no reference» before the venue's has answered.
  const noReference = !fromScratch && working.ref === null && venueRef === null && (id === null || referenceLoaded);

  return (
    <section className={styles.editor} aria-labelledby={titleId}>
      <FormBar
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
              <MeasuresCard cake={working} edit={edit} nameRef={nameBox} nameInvalid={showNameError && working.name.trim() === ''} />
            </div>
            <section className={`${styles.card} ${styles.parts}`} aria-labelledby={`${ids}-parts`}>
              <h3 id={`${ids}-parts`} className={styles.cardTitle}>
                {t('cakes.parts.title')}
                <span className={styles.caption}>{t(working.tiers > 1 ? 'cakes.parts.captionMany' : typedByHand ? 'cakes.parts.captionTyped' : 'cakes.parts.captionOne')}</span>
              </h3>
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
                  onOpenHandled={() => { setOpenRequest(null); }}
                  open={openStepKey}
                  onOpen={setOpenStepKey}
                  costSummary={hasParts ? t('cakes.steps.costSummary', { cost: rawText }) : ''}
                  costBody={
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
                  }
                />
              </PartBoundary>
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
  );
}
