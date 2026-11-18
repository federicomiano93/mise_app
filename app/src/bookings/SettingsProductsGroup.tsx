import { useId, useState } from 'react';
import { Pencil, Star, X } from 'lucide-react';
import { MAX_REMOVABLE, MAX_REMOVABLE_NAME, MAX_WEIGHTS, cleanRemovable, cleanWeights, formatWeight, parseWeight } from '@mise/shared/price-list';
import type { PriceItem, PriceList } from '@mise/shared/price-list';
import { formatMoney } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { SettingSwitch } from '../ui/SettingSwitch';
import { MAX_EXTRAS, MAX_EXTRA_LENGTH, cleanExtras } from './bookingSettings';
import { useHelp } from './SettingHelp';
import { choiceOf, removableOf } from './settingsProducts';
import type { ProductChoice, ProductDoc, ProductRow } from './settingsProducts';
import styles from './SettingsProductsGroup.module.css';

// The products of Bookings' «Impostazioni» (bookings settings, 18 Nov 2026): the master switch is the screen's; here, the
// header row with its column titles, one card per Food cost product with a selling price, the products without one, and the
// «Da aggiungere» list.
//
// ⚠️ ONLY WHOEVER RUNS FOOD COST CHANGES THE PRODUCTS (the rules publish the list for cardAccess 'manage'): anybody else who
// manages bookings sees the published list read only, with the line that says who can change it.

export type ProductsData =
  | { readonly kind: 'editable'; readonly products: readonly ProductDoc[]; readonly recipes: ReadonlyMap<string, unknown>; readonly published: PriceList }
  | { readonly kind: 'readOnly'; readonly published: PriceList | null }
  | { readonly kind: 'unavailable' };

type Props = {
  readonly data: ProductsData;
  readonly rows: readonly ProductRow[];
  readonly unpriced: readonly string[];
  readonly choices: ReadonlyMap<string, ProductChoice>;
  readonly onChoices: (next: ReadonlyMap<string, ProductChoice>) => void;
  // «Chiedi per pezzo» is shown only while the master switch «Biglietti per pezzo» is on.
  readonly perPieceShown: boolean;
  readonly stale: boolean;
  readonly gone: number;
  readonly extras: readonly string[];
  readonly onExtras: (extras: string[]) => void;
};

