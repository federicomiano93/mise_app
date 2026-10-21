import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Check, Trash2 } from 'lucide-react';
import { useBlocker } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { formatSummary } from '@mise/shared/pack-format';
import type { PackTranslate } from '@mise/shared/pack-format';
import { WEIGHT_UNIT_CHOICES } from '@mise/shared/pack-size';
import type { WeightUnit } from '@mise/shared/pack-size';
import { NEW_SUPPLIER_CHOICE } from '@mise/shared/record-choices';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { FormDialog } from '../ui/FormDialog';
import { useConfirm } from '../ui/useConfirm';
import {
  BRAND_MAX, CATEGORY_MAX, NAME_MAX, NEW_CHOICE, NO_SUPPLIER_ID, PACK_WORD_MAX, SHORT_NAME_MAX,
  buildSave, firstRefusal, formState, isDirty, labelOf, weightText, withFormat, withInner, workingFrom,
} from './ingredientCardModel';
import type { CardKind, ChoiceState, ItemLike, RefusedField, Working } from './ingredientCardModel';
import styles from './IngredientCard.module.css';

// What the card hands a «+ New supplier…» form: the supplier it made (its id and the label the app will show), or nothing.
export interface NewSupplierHost {
  onSaved(made: { id: string; name: string }): void;
  onCancel(): void;
}

