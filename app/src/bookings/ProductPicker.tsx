import { useEffect, useId, useRef, useState } from 'react';
import { ChevronLeft, Minus, Plus, Search } from 'lucide-react';
import { Dialog as AriaDialog, Heading, Modal, ModalOverlay } from 'react-aria-components';
import { formatMoney } from '@mise/shared/price-model';
import { formatWeight, parseWeight } from '@mise/shared/price-list';
import type { PriceItem } from '@mise/shared/price-list';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { weightPrice } from './bookingModel';
import { changeWords } from './bookingWords';
import {
  NO_CHANGES, asksChanges, asksWeight, changesNote, favouritesOf, freeNameOf, removableOf, searchItems, toggleExtra, toggleMark,
} from './productPicker';
import type { Changes, IngredientMark } from './productPicker';
import styles from './ProductPicker.module.css';

// What the window hands the form: one product, the weight of one piece (or none), and the note its changes make.
export type Picked = {
  readonly name: string;
  readonly item: PriceItem | null;
  readonly weightKg: number | null;
  readonly note: string;
};

type Props = {
  // The published price list (empty: none, or not readable).
  items: readonly PriceItem[];
  // The venue's «Da aggiungere» (bookings settings).
  extras: readonly string[];
  // The list could not be read, or it has answered with nothing: said, and the name is typed.
  unavailable: boolean;
  loaded: boolean;
  onClose: () => void;
  onAdd: (picked: Picked) => void;
};

type Step = 'product' | 'weight' | 'changes';
const STEP_NUMBER: Readonly<Record<Step, number>> = { product: 1, weight: 2, changes: 3 };

