import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, X } from 'lucide-react';
import { CAKE_PARTS, MAX_CARDS_PER_PART, cakeLineCosts, cakeProductId, tierDiameters } from '@mise/shared/cake-model';
import type { Cake, CakeLineCost, CakePart, ResolvedLine } from '@mise/shared/cake-model';
import type { CostTables } from '@mise/shared/foodcost-model';
import { fcMoney } from '@mise/shared/fc-number';
import { useFoodcost } from '../foodcost/FoodcostContext';
import { lineMoney, lineName } from '../foodcost/lineNotes';
import { NumberBox } from '../foodcost/NumberBox';
import { PickDialog } from '../foodcost/PickDialog';
import type { Choice } from '../foodcost/PickDialog';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { addCard, cardsIn, removeCard, removePack, resetGrams, setGrams, setPackQty, addPack } from './cakeEditorModel';
import type { Selected } from './cakeEditorModel';
import styles from './TierParts.module.css';

type Props = {
  // The working copy, and the moves on it (the form's `edit`).
  cake: Cake;
  edit: (change: (current: Cake) => Cake) => void;
  // The tier shown, and the part chosen (the drawing and this list choose together).
  tier: number;
  onTier: (tier: number) => void;
  selected: Selected | null;
  onSelect: (selected: Selected) => void;
  // Labour is shown only where Food cost shows it (a labour rate this person may read).
  showLabour: boolean;
  // The form finds a packaging box by the ingredient (to focus it when Save refuses its 0 pieces).
  registerPack: (ingredientId: string, node: HTMLInputElement | null) => void;
  // A second tap on the chosen part in the 3D view: opens that part's «Add a card» (a new object each time, so the same part twice opens twice).
  openRequest?: OpenRequest | null;
};

export interface OpenRequest { part: CakePart }

type Picking = { kind: 'card'; part: CakePart } | { kind: 'pack' };

const NONE_TEXT = {
  soak: 'cakes.none.soak',
  decoration: 'cakes.none.decoration',
  coating: 'cakes.none.other',
  filling: 'cakes.none.other',
  base: 'cakes.none.other',
} as const;

// Keys of the focus hand-over that are not a card line.
const PACK_ADD = 'pack-add';
const packKey = (ingredientId: string): string => `pack|${ingredientId}`;

const lineKey = (line: { tier: number; part: CakePart; productId: string }): string => `${line.tier}|${line.part}|${line.productId}`;