type Props = {
  // The item as the list held it when the card opened, or null for a new one. Only read once, by the first render.
  item: ItemLike | null;
  // The kind it is filed under: fixed while the card is open, and sent as `kind`.
  kind: CardKind;
  // A supplier to start a NEW item on; never applied to an existing one.
  preset: string | null;
  suppliers: readonly ItemLike[];
  // The words «Category» offers, and «what is inside the case» offers: the venue's lists in its OUTPUT language.
  categories: readonly string[];
  packs: readonly string[];
  // The venue's OUTPUT language (shared/market.ts outputLanguage): the carton word and the default package word follow it.
  language: string;
  titleRef: Ref<HTMLHeadingElement>;
  // Save, after the question was answered yes: the screen writes (local-first) and tells the usage record. The card leaves by
  // `onLeave` right after, without asking.
  onSave(payload: Readonly<Record<string, unknown>> & { readonly name: string }, options: { unitChangedFrom: string }): void;
  // One level up (to the list, or to the supplier's screen the card was opened from).
  onLeave(): void;
  // Delete, for whoever may: the bin is drawn only when this is given, and only for an existing item. The screen asks, deletes
  // and leaves; it calls `markClean` just before leaving, so the card then asks nothing about unsaved edits.
  onDelete?: (markClean: () => void) => void;
  // The delete is counting what uses the item: the bin is disabled and says it is busy.
  deleting?: boolean;
  // The supplier card, to draw in a dialog above this one. Without it «+ New supplier…» is not offered (parity C40).
  renderNewSupplier?: (host: NewSupplierHost) => ReactNode;
};

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
  item, kind, preset, suppliers, categories, packs, language, titleRef, onSave, onLeave, onDelete, deleting = false, renderNewSupplier,
}: Props) {
  const { t, locale } = useT();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const id = (name: string) => `${ids}-${name}`;

  const [opened] = useState(item);
  const supplierIds = suppliers.map(supplier => String(supplier.id));
  const [baseline] = useState<Working>(() => workingFrom(opened, { supplierIds, preset }));
  const [working, setWorking] = useState<Working>(baseline);
  const workingRef = useRef(working);

  // ⚠️ DIRTY IS «DIFFERENT FROM THE COPY TAKEN AT OPEN», also kept in a ref: the router's blocker reads it at the moment of a
  // navigation, and a state value read there could be one render behind.
  const dirty = isDirty(working, baseline);
  const dirtyRef = useRef(false);
  const [refused, setRefused] = useState<RefusedField | null>(null);
  const update = (next: Working, clears?: RefusedField) => {
    workingRef.current = next;
    dirtyRef.current = isDirty(next, baseline);
    setWorking(next);
    if (clears && refused === clears) setRefused(null);
  };
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
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
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
    if (askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
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
    onLeave();
  }

  // ── Save ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const nameBox = useRef<HTMLInputElement>(null);
  const weightBox = useRef<HTMLInputElement>(null);
  const categoryBox = useRef<HTMLInputElement>(null);
  const innerBox = useRef<HTMLInputElement>(null);
  const countBox = useRef<HTMLInputElement>(null);
  const innerMenu = useRef<HTMLSelectElement>(null);

  function show(field: RefusedField) {
    setRefused(field);
    const target = { name: nameBox, weight: weightBox, category: categoryBox, inner: innerBox, count: countBox, innerEmpty: innerMenu }[field].current;
    // Save is at the top, so the box can be far above the fold on a phone.
    target?.focus();
    if (typeof target?.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
  }

  async function save() {
    if (busy.current || askingLeave.current || leavingClean.current) return;
    const current = workingRef.current;
    const wrong = firstRefusal(current, opened);
    if (wrong) {
      show(wrong);
      return;
    }
    const built = buildSave({ working: current, item: opened, kind, lang: language, startSupplierId: baseline.supplierId });
    busy.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: t('sup.ing.save.title'),
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
    onSave(built.payload, { unitChangedFrom: built.unitChangedFrom });
    onLeave();
  }

  function remove() {
    if (!onDelete || deleting || busy.current || askingLeave.current) return;
    // The screen leaves by itself once the item is gone; `markClean` first, so that leaving asks nothing.
    onDelete(() => { leavingClean.current = true; });
  }

  // ── The new supplier ─────────────────────────────────────────────────────────────────────────────────────────
  const [creatingSupplier, setCreatingSupplier] = useState(false);
  const [made, setMade] = useState<ReadonlyArray<{ id: string; name: string }>>([]);
  const supplierMenu = useRef<HTMLSelectElement>(null);
  const supplierOptions = useMemo(() => {
    const listed = suppliers.map(supplier => ({ id: String(supplier.id), name: supplierLabel(supplier) }));
    // A supplier made from this card is in the menu at once, even before the list has heard of it.
    const extra = made.filter(one => !listed.some(known => known.id === one.id));
    return [...listed, ...extra].sort((a, b) => a.name.localeCompare(b.name));
  }, [suppliers, made]);

  const host: NewSupplierHost = {
    onSaved(one) {
      setCreatingSupplier(false);
      setMade(previous => [...previous, one]);
      update({ ...workingRef.current, supplierId: one.id });
    },
    onCancel() {
      setCreatingSupplier(false);
    },
  };

  // ── What is drawn ────────────────────────────────────────────────────────────────────────────────────────────
  const invoiceName = typeof opened?.invoiceName === 'string' ? opened.invoiceName.trim() : '';
  const titleKey: MessageKey = kind === 'packaging'
    ? (opened ? 'sup.editPackaging' : 'sup.newPackaging')
    : (opened ? 'sup.editIngredient' : 'sup.newIngredient');
  const carton = working.format === 'carton';

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

  const aria = (field: RefusedField, errorId: string, ...more: string[]) => ({
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
                placeholder={t('sup.ing.weightEg')}
                {...aria('weight', id('weight-error'))}
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
            <p id={id('weight-error')} role="status" className={refused === 'weight' ? styles.error : styles.quiet}>
              {refused === 'weight' ? t('sup.ing.weightInvalid') : ''}
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
                  onClick={() => { update(withFormat(working, format, language)); }}
                >
                  {t(format === 'single' ? 'sup.ing.formatSingle' : 'sup.ing.formatCarton')}
                </button>
              ))}
            </div>
          </div>
        </div>

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

        {/* ⚠️ THE BIN: only for an existing item and only when the screen hands the delete in (it does so to whoever runs the
            place). Small, low-key, icon only, the very end of the card; it counts what uses the item first and says it is busy. */}
        {opened && onDelete ? (
          <button
            type="button"
            className={styles.deleteIcon}
            aria-label={t('sup.ing.delete')}
            title={t('sup.ing.delete')}
            disabled={deleting}
            aria-busy={deleting}
            onClick={remove}
          >
            <Trash2 aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {confirmDialog}
      {creatingSupplier && renderNewSupplier ? (
        <FormDialog label={t('sup.newSupplier')}>{renderNewSupplier(host)}</FormDialog>
      ) : null}
    </section>
  );
}