export function ProductsGroup({ data, rows, unpriced, choices, onChoices, perPieceShown, stale, gone, extras, onExtras }: Props) {
  const { t } = useT();
  const productsName = t('bookings.settings.products');
  const head = useHelp(productsName, t('bookings.settings.productsHelp'));
  const perPieceName = t('bookings.settings.colPerPiece');
  const perPieceHelp = useHelp(perPieceName, t('bookings.settings.colPerPieceHelp'));
  const [dialog, setDialog] = useState<{ kind: 'weights' | 'removable'; row: ProductRow } | null>(null);

  const change = (id: string, patch: Partial<ProductChoice>) => {
    const next = new Map(choices);
    next.set(id, { ...choiceOf(choices, id), ...patch });
    onChoices(next);
  };

  return (
    <>
      <div className={styles.headWrap}>
        <div className={styles.head}>
          <span className={styles.headName}>
            <span className={styles.name}>{productsName}</span>
            {head.toggle}
          </span>
          {data.kind === 'editable' && rows.length > 0 ? (
            <span className={styles.columns}>
              <span className={styles.column}>{t('bookings.settings.colFavourite')}</span>
              {perPieceShown ? (
                <span className={`${styles.column} ${styles.columnWide}`}>
                  <span>{perPieceName}</span>
                  {perPieceHelp.toggle}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        {head.box}
        {perPieceShown ? perPieceHelp.box : null}
      </div>

      {data.kind === 'readOnly' ? <ReadOnlyProducts published={data.published} /> : null}
      {data.kind === 'unavailable' ? <p className={styles.note}>{t('bookings.settings.productsUnavailable')}</p> : null}
      {data.kind === 'editable' ? (
        <>
          {stale ? <p className={styles.warn}>{t('bookings.settings.pricesChanged')}</p> : null}
          {gone > 0 ? <p className={styles.warn}>{t('bookings.settings.gone', { n: gone })}</p> : null}
          {rows.length === 0 ? <p className={styles.note}>{t('bookings.settings.noProducts')}</p> : (
            <ul className={styles.cards} aria-label={productsName}>
              {rows.map(row => (
                <li key={row.item.productId}>
                  <ProductCard
                    row={row}
                    choice={choiceOf(choices, row.item.productId)}
                    perPieceShown={perPieceShown}
                    onChange={patch => { change(row.item.productId, patch); }}
                    onWeights={() => { setDialog({ kind: 'weights', row }); }}
                    onRemovable={() => { setDialog({ kind: 'removable', row }); }}
                  />
                </li>
              ))}
            </ul>
          )}
          {unpriced.map(name => <p key={name} className={styles.note}>{t('bookings.settings.unpriced', { name })}</p>)}
        </>
      ) : null}

      <ExtrasEditor extras={extras} onExtras={onExtras} />

      {dialog?.kind === 'weights' ? (
        <WeightsDialog
          name={dialog.row.item.name}
          weights={choiceOf(choices, dialog.row.item.productId).weights}
          onDone={weights => { change(dialog.row.item.productId, { weights }); setDialog(null); }}
          onCancel={() => { setDialog(null); }}
        />
      ) : null}
      {dialog?.kind === 'removable' ? (
        <RemovableDialog
          name={dialog.row.item.name}
          prefill={dialog.row.prefill}
          chosen={removableOf(choiceOf(choices, dialog.row.item.productId), dialog.row) ?? []}
          onDone={removable => { change(dialog.row.item.productId, { removable }); setDialog(null); }}
          onCancel={() => { setDialog(null); }}
        />
      ) : null}
    </>
  );
}

// «16,00 € al kg», «1,50 € al pezzo», «3,50 € a confezione»: the counter's own words for a price.
function usePriceWords(): (item: PriceItem) => string {
  const { t } = useT();
  const money = useMoney();
  return item => {
    const price = formatMoney(item.price, money);
    if (item.per === 'kg') return t('bookings.price.perKg', { price });
    if (item.per === 'piece') return t('bookings.price.perPiece', { price });
    return t('bookings.price.perPack', { price });
  };
}

function ProductCard({ row, choice, perPieceShown, onChange, onWeights, onRemovable }: {
  row: ProductRow;
  choice: ProductChoice;
  perPieceShown: boolean;
  onChange: (patch: Partial<ProductChoice>) => void;
  onWeights: () => void;
  onRemovable: () => void;
}) {
  const { t, locale } = useT();
  const priceWords = usePriceWords();
  const ids = useId();
  const { item } = row;
  const removable = removableOf(choice, row);
  const weightsText = choice.weights.map(kg => formatWeight(kg, locale)).join(' · ');
  return (
    <div className={styles.card} data-checked={choice.ticked ? 'true' : undefined}>
      <label className={styles.tick}>
        <input
          type="checkbox"
          className={styles.check}
          checked={choice.ticked}
          aria-describedby={`${ids}-price`}
          onChange={event => { onChange({ ticked: event.currentTarget.checked }); }}
        />
        <span className={styles.productName}>{item.name}</span>
      </label>
      <div className={styles.side}>
        <button
          type="button"
          className={styles.star}
          aria-pressed={choice.favourite}
          aria-label={t('bookings.settings.favourite', { name: item.name })}
          disabled={!choice.ticked}
          onClick={() => { onChange({ favourite: !choice.favourite }); }}
        >
          <Star aria-hidden="true" fill={choice.favourite ? 'currentColor' : 'none'} />
        </button>
        {perPieceShown ? (
          <span className={styles.perPiece}>
            <span id={`${ids}-perPiece`} className="visually-hidden">{t('bookings.settings.perPiece', { name: item.name })}</span>
            <SettingSwitch
              selected={choice.perPiece}
              isDisabled={!choice.ticked}
              labelledBy={`${ids}-perPiece`}
              onChange={value => { onChange({ perPiece: value }); }}
            />
          </span>
        ) : null}
      </div>
      <div className={styles.details}>
        <span id={`${ids}-price`} className={styles.price}>{priceWords(item)}</span>
        {/* The two lines that open a dialog: only for a product the counter books. Weights only for one sold by the kilo. */}
        {choice.ticked && item.per === 'kg' ? (
          <Button variant="bare" className={styles.editLine} onPress={onWeights}>
            <Pencil aria-hidden="true" />
            <span>{weightsText === '' ? t('bookings.settings.weightsNone') : t('bookings.settings.weightsLine', { list: weightsText })}</span>
          </Button>
        ) : null}
        {choice.ticked ? (
          <Button variant="bare" className={styles.editLine} onPress={onRemovable}>
            <Pencil aria-hidden="true" />
            <span>
              {removable === null || removable.length === 0
                ? t('bookings.settings.removableNone')
                : t('bookings.settings.removableLine', { list: removable.join(', ') })}
            </span>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

// The published list, read only (the person manages bookings but not Food cost).
function ReadOnlyProducts({ published }: { published: PriceList | null }) {
  const { t, locale } = useT();
  const priceWords = usePriceWords();
  return (
    <>
      <p className={styles.note}>{t('bookings.settings.productsReadOnly')}</p>
      {published !== null && published.items.length > 0 ? (
        <ul className={styles.cards} aria-label={t('bookings.settings.products')}>
          {published.items.map(item => (
            <li key={item.productId}>
              <div className={styles.card} data-checked="true">
                <span className={styles.tick}>
                  <span className={styles.productName}>{item.name}</span>
                </span>
                <div className={styles.side}>
                  {item.favourite ? (
                    <span className={styles.starStatic} role="img" aria-label={t('bookings.settings.favourite', { name: item.name })}>
                      <Star aria-hidden="true" fill="currentColor" />
                    </span>
                  ) : null}
                </div>
                <div className={styles.details}>
                  <span className={styles.price}>{priceWords(item)}</span>
                  {item.weights.length > 0
                    ? <span className={styles.price}>{t('bookings.settings.weightsLine', { list: item.weights.map(kg => formatWeight(kg, locale)).join(' · ') })}</span>
                    : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

// A chip with its ×.
function Chip({ text, removeLabel, onRemove }: { text: string; removeLabel: string; onRemove: () => void }) {
  return (
    <li className={styles.chip}>
      <span>{text}</span>
      <Button variant="bare" className={styles.chipRemove} aria-label={removeLabel} onPress={onRemove}>
        <X aria-hidden="true" />
      </Button>
    </li>
  );
}

// «Pesi di <prodotto>»: the weights as chips, an input to add one, Annulla / Fatto. A working copy of its own: Annulla drops it.
function WeightsDialog({ name, weights, onDone, onCancel }: {
  name: string; weights: readonly number[]; onDone: (weights: number[]) => void; onCancel: () => void;
}) {
  const { t, locale } = useT();
  const ids = useId();
  const [list, setList] = useState<number[]>(() => cleanWeights(weights));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const kg = parseWeight(text);
    if (kg === null) { setError(t('bookings.settings.weightBad')); return; }
    if (!list.includes(kg) && list.length >= MAX_WEIGHTS) { setError(t('bookings.settings.weightsFull')); return; }
    setList(cleanWeights([...list, kg]));
    setText('');
    setError(null);
  };
  return (
    <Dialog
      isOpen
      onClose={onCancel}
      title={t('bookings.settings.weightsTitle', { name })}
      actions={(
        <>
          <Button variant="secondary" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" onPress={() => { onDone(list); }}>{t('bookings.settings.done')}</Button>
        </>
      )}
    >
      {list.length === 0 ? <p className={styles.note}>{t('bookings.settings.weightsEmpty')}</p> : (
        <ul className={styles.chips}>
          {list.map(kg => {
            const text = formatWeight(kg, locale);
            return <Chip key={kg} text={text} removeLabel={t('bookings.settings.removeChip', { name: text })} onRemove={() => { setList(list.filter(x => x !== kg)); }} />;
          })}
        </ul>
      )}
      <AddField
        id={`${ids}-weight`}
        label={t('bookings.settings.weight')}
        value={text}
        placeholder={t('bookings.settings.weightPlaceholder')}
        maxLength={12}
        error={error}
        onChange={value => { setText(value); setError(null); }}
        onAdd={add}
      />
    </Dialog>
  );
}

// «Cosa si può togliere da <prodotto>»: the recipe's ingredients (and any added by hand) ticked or not, and one more to add.
function RemovableDialog({ name, prefill, chosen, onDone, onCancel }: {
  name: string; prefill: readonly string[]; chosen: readonly string[]; onDone: (removable: string[]) => void; onCancel: () => void;
}) {
  const { t } = useT();
  const ids = useId();
  const [candidates, setCandidates] = useState<string[]>(() => cleanRemovable([...prefill, ...chosen]));
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(cleanRemovable(chosen)));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const [word] = cleanRemovable([text]);
    if (word === undefined) return;
    const known = candidates.find(c => c.toLocaleLowerCase() === word.toLocaleLowerCase());
    if (known === undefined && candidates.length >= MAX_REMOVABLE) { setError(t('bookings.settings.removableFull')); return; }
    if (known === undefined) setCandidates([...candidates, word]);
    setTicked(new Set([...ticked, known ?? word]));
    setText('');
    setError(null);
  };
  const toggle = (word: string, on: boolean) => {
    const next = new Set(ticked);
    if (on) next.add(word); else next.delete(word);
    setTicked(next);
  };
  return (
    <Dialog
      isOpen
      onClose={onCancel}
      title={t('bookings.settings.removableTitle', { name })}
      message={prefill.length > 0 ? t('bookings.settings.removableHint') : t('bookings.settings.removableNoRecipe')}
      actions={(
        <>
          <Button variant="secondary" onPress={onCancel}>{t('common.cancel')}</Button>
          <Button variant="primary" onPress={() => { onDone(candidates.filter(c => ticked.has(c))); }}>{t('bookings.settings.done')}</Button>
        </>
      )}
    >
      {candidates.length > 0 ? (
        <ul className={styles.ticks}>
          {candidates.map(word => (
            <li key={word}>
              <label className={styles.tickRow}>
                <input type="checkbox" className={styles.check} checked={ticked.has(word)} onChange={event => { toggle(word, event.currentTarget.checked); }} />
                <span>{word}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      <AddField
        id={`${ids}-ingredient`}
        label={t('bookings.settings.removableAdd')}
        value={text}
        maxLength={MAX_REMOVABLE_NAME}
        error={error}
        onChange={value => { setText(value); setError(null); }}
        onAdd={add}
      />
    </Dialog>
  );
}

// «Da aggiungere»: the extras as chips, and a field to add one.
function ExtrasEditor({ extras, onExtras }: { extras: readonly string[]; onExtras: (extras: string[]) => void }) {
  const { t } = useT();
  const ids = useId();
  const name = t('bookings.settings.extras');
  const help = useHelp(name, t('bookings.settings.extrasHelp'));
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const [word] = cleanExtras([text]);
    if (word === undefined) return;
    const known = extras.some(e => e.toLocaleLowerCase() === word.toLocaleLowerCase());
    if (!known && extras.length >= MAX_EXTRAS) { setError(t('bookings.settings.extrasFull')); return; }
    if (!known) onExtras([...extras, word]);
    setText('');
    setError(null);
  };
  return (
    <div className={styles.extras}>
      <span className={styles.headName}>
        <span id={`${ids}-title`} className={styles.name}>{name}</span>
        {help.toggle}
      </span>
      {help.box}
      {extras.length > 0 ? (
        <ul className={styles.chips} aria-labelledby={`${ids}-title`}>
          {extras.map(word => (
            <Chip key={word} text={word} removeLabel={t('bookings.settings.removeChip', { name: word })} onRemove={() => { onExtras(extras.filter(e => e !== word)); }} />
          ))}
        </ul>
      ) : null}
      <AddField
        id={`${ids}-extra`}
        label={t('bookings.settings.extraNew')}
        value={text}
        maxLength={MAX_EXTRA_LENGTH}
        error={error}
        onChange={value => { setText(value); setError(null); }}
        onAdd={add}
      />
    </div>
  );
}

// A box and «Aggiungi»; Enter adds too (and never submits anything).
function AddField({ id, label, value, placeholder, maxLength, error, onChange, onAdd }: {
  id: string; label: string; value: string; placeholder?: string; maxLength: number; error: string | null;
  onChange: (value: string) => void; onAdd: () => void;
}) {
  const { t } = useT();
  return (
    <div className={styles.addField}>
      <label className={styles.addLabel} htmlFor={id}>{label}</label>
      <div className={styles.addRow}>
        <input
          id={id}
          className={styles.input}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          autoComplete="off"
          aria-invalid={error !== null ? true : undefined}
          aria-describedby={error !== null ? `${id}-error` : undefined}
          onChange={event => { onChange(event.currentTarget.value); }}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onAdd(); } }}
        />
        <Button variant="secondary" className={styles.addButton} onPress={onAdd}>{t('bookings.settings.add')}</Button>
      </div>
      {error !== null ? <p id={`${id}-error`} className={styles.error}>{error}</p> : null}
    </div>
  );
}