// The product window of the booking form (bookings rebuild step 2, 19 Nov 2026; the owner's design, approved on the tablet):
// ONE product per opening. 1 «Scegli il prodotto» — the favourites as tiles, «Cerca tra tutti i prodotti» for the whole list or
// a name typed freely; 2 «Scegli il peso» — a kilo product's weights, each with its price, or «Altro peso…»; 3 «Modifiche» —
// what to leave out («−») or have more of («+») from the recipe, and the venue's extras (only «+»; free of charge). A step with
// nothing to ask is skipped. «Aggiungi» closes it and the form adds one card. Mounted only while open: every opening starts
// afresh.
//
// ⚠️ ESCAPE CLOSES IT (the same as «Annulla»): nothing is lost — the form behind is untouched until «Aggiungi».
export function ProductPicker({ items, extras, unavailable, loaded, onClose, onAdd }: Props) {
  const { t, locale } = useT();
  const money = useMoney();
  const { location } = useSession();
  const ids = useId();
  const favourites = favouritesOf(items);
  const [step, setStep] = useState<Step>('product');
  // Step 1 shows the search at once when there is no favourite to offer.
  const [searching, setSearching] = useState(favourites.length === 0);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<{ item: PriceItem | null; name: string } | null>(null);
  const [weightKg, setWeightKg] = useState<number | null>(null);
  const [askedWeight, setAskedWeight] = useState(false);
  const [otherOpen, setOtherOpen] = useState(false);
  const [weightText, setWeightText] = useState('');
  const [weightError, setWeightError] = useState(false);
  const [changes, setChanges] = useState<Changes>(NO_CHANGES);

  // Each new step is announced by its title taking the focus; the search takes it itself when it opens.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const weightRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    const first = firstRender.current;
    firstRender.current = false;
    if (step === 'product' && searching) searchRef.current?.focus();
    // At the opening the dialog takes the focus itself (its name is said); afterwards each step's title takes it.
    else if (!first) headingRef.current?.focus();
  }, [step, searching]);
  useEffect(() => { if (otherOpen) weightRef.current?.focus(); }, [otherOpen]);

  const priceText = (item: PriceItem): string => {
    const price = formatMoney(item.price, money);
    if (item.per === 'kg') return t('bookings.price.perKg', { price });
    if (item.per === 'piece') return t('bookings.price.perPiece', { price });
    return t('bookings.price.perPack', { price });
  };

  const finish = (item: PriceItem | null, name: string, weight: number | null, note: string) => {
    onAdd({ item, name, weightKg: weight, note });
  };

  // After the weight (or straight from the product): the changes, or the card at once when there is nothing to change.
  const toChanges = (item: PriceItem | null, name: string, weight: number | null) => {
    if (asksChanges(item, extras)) {
      setChanges(NO_CHANGES);
      setStep('changes');
    } else {
      finish(item, name, weight, '');
    }
  };

  const pick = (item: PriceItem | null, name: string) => {
    setChosen({ item, name });
    setWeightKg(null);
    if (asksWeight(item)) {
      setAskedWeight(true);
      setOtherOpen(false);
      setWeightText('');
      setWeightError(false);
      setStep('weight');
    } else {
      setAskedWeight(false);
      toChanges(item, name, null);
    }
  };

  const pickWeight = (weight: number | null) => {
    if (chosen === null) return;
    setWeightKg(weight);
    toChanges(chosen.item, chosen.name, weight);
  };

  const takeTypedWeight = () => {
    const weight = parseWeight(weightText);
    if (weight === null) {
      setWeightError(true);
      weightRef.current?.focus();
      return;
    }
    setWeightError(false);
    pickWeight(weight);
  };

  const back = () => {
    if (step === 'changes') setStep(askedWeight ? 'weight' : 'product');
    else if (step === 'weight') setStep('product');
    else if (searching && favourites.length > 0) setSearching(false);
  };
  const canGoBack = step !== 'product' || (searching && favourites.length > 0);

  const removable = removableOf(chosen?.item ?? null);
  // ⚠️ THE NOTE IS PRINTED ON THE SLIPS: its words follow the venue's COUNTRY (changeWords), never the interface (review).
  const note = changesNote(removable, extras, changes, changeWords(location));

  const title = step === 'product'
    ? t('bookings.picker.product')
    : step === 'weight'
      ? t('bookings.picker.weight')
      : weightKg === null
        ? chosen?.name ?? ''
        : t('bookings.picker.titleWeight', { name: chosen?.name ?? '', weight: formatWeight(weightKg, locale) });

  const results = searching ? searchItems(items, query) : [];
  const freeName = searching ? freeNameOf(query, items) : null;

  return (
    <ModalOverlay isOpen isDismissable={false} onOpenChange={open => { if (!open) onClose(); }} className={styles.overlay}>
      <Modal className={styles.modal}>
        <AriaDialog aria-label={t('bookings.form.addItem')} className={styles.dialog}>
          <div className={styles.head}>
            {canGoBack ? (
              <Button variant="bare" className={styles.back} aria-label={t('ui.back')} onPress={back}>
                <ChevronLeft aria-hidden="true" />
              </Button>
            ) : null}
            <Heading ref={headingRef} tabIndex={-1} className={styles.title}>{title}</Heading>
            <span className={styles.step}>{t('bookings.picker.step', { n: STEP_NUMBER[step] })}</span>
          </div>

          {step === 'product' ? (
            <div className={styles.body}>
              {unavailable ? <p className={styles.hint}>{t('bookings.picker.unreadable')}</p>
                : loaded && items.length === 0 ? <p className={styles.hint}>{t('bookings.picker.noList')}</p> : null}
              {!searching ? (
                <>
                  <div className={styles.tiles}>
                    {favourites.map(item => (
                      <Button key={item.productId} variant="bare" className={styles.tile} onPress={() => { pick(item, item.name); }}>
                        <span className={styles.tileName}>{item.name}</span>{' '}
                        <span className={styles.tilePrice}>{priceText(item)}</span>
                      </Button>
                    ))}
                  </div>
                  <Button variant="secondary" className={styles.wide} onPress={() => { setSearching(true); }}>
                    <Search aria-hidden="true" />
                    <span>{t('bookings.picker.searchAll')}</span>
                  </Button>
                </>
              ) : (
                <>
                  <div className={styles.field}>
                    <label className={styles.label} htmlFor={`${ids}-search`}>{t('bookings.picker.search')}</label>
                    <input
                      ref={searchRef}
                      id={`${ids}-search`}
                      className={styles.input}
                      type="search"
                      value={query}
                      placeholder={t('bookings.picker.searchPlaceholder')}
                      autoComplete="off"
                      maxLength={200}
                      onChange={event => { setQuery(event.currentTarget.value); }}
                      onKeyDown={event => {
                        // Enter takes the product whose name is exactly the one typed, or the name as typed when nothing on the list
                        // matches; anything else stays a choice for a tap (review: «Torta» must not become «Torta della nonna»).
                        if (event.key !== 'Enter') return;
                        event.preventDefault();
                        const exact = freeName === null ? results.find(item => item.name.trim().toLocaleLowerCase() === query.trim().replace(/\s+/g, ' ').toLocaleLowerCase()) : undefined;
                        if (exact !== undefined) pick(exact, exact.name);
                        else if (results.length === 0 && freeName !== null) pick(null, freeName);
                      }}
                    />
                  </div>
                  {results.length > 0 ? (
                    <div className={styles.tiles}>
                      {results.map(item => (
                        <Button key={item.productId} variant="bare" className={styles.tile} onPress={() => { pick(item, item.name); }}>
                          <span className={styles.tileName}>{item.name}</span>{' '}
                          <span className={styles.tilePrice}>{priceText(item)}</span>
                        </Button>
                      ))}
                    </div>
                  ) : items.length > 0 && query.trim() !== '' ? <p className={styles.hint}>{t('bookings.picker.noMatch')}</p> : null}
                  {freeName !== null ? (
                    <Button variant="secondary" className={styles.wide} onPress={() => { pick(null, freeName); }}>
                      <Plus aria-hidden="true" />
                      <span>{t('bookings.picker.free', { name: freeName })}</span>
                    </Button>
                  ) : null}
                </>
              )}
            </div>
          ) : null}

          {step === 'weight' && chosen !== null ? (
            <div className={styles.body}>
              <p className={styles.product}>{chosen.name}</p>
              <div className={styles.tiles}>
                {chosen.item === null ? (
                  <Button variant="bare" className={styles.tile} onPress={() => { pickWeight(null); }}>
                    <span className={styles.tileName}>{t('bookings.picker.noWeight')}</span>
                  </Button>
                ) : chosen.item.weights.map(weight => (
                  <Button key={weight} variant="bare" className={styles.tile} onPress={() => { pickWeight(weight); }}>
                    <span className={styles.tileName}>{formatWeight(weight, locale)}</span>{' '}
                    {chosen.item !== null
                      ? <span className={styles.tilePrice}>{formatMoney(weightPrice(chosen.item.price, weight), money)}</span>
                      : null}
                  </Button>
                ))}
                <Button
                  variant="bare"
                  className={styles.tile}
                  aria-expanded={otherOpen}
                  aria-controls={`${ids}-other`}
                  onPress={() => { setOtherOpen(open => !open); }}
                >
                  <span className={styles.tileName}>{t('bookings.picker.otherWeight')}</span>
                </Button>
              </div>
              <div id={`${ids}-other`} className={styles.other} hidden={!otherOpen}>
                {otherOpen ? (
                  <>
                    <div className={styles.field}>
                      <label className={styles.label} htmlFor={`${ids}-weight`}>{t('bookings.picker.weightLabel')}</label>
                      <input
                        ref={weightRef}
                        id={`${ids}-weight`}
                        className={styles.input}
                        value={weightText}
                        inputMode="decimal"
                        autoComplete="off"
                        maxLength={20}
                        placeholder={t('bookings.picker.weightPlaceholder')}
                        aria-invalid={weightError ? true : undefined}
                        aria-describedby={weightError ? `${ids}-weight-error` : undefined}
                        onChange={event => { setWeightText(event.currentTarget.value); setWeightError(false); }}
                        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); takeTypedWeight(); } }}
                      />
                      {weightError ? <p id={`${ids}-weight-error`} className={styles.error}>{t('bookings.settings.weightBad')}</p> : null}
                    </div>
                    <Button variant="secondary" className={styles.useWeight} onPress={takeTypedWeight}>{t('bookings.picker.useWeight')}</Button>
                  </>
                ) : null}
              </div>
            </div>
          ) : null}

          {step === 'changes' && chosen !== null ? (
            <div className={styles.body}>
              {removable.length > 0 ? (
                <div role="group" aria-labelledby={`${ids}-recipe`} className={styles.group}>
                  <p id={`${ids}-recipe`} className={styles.groupTitle}>{t('bookings.picker.inRecipe')}</p>
                  <div className={styles.tiles}>
                    {removable.map(name => (
                      <IngredientTile
                        key={name}
                        name={name}
                        mark={changes.marks[name] ?? null}
                        onMark={mark => { setChanges(current => toggleMark(current, name, mark)); }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
              {removable.length > 0 && extras.length > 0 ? <hr className={styles.divider} /> : null}
              {extras.length > 0 ? (
                <div role="group" aria-labelledby={`${ids}-extras`} className={styles.group}>
                  <p id={`${ids}-extras`} className={styles.groupTitle}>{t('bookings.picker.toAdd')}</p>
                  <div className={styles.tiles}>
                    {extras.map(name => {
                      const on = changes.extras.includes(name);
                      return (
                        <Button
                          key={name}
                          variant="bare"
                          className={styles.extra}
                          data-on={on ? 'true' : undefined}
                          aria-pressed={on}
                          onPress={() => { setChanges(current => toggleExtra(current, name)); }}
                        >
                          <span className={styles.extraName}>{name}</span>
                          <span className={styles.round} aria-hidden="true"><Plus /></span>
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}
              <p className={styles.note} aria-live="polite">{note === '' ? t('bookings.picker.noChanges') : note}</p>
            </div>
          ) : null}

          <div className={styles.actions}>
            <Button variant="secondary" onPress={onClose}>{t('common.cancel')}</Button>
            {step === 'changes' && chosen !== null ? (
              <Button variant="primary" onPress={() => { finish(chosen.item, chosen.name, weightKg, note); }}>
                {t('bookings.picker.add')}
              </Button>
            ) : null}
          </div>
        </AriaDialog>
      </Modal>
    </ModalOverlay>
  );
}

// An ingredient of the recipe: «−» on the left (leave it out: the tile turns red and the name is struck through), «+» on the
// right (more of it: the tile turns blue). Pressing the one that is on clears it; the two exclude each other.
function IngredientTile({ name, mark, onMark }: { name: string; mark: IngredientMark | null; onMark: (mark: IngredientMark) => void }) {
  const { t } = useT();
  return (
    <div className={styles.ingredient} data-mark={mark ?? undefined}>
      <Button
        variant="bare"
        className={`${styles.round} ${styles.less}`}
        aria-label={t('bookings.picker.lessOf', { name })}
        aria-pressed={mark === 'without'}
        onPress={() => { onMark('without'); }}
      >
        <Minus aria-hidden="true" />
      </Button>
      <span className={styles.ingredientName}>{name}</span>
      <Button
        variant="bare"
        className={`${styles.round} ${styles.more}`}
        aria-label={t('bookings.picker.moreOf', { name })}
        aria-pressed={mark === 'extra'}
        onPress={() => { onMark('extra'); }}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
