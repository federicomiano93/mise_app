import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Plus, RotateCcw, X } from 'lucide-react';
import { MAX_CARDS_PER_PART, cakeLineCosts, cakeProductId, tierDiameters } from '@mise/shared/cake-model';
import type { Cake, CakeLineCost, CakePart, ResolvedLine } from '@mise/shared/cake-model';
import type { CostTables } from '@mise/shared/foodcost-model';
import { fcMoney } from '@mise/shared/fc-number';
import { localNumber } from '@mise/shared/currency';
import { useFoodcost } from '../foodcost/FoodcostContext';
import { lineMoney, lineName } from '../foodcost/lineNotes';
import { NumberBox } from '../foodcost/NumberBox';
import { PickDialog } from '../foodcost/PickDialog';
import { useSemiRows } from '../foodcost/useSemiRows';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { addCard, cardsIn, removeCard, removePack, resetGrams, setGrams, setPackQty, addPack } from './cakeEditorModel';
import type { Selected } from './cakeEditorModel';
import { STEP_PARTS, partFigures, partKey, stepNumber, toggleStep } from './cakeStepsModel';
import type { StepKey } from './cakeStepsModel';
import { RecipeCombo } from './RecipeCombo';
import type { ComboOption } from './RecipeCombo';
import { useSpoken } from './useSpoken';
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
  // The form finds a packaging box by the ingredient (to focus it when Save refuses its 0 pieces).
  registerPack: (ingredientId: string, node: HTMLInputElement | null) => void;
  // A second tap on the chosen part in the 3D view: opens that part's step and puts the cursor in its search box (a new object each
  // time, so the same part twice opens twice).
  openRequest?: OpenRequest | null;
  // Called once the request has been acted on (or turned down), so the form drops it: a remount never reopens an old step.
  onOpenHandled?: () => void;
  // The step that is open (UI state kept by the form, never saved), and its move.
  open: StepKey | null;
  onOpen: (next: StepKey | null) => void;
  // The sixth step, «Cost and price»: what its closed row says, and what it shows when open (the form owns the numbers).
  costSummary: string;
  costBody: ReactNode;
};

export interface OpenRequest { part: CakePart }

// Key of the focus hand-over that is not a card line: the packaging's «Add» button.
const PACK_ADD = 'pack-add';
const packKey = (ingredientId: string): string => `pack|${ingredientId}`;

const lineKey = (line: { tier: number; part: CakePart; productId: string }): string => `${line.tier}|${line.part}|${line.productId}`;