// The parts of one tier, and the packaging of the whole cake.
//
// ⚠️ THE ORDER IS THE MOCKUP'S, the order a cake is built in: base first, decoration last (the drawing's labels run the other way,
// top to bottom, because the cake does).
// ⚠️ A GRAMS BOX IS EMPTY WHILE THE RULE DECIDES: its placeholder is the rule's figure, and typing a number is «corrected by hand»
// (the line says so, with the rule's figure beside it, and a ↺ puts the rule back).
export function TierParts({ cake, edit, tier, onTier, selected, onSelect, showLabour, registerPack, openRequest = null }: Props) {
  const { t } = useT();
  const money = useMoney();
  const ids = useId();
  const { tables, productsLoaded, recipesLoaded, ingredientsLoaded } = useFoodcost();
  const [picking, setPicking] = useState<Picking | null>(null);
  const shown = Math.min(Math.max(tier, 0), cake.tiers - 1);
  const diameters = tierDiameters(cake.diameterCm, cake.tiers);

  // The 3D view's second tap: the same dialog the part's «Add» button opens, and nothing where that button is not offered (a part with
  // no layer to fill, or with all its cards).
  useEffect(() => {
    if (openRequest === null) return;
    const { part } = openRequest;
    if (part === 'filling' && cake.discs < 2) return;
    if (cardsIn(cake, shown, part).length >= MAX_CARDS_PER_PART) return;
    setPicking({ kind: 'card', part });
    // Only a new request opens the dialog, never a later change of the cake.
  }, [openRequest]);

  const costs = useMemo(() => {
    const byKey = new Map<string, CakeLineCost>();
    for (const cost of cakeLineCosts(cake, tables)) byKey.set(lineKey(cost.line), cost);
    return byKey;
  }, [cake, tables]);

  // A card just added: its grams box takes the focus, the next thing to fill in.
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const focusNext = useRef<string | null>(null);
  // ⚠️ A CONTROL THAT IS PRESSED AND THEN GOES AWAY (✕, ↺) HANDS THE FOCUS ON, or the keyboard and the screen reader land on the page:
  // `focusNext` is the grams (or pieces) box that takes it, `focusAdd` the «Add» button of a part (or the packaging) that has no row left.
  const addButtons = useRef(new Map<string, HTMLButtonElement>());
  const focusAdd = useRef<string | null>(null);
  useLayoutEffect(() => {
    const key = focusNext.current;
    if (key !== null) {
      const node = boxes.current.get(key);
      if (!node) return;
      focusNext.current = null;
      node.focus();
      return;
    }
    const add = focusAdd.current;
    if (add === null) return;
    const button = addButtons.current.get(add);
    if (!button) return;
    focusAdd.current = null;
    button.focus();
  });
  const registerAdd = (key: string) => (node: HTMLButtonElement | null) => {
    if (node) addButtons.current.set(key, node); else addButtons.current.delete(key);
  };
  // The row that takes the focus when `lines[index]` goes: the next one, else the one before, else the part's «Add» button.
  const handFocusOn = (lines: { tier: number; part: CakePart; productId: string }[], index: number, addKey: string) => {
    const neighbour = lines[index + 1] ?? lines[index - 1];
    if (neighbour) focusNext.current = lineKey(neighbour); else focusAdd.current = addKey;
  };
  const registerBox = useCallback((key: string, node: HTMLInputElement | null) => {
    if (node) boxes.current.set(key, node); else boxes.current.delete(key);
  }, []);

  const loaded = { recipes: recipesLoaded, ingredients: ingredientsLoaded, products: productsLoaded };
  const nameOf = (productId: string) => lineName(t, { key: '', kind: 'semi', productId, qty: '' }, tables, loaded);

  const tierName = (index: number): string => {
    if (index === 0) return t('cakes.tier.bottom');
    return index === cake.tiers - 1 ? t('cakes.tier.top') : t('cakes.tier.middle');
  };

  // The rule in a sentence: the reference grams the cake took, scaled to this tier.
  const ruleSentence = (part: CakePart): string => {
    const ref = cake.ref;
    if (ref === null) return t('cakes.rule.none');
    const d = diameters[shown] ?? cake.diameterCm;
    switch (part) {
      case 'base': return t('cakes.rule.base', { g: ref.baseG, n: cake.discs, d });
      case 'soak': return t('cakes.rule.soak', { g: ref.soakG, n: cake.discs, d });
      case 'filling': return cake.discs < 2 ? '' : t('cakes.rule.filling', { g: ref.fillingG, n: cake.discs - 1, d });
      case 'coating': return t('cakes.rule.coating');
      case 'decoration': return t('cakes.rule.decoration');
    }
  };

  const choose = (choice: Choice) => {
    const current = picking;
    setPicking(null);
    if (current === null) return;
    if (current.kind === 'pack') {
      edit(cakeNow => addPack(cakeNow, choice.id));
      return;
    }
    focusNext.current = lineKey({ tier: shown, part: current.part, productId: choice.id });
    edit(cakeNow => addCard(cakeNow, shown, current.part, choice.id));
  };

  const packLoaded = { recipes: recipesLoaded, ingredients: ingredientsLoaded };

  return (
    <div className={styles.parts} data-labour={showLabour}>
      {cake.tiers > 1 ? (
        <div className={styles.tabs} role="group" aria-label={t('cakes.tier.group')}>
          {diameters.map((diameter, index) => (
            <button
              key={index}
              type="button"
              className={styles.tab}
              aria-pressed={index === shown}
              onClick={() => { onTier(index); }}
            >
              {tierName(index)}{' '}
              <small>{t('cakes.row.diameter', { d: diameter })}</small>
            </button>
          ))}
        </div>
      ) : null}

      <div className={styles.head} aria-hidden="true">
        <span>{t('cakes.parts.head.card')}</span>
        <span className={styles.right}>{t('cakes.parts.head.grams')}</span>
        <span className={styles.right}>{t('cakes.parts.head.materials')}</span>
        {showLabour ? <span className={styles.right}>{t('cakes.parts.head.labour')}</span> : null}
        <span />
      </div>

      {[...CAKE_PARTS].reverse().map(part => {
        const lines = cardsIn(cake, shown, part);
        const resolved = lines.map(line => costs.get(lineKey(line))).filter((cost): cost is CakeLineCost => cost !== undefined);
        const noLayer = part === 'filling' && cake.discs < 2;
        const full = lines.length >= MAX_CARDS_PER_PART;
        const isSelected = selected !== null && selected.tier === shown && selected.part === part;
        const headId = `${ids}-${part}`;
        return (
          <section key={part} className={styles.part} data-selected={isSelected} aria-labelledby={headId}>
            <div className={styles.partHead}>
              <h4 id={headId} className={styles.partName}>
                <button type="button" className={styles.choose} aria-pressed={isSelected} onClick={() => { onSelect({ tier: shown, part }); }}>
                  {t(`cakes.part.${part}`)}
                </button>
              </h4>
              <span className={styles.rule}>{ruleSentence(part)}</span>
            </div>

            {resolved.length === 0 ? (
              <p className={styles.none}>{noLayer ? t('cakes.noLayer') : t(NONE_TEXT[part])}</p>
            ) : resolved.map(cost => (
              <CakeLineRow
                key={lineKey(cost.line)}
                idPrefix={ids}
                cost={cost}
                name={nameOf(cost.line.productId)}
                loss={lossOf(tables.products, cost.line.productId)}
                showLabour={showLabour}
                registerBox={registerBox}
                onGrams={text => { edit(current => setGrams(current, shown, part, cost.line.productId, text)); }}
                onReset={() => {
                  focusNext.current = lineKey(cost.line);
                  edit(current => resetGrams(current, shown, part, cost.line.productId));
                }}
                onRemove={() => {
                  handFocusOn(lines, lines.findIndex(line => line.productId === cost.line.productId), part);
                  edit(current => removeCard(current, shown, part, cost.line.productId));
                }}
              />
            ))}

            {noLayer ? null : full ? (
              <p className={styles.full}>{t('cakes.add.full', { n: MAX_CARDS_PER_PART })}</p>
            ) : (
              <Button
                ref={registerAdd(part)}
                className={styles.add}
                variant="bare"
                aria-label={t(lines.length === 0 ? 'cakes.add.aria' : 'cakes.add.moreAria', { part: t(`cakes.part.${part}`) })}
                onPress={() => { setPicking({ kind: 'card', part }); }}
              >
                <Plus aria-hidden="true" />
                {t(lines.length === 0 ? 'cakes.add.first' : 'cakes.add.more')}
              </Button>
            )}
          </section>
        );
      })}

      <section className={styles.part} aria-labelledby={`${ids}-pack`}>
        <div className={styles.partHead}>
          <h4 id={`${ids}-pack`} className={styles.partName}>{t('cakes.pack.title')}</h4>
          <span className={styles.rule}>{t('cakes.pack.rule')}</span>
        </div>
        {cake.packaging.map((pack, index) => {
          const line = { key: pack.ingredientId, ingredientId: pack.ingredientId, qty: String(pack.qtyPcs) };
          const name = lineName(t, line, tables, packLoaded);
          const price = lineMoney(t, money, line, tables);
          return (
            <div key={pack.ingredientId} className={styles.line}>
              <div className={styles.what}>
                <span data-missing={name.missing}>{name.text}</span>
                <small>{t('cakes.pack.sub')}</small>
              </div>
              <div className={styles.qty}>
                <NumberBox
                  id={`${ids}-pack-${pack.ingredientId}`}
                  label={t('cakes.pack.qtyAria', { name: name.text })}
                  value={pack.qtyPcs > 0 ? String(pack.qtyPcs) : ''}
                  placeholder="1"
                  invalid={false}
                  inputRef={node => { registerPack(pack.ingredientId, node); registerBox(packKey(pack.ingredientId), node); }}
                  onChange={text => { edit(current => setPackQty(current, pack.ingredientId, text)); }}
                />
                <span className={styles.unit}>{t('cakes.pack.pcs')}</span>
              </div>
              <div className={styles.money} data-missing={price.noPrice}>
                {price.text === '' ? '—' : price.text}
              </div>
              {showLabour ? <div className={styles.money} /> : null}
              <div className={styles.actions}>
                <Button variant="bare" className={styles.icon} aria-label={t('cakes.row.removeAria', { name: name.text })} onPress={() => {
                  const next = cake.packaging[index + 1] ?? cake.packaging[index - 1];
                  if (next) focusNext.current = packKey(next.ingredientId); else focusAdd.current = PACK_ADD;
                  edit(current => removePack(current, pack.ingredientId));
                }}>
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          );
        })}
        <Button ref={registerAdd(PACK_ADD)} className={styles.add} variant="bare" onPress={() => { setPicking({ kind: 'pack' }); }}>
          <Plus aria-hidden="true" />
          {t('cakes.pack.add')}
        </Button>
      </section>

      {picking === null ? null : (
        <PickDialog
          mode={picking.kind === 'pack' ? 'packaging' : 'semi'}
          cardId={cakeProductId(cake.id)}
          usedSemiIds={picking.kind === 'card' ? cardsIn(cake, shown, picking.part).map(line => line.productId) : []}
          usedLabel={t('cakes.pick.usedHere')}
          onChoose={choose}
          onClose={() => { setPicking(null); }}
        />
      )}
    </div>
  );
}