// The guided steps of one tier — base, soak, filling, coating, decoration — then the packaging of the whole cake, then «Cost and price».
//
// ⚠️ ONE STEP IS OPEN AT A TIME, the rest show their title and what they hold. An open step shows ONLY a search box over the venue's
// semi-finished cards, and the cards chosen with their grams. A closed step is a button (aria-expanded) that opens it.
// ⚠️ A GRAMS BOX IS EMPTY WHILE THE RULE DECIDES: its placeholder is the rule's figure, and typing a number is «corrected by hand»
// (the line says so, with the rule's figure beside it, and a ↺ puts the rule back). A cake that started «from scratch» has no rule: the
// placeholder is 0 and every line says «type the grams».
export function TierParts({
  cake, edit, tier, onTier, selected, onSelect, registerPack, openRequest = null, onOpenHandled, open, onOpen, costSummary, costBody,
}: Props) {
  const { t } = useT();
  const money = useMoney();
  const ids = useId();
  const { tables, productsLoaded, recipesLoaded, ingredientsLoaded } = useFoodcost();
  const [pickingPack, setPickingPack] = useState(false);
  const shown = Math.min(Math.max(tier, 0), cake.tiers - 1);
  const diameters = tierDiameters(cake.diameterCm, cake.tiers);

  // The cards the open step lists: Food cost's semi-finished cards, the same rows its chooser offers (useSemiRows).
  const openPart = open !== null && open !== 'cost' ? open : null;
  const used = useMemo(() => (openPart === null ? [] : cardsIn(cake, shown, openPart).map(line => line.productId)), [cake, shown, openPart]);
  const semiRows = useSemiRows(cakeProductId(cake.id), used);
  const options = useMemo<ComboOption[]>(() => semiRows.map(row => ({
    id: row.card.id,
    name: row.card.name.trim(),
    sub: row.reason === null ? row.figures.pill : row.reason === 'fc.pick.alreadyHere' ? t('cakes.pick.usedHere') : t(row.reason),
    off: row.reason !== null,
  })), [semiRows, t]);

  // The 3D view's second tap: the part's step opens and the cursor goes to its search box; nothing to type in for a part with no
  // layer to fill, or with all its cards (the step still opens, to show it).
  const focusCombo = useRef<CakePart | null>(null);
  useEffect(() => {
    if (openRequest === null) return;
    const { part } = openRequest;
    onOpenHandled?.();
    onOpen(part);
    if (part === 'filling' && cake.discs < 2) return;
    if (cardsIn(cake, shown, part).length >= MAX_CARDS_PER_PART) return;
    focusCombo.current = part;
    // Only a new request opens a step, never a later change of the cake.
  }, [openRequest]);

  const costs = useMemo(() => {
    const byKey = new Map<string, CakeLineCost>();
    for (const cost of cakeLineCosts(cake, tables)) byKey.set(lineKey(cost.line), cost);
    return byKey;
  }, [cake, tables]);
  const figures = useMemo(() => partFigures([...costs.values()]), [costs]);

  // A card just added: its grams box takes the focus, the next thing to fill in.
  const boxes = useRef(new Map<string, HTMLInputElement>());
  const focusNext = useRef<string | null>(null);
  // ⚠️ A CONTROL THAT IS PRESSED AND THEN GOES AWAY (✕, ↺) HANDS THE FOCUS ON, or the keyboard and the screen reader land on the page:
  // `focusNext` is the grams (or pieces) box that takes it, `focusStep` the title of a step (or the packaging's «Add» button) that has
  // no row left.
  const stepButtons = useRef(new Map<CakePart, HTMLButtonElement>());
  const combos = useRef(new Map<CakePart, HTMLInputElement>());
  const addPackButton = useRef<HTMLButtonElement | null>(null);
  const focusStep = useRef<CakePart | typeof PACK_ADD | null>(null);
  useLayoutEffect(() => {
    const key = focusNext.current;
    if (key !== null) {
      const node = boxes.current.get(key);
      if (!node) return;
      focusNext.current = null;
      node.focus();
      return;
    }
    const part = focusCombo.current;
    if (part !== null) {
      const node = combos.current.get(part);
      if (!node) return;
      focusCombo.current = null;
      node.focus();
      return;
    }
    const step = focusStep.current;
    if (step === null) return;
    const node = step === PACK_ADD ? addPackButton.current : stepButtons.current.get(step);
    if (!node) return;
    focusStep.current = null;
    node.focus();
  });
  // The row that takes the focus when `lines[index]` goes: the next one, else the one before, else the step's title.
  const handFocusOn = (lines: { tier: number; part: CakePart; productId: string }[], index: number, part: CakePart) => {
    const neighbour = lines[index + 1] ?? lines[index - 1];
    if (neighbour) focusNext.current = lineKey(neighbour); else focusStep.current = part;
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

  const pick = (part: CakePart, productId: string) => {
    focusNext.current = lineKey({ tier: shown, part, productId });
    edit(cakeNow => addCard(cakeNow, shown, part, productId));
  };

  const packLoaded = { recipes: recipesLoaded, ingredients: ingredientsLoaded };
  const said = useSpoken(open === null ? '' : t('cakes.steps.opened', {
    n: stepNumber(open), total: STEP_PARTS.length + 1, part: open === 'cost' ? t('cakes.cost.title') : t(`cakes.part.${open}`),
  }));

  // What a closed step says under its title: each card's name with its grams (or that the grams are still to be typed).
  const closedLines = (part: CakePart): string[] => cardsIn(cake, shown, part).flatMap(line => {
    const cost = costs.get(lineKey(line));
    const name = nameOf(line.productId).text.trim();
    if (name === '' || !cost) return [];
    const grams = cost.line.missing ? t('cakes.gramsToType') : t('cakes.grams', { g: localNumber(String(Math.round(cost.line.grams)), money) });
    return [t('cakes.steps.line', { name, grams })];
  });

  const header = (
    key: StepKey, title: string, summary: string[], hasCard: boolean, todo: boolean, onPress: () => void,
    ref?: (node: HTMLButtonElement | null) => void,
  ) => {
    const isOpen = open === key;
    return (
      <h4 className={styles.stepName}>
        <button
          ref={ref}
          id={`${ids}-step-${key}`}
          type="button"
          className={styles.stepButton}
          aria-expanded={isOpen}
          aria-controls={`${ids}-panel-${key}`}
          onClick={onPress}
        >
          <span className={styles.num} data-done={hasCard} aria-hidden="true">{hasCard ? <Check /> : stepNumber(key)}</span>
          <span className={styles.stepText}>
            <span className={styles.stepTitle}>{title}</span>
            {isOpen ? null : summary.map((line, index) => <span key={index} className={styles.stepSub} data-todo={todo}>{line}</span>)}
          </span>
          {hasCard ? <span className="visually-hidden">{t('cakes.steps.hasCard')}</span> : null}
        </button>
      </h4>
    );
  };

  return (
    <div className={styles.parts}>
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

      <p className="visually-hidden" role="status">{said}</p>

      <ol className={styles.steps} aria-label={t('cakes.steps.list')}>
        {STEP_PARTS.map(part => {
          const isOpen = open === part;
          const lines = cardsIn(cake, shown, part);
          const resolved = lines.map(line => costs.get(lineKey(line))).filter((cost): cost is CakeLineCost => cost !== undefined);
          const noLayer = part === 'filling' && cake.discs < 2;
          const full = lines.length >= MAX_CARDS_PER_PART;
          const isSelected = selected !== null && selected.tier === shown && selected.part === part;
          const todo = figures.get(partKey(shown, part))?.missingGrams === true;
          const partName = t(`cakes.part.${part}`);
          return (
            <li key={part} className={styles.step} data-open={isOpen} data-selected={isSelected}>
              {header(part, partName, closedLines(part), lines.length > 0, todo, () => {
                onOpen(toggleStep(open, part));
                onSelect({ tier: shown, part });
              }, node => { if (node) stepButtons.current.set(part, node); else stepButtons.current.delete(part); })}

              {isOpen ? (
                <div id={`${ids}-panel-${part}`} className={styles.stepBody} role="group" aria-labelledby={`${ids}-step-${part}`}>
                  {noLayer ? (
                    <p className={styles.none}>{t('cakes.noLayer')}</p>
                  ) : full ? (
                    <p className={styles.full}>{t('cakes.add.full', { n: MAX_CARDS_PER_PART })}</p>
                  ) : (
                    <RecipeCombo
                      label={t('cakes.combo.label', { part: partName })}
                      placeholder={t(lines.length === 0 ? 'cakes.combo.placeholder' : 'cakes.combo.placeholderMore')}
                      options={options}
                      emptyText={options.length === 0 ? t('fc.pick.semiEmpty') : t('cakes.combo.empty')}
                      openLabel={t('cakes.combo.open')}
                      inputRef={node => { if (node) combos.current.set(part, node); else combos.current.delete(part); }}
                      onPick={id => { pick(part, id); }}
                    />
                  )}

                  {resolved.map(cost => (
                    <CakeLineRow
                      key={lineKey(cost.line)}
                      idPrefix={ids}
                      cost={cost}
                      name={nameOf(cost.line.productId)}
                      loss={lossOf(tables.products, cost.line.productId)}
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
                  {resolved.length > 0 && ruleSentence(part) !== '' ? <p className={styles.hint}>{ruleSentence(part)}</p> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <section className={styles.pack} aria-labelledby={`${ids}-pack`}>
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
              <div className={styles.actions}>
                <Button variant="bare" className={styles.icon} aria-label={t('cakes.row.removeAria', { name: name.text })} onPress={() => {
                  const next = cake.packaging[index + 1] ?? cake.packaging[index - 1];
                  if (next) focusNext.current = packKey(next.ingredientId); else focusStep.current = PACK_ADD;
                  edit(current => removePack(current, pack.ingredientId));
                }}>
                  <X aria-hidden="true" />
                </Button>
              </div>
            </div>
          );
        })}
        <Button ref={addPackButton} className={styles.add} variant="bare" onPress={() => { setPickingPack(true); }}>
          <Plus aria-hidden="true" />
          {t('cakes.pack.add')}
        </Button>
      </section>

      <p className={styles.divider}>{t('cakes.steps.then')}</p>
      <ol className={styles.steps} start={STEP_PARTS.length + 1}>
        <li className={styles.step} data-open={open === 'cost'}>
          {header('cost', t('cakes.cost.title'), costSummary === '' ? [] : [costSummary], false, false, () => { onOpen(toggleStep(open, 'cost')); })}
          {open === 'cost' ? (
            <div id={`${ids}-panel-cost`} className={styles.stepBody} role="group" aria-labelledby={`${ids}-step-cost`}>
              {costBody}
              <Button className={styles.finish} variant="primary" onPress={() => { onOpen(null); }}>
                <Check aria-hidden="true" />
                {t('cakes.steps.finish')}
              </Button>
            </div>
          ) : null}
        </li>
      </ol>

      {pickingPack ? (
        <PickDialog
          mode="packaging"
          cardId={cakeProductId(cake.id)}
          onChoose={choice => { setPickingPack(false); edit(cakeNow => addPack(cakeNow, choice.id)); }}
          onClose={() => { setPickingPack(false); }}
        />
      ) : null}
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
  registerBox: (key: string, node: HTMLInputElement | null) => void;
  onGrams: (text: string) => void;
  onReset: () => void;
  onRemove: () => void;
};

// One card of the open step: its name and how its grams are decided, the grams box, what the card costs, ↺ and ✕.
function CakeLineRow({ idPrefix, cost, name, loss, registerBox, onGrams, onReset, onRemove }: RowProps) {
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