// The oven loss of a card, in percent, when it has weighed raw and cooked (a card with no loss is «ready» as it is).
function lossOf(products: CostTables['products'], productId: string): number | null {
  const card = (products instanceof Map ? products.get(productId) : (products as Readonly<Record<string, unknown>> | undefined)?.[productId]) as { rawGrams?: unknown; cookedGrams?: unknown } | undefined;
  const raw = Number(card?.rawGrams);
  const cooked = Number(card?.cookedGrams);
  if (!(raw > 0) || !(cooked > 0) || cooked >= raw) return null;
  const pct = Math.round((1 - cooked / raw) * 100);
  return pct > 0 ? pct : null;
}

type RowProps = {
  idPrefix: string;
  cost: CakeLineCost;
  name: { text: string; missing: boolean };
  loss: number | null;
  showLabour: boolean;
  registerBox: (key: string, node: HTMLInputElement | null) => void;
  onGrams: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
};

function CakeLineRow({ idPrefix, cost, name, loss, showLabour, registerBox, onGrams, onReset, onRemove }: RowProps) {
  const { t } = useT();
  const money = useMoney();
  const line: ResolvedLine = cost.line;
  const key = lineKey(line);
  const note = line.manual
    ? (line.share === null ? t('cakes.row.manualNoRule') : t('cakes.row.manual', { g: line.share }))
    : line.missing
      ? t('cakes.row.typeGrams')
      : loss === null ? t('cakes.row.ready') : t('cakes.row.readyLoss', { n: loss });
  const label = name.text === '' ? t('fc.thisCardNoLonger') : name.text;
  return (
    <div className={styles.line}>
      <div className={styles.what}>
        <span data-missing={name.missing}>{label}</span>
        <small data-manual={line.manual} data-todo={!line.manual && line.missing}>{note}</small>
      </div>
      <div className={styles.qty}>
        <NumberBox
          id={`${idPrefix}-g-${key}`}
          label={t('cakes.row.gramsAria', { name: label })}
          value={line.manual ? String(line.grams) : ''}
          placeholder={line.share === null ? '0' : String(line.share)}
          invalid={false}
          inputRef={node => { registerBox(key, node); }}
          onChange={onGrams}
        />
        <span className={styles.unit}>g</span>
      </div>
      <div className={styles.money} data-missing={cost.materials === null}>
        {cost.materials === null ? '—' : fcMoney(cost.materials, money)}
        <small>{cost.materials === null ? t('cakes.row.noPrice') : t('cakes.row.materials')}</small>
      </div>
      {showLabour ? (
        <div className={styles.money}>
          {cost.labour === null ? '—' : fcMoney(cost.labour, money)}
          <small>{t('cakes.row.labour')}</small>
        </div>
      ) : null}
      <div className={styles.actions}>
        {line.manual ? (
          <Button variant="bare" className={styles.icon} aria-label={t('cakes.row.resetAria', { name: label })} onPress={onReset}>
            <RotateCcw aria-hidden="true" />
          </Button>
        ) : null}
        <Button variant="bare" className={styles.icon} aria-label={t('cakes.row.removeAria', { name: label })} onPress={onRemove}>
          <X aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
