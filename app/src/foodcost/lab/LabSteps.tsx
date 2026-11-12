import type { ReactNode, Ref } from 'react';
import { Check, Flame, Minus, Play, Plus, Timer } from 'lucide-react';
import { fcMoney, fcNumber } from '@mise/shared/fc-number';
import type { Product } from '@mise/shared/foodcost-model';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { useT } from '../../i18n/useT';
import { useMoney } from '../../session/useMoney';
import { Button } from '../../ui/Button';
import { useFoodcost } from '../FoodcostContext';
import { supplierOf } from '../supplierOf';
import { Keypad } from './Keypad';
import { formatClock } from './labClock';
import { groupedNumber, gramsText } from './labFormat';
import { MAX_PEOPLE, lineField, rawShown, soldByPieces, weighingUnit } from './labModel';
import type { FieldId, LabDraft, LabLine, LabNumbers, LabStepId, Presets } from './labModel';
import { typedText } from './keypadRules';
import styles from './LabMode.module.css';

type Props = {
  step: LabStepId;
  draft: LabDraft;
  base: Product;
  numbers: LabNumbers;
  field: FieldId | null;
  presets: Presets;
  elapsedMs: number;
  titleRef: Ref<HTMLHeadingElement>;
  titleId: string;
  onSelect: (field: FieldId) => void;
  onTick: (lineKey: string) => void;
  onAdd: () => void;
  onStart: () => void;
  onKey: (key: string) => void;
  allowComma: boolean;
  onUseTotal: () => void;
  onFromTimer: () => void;
  onPeople: (people: number) => void;
};

// The body of each step. Every figure arrives in `numbers` (labModel.labNumbers): nothing is worked out here.
export function StepBody(props: Props) {
  const { step } = props;
  if (step === 'start') return <StartStep {...props} />;
  if (step === 'ingredients') return <IngredientsStep {...props} />;
  if (step === 'raw') return <RawStep {...props} />;
  if (step === 'oven') return <OvenStep {...props} />;
  if (step === 'cooked') return <CookedStep {...props} />;
  if (step === 'pieces') return <PiecesStep {...props} />;
  if (step === 'time') return <TimeStep {...props} />;
  return <ResultStep {...props} />;
}

// ── Pieces of screen shared by the steps ────────────────────────────────────────────────────────

function Title({ id, titleRef, children }: { id: string; titleRef: Ref<HTMLHeadingElement>; children: string }) {
  return <h2 id={id} ref={titleRef} tabIndex={-1} className={styles.title}>{children}</h2>;
}

// A box the keypad types into: a BUTTON, never an input, so the tablet's keyboard cannot open. The selected one has the accent border.
function FieldButton({ id, selected, label, value, placeholder, unit, size, onSelect }: {
  id: FieldId; selected: boolean; label: string; value: string; placeholder?: string; unit?: string; size: 'xl' | 'md' | 'line'; onSelect: (field: FieldId) => void;
}) {
  const shown = value !== '' ? value : (placeholder ?? '');
  return (
    <button
      type="button"
      className={styles.field}
      data-size={size}
      data-empty={value === ''}
      aria-current={selected ? 'true' : undefined}
      onClick={() => { onSelect(id); }}
    >
      <span className="visually-hidden">{label}: </span>
      <span className={styles.fieldValue}>{shown === '' ? '—' : shown}</span>
      {unit === undefined ? null : <span className={styles.fieldUnit} aria-hidden="true">{unit}</span>}
    </button>
  );
}

// The fields on one side, the keypad on the other (under them on a phone).
function WithKeypad({ children, onKey, allowComma }: { children: ReactNode; onKey: (key: string) => void; allowComma: boolean }) {
  return (
    <div className={styles.work}>
      <div className={styles.fields}>{children}</div>
      <div className={styles.padCell}><Keypad onKey={onKey} allowComma={allowComma} /></div>
    </div>
  );
}

// ── Inizia ──────────────────────────────────────────────────────────────────────────────────────

function StartStep({ base, numbers, onStart }: Props) {
  const { t, locale } = useT();
  const parts = [
    t('lab.n.lines', { n: base.components.length }),
    t('lab.startDough', { grams: gramsText(numbers.totalGrams, locale) }),
  ];
  if (soldByPieces(base) && base.piecesPerBatch !== null) parts.push(t('lab.n.pieces', { n: base.piecesPerBatch }));
  return (
    <div className={styles.start}>
      <p className={styles.kicker}>{t('lab.enter')}</p>
      <h2 className={styles.startName}>{base.name}</h2>
      <p className={styles.startSummary}>{parts.join(' · ')}</p>
      <Button variant="bare" className={styles.startButton} autoFocus onPress={onStart}>
        <Play aria-hidden="true" />
        <span>{t('lab.start')}</span>
      </Button>
      <p className={styles.startHint}>{t('lab.startHint')}</p>
    </div>
  );
}

// ── Ingredienti ─────────────────────────────────────────────────────────────────────────────────

function IngredientsStep(props: Props) {
  const { draft, field, titleRef, titleId, onSelect, onTick, onAdd, onKey, allowComma } = props;
  const { t, locale } = useT();
  const snap = useFoodcost();
  const done = draft.lines.filter(line => draft.ticked[line.key] === true).length;

  const infoOf = (line: LabLine): { name: string; second: string } => {
    if (line.ref.kind === 'recipe') {
      const recipe = snap.recipes[line.ref.recipeId];
      // A phone with no local copy has not heard the recipes yet: «loading», never «no longer exists».
      const missing = snap.recipesLoaded ? t('fc.thisRecipeNoLonger') : t('session.loading');
      return { name: recipe ? String(recipe.name ?? '').trim() : missing, second: t('fc.recipeWord') };
    }
    const ingredient = snap.ingredients[line.ref.ingredientId];
    return {
      name: ingredient ? ingredientDisplayName(ingredient).trim() : snap.ingredientsLoaded ? t('fc.thisItemNoLonger') : t('session.loading'),
      second: ingredient ? supplierOf(ingredient, snap.suppliers) : '',
    };
  };

  return (
    <WithKeypad onKey={onKey} allowComma={allowComma}>
      <div className={styles.head}>
        <Title id={titleId} titleRef={titleRef}>{t('lab.step.ingredients')}</Title>
        <p className={styles.counter}>{t('lab.counter', { done, total: draft.lines.length })}</p>
      </div>
      <div className={styles.heads} aria-hidden="true">
        <span>{t('lab.planned')}</span>
        <span>{t('lab.weighed')}</span>
      </div>
      {draft.lines.length === 0 ? <p className={styles.empty}>{t('lab.noLines')}</p> : (
        <ul className={styles.lines}>
          {draft.lines.map(line => {
            const info = infoOf(line);
            const ticked = draft.ticked[line.key] === true;
            const unit = weighingUnit(line);
            const planned = line.planned === null
              ? t('lab.newLine')
              : unit === 'pcs' ? t('lab.amountPcs', { n: groupedNumber(line.planned, locale) }) : gramsText(line.planned, locale);
            const placeholder = line.planned === null ? '' : unit === 'pcs' ? groupedNumber(line.planned, locale) : typedText(line.planned);
            const id = lineField(line.key);
            return (
              <li key={line.key} className={styles.line} data-done={ticked} data-selected={field === id}>
                <button
                  type="button"
                  className={styles.tick}
                  aria-pressed={ticked}
                  aria-label={t('lab.doneLine', { name: info.name })}
                  onClick={() => { onTick(line.key); }}
                >
                  <Check aria-hidden="true" />
                </button>
                <span className={styles.lineName}>
                  <span className={styles.lineTitle}>{info.name}</span>
                  {info.second === '' ? null : <span className={styles.lineSecond}>{info.second}</span>}
                </span>
                <span className={styles.linePlanned} data-new={line.planned === null}>{planned}</span>
                <FieldButton
                  id={id}
                  selected={field === id}
                  label={`${t('lab.weighed')} ${info.name}`}
                  value={draft.weighed[line.key] ?? ''}
                  placeholder={placeholder}
                  unit={unit === 'pcs' ? t('lab.unitPcs') : 'g'}
                  size="line"
                  onSelect={onSelect}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Button variant="bare" className={styles.addLine} onPress={onAdd}>
        <Plus aria-hidden="true" />
        <span>{t('lab.addIngredient')}</span>
      </Button>
    </WithKeypad>
  );
}

// ── Impasto crudo ───────────────────────────────────────────────────────────────────────────────

function RawStep({ draft, numbers, field, titleRef, titleId, onSelect, onKey, onUseTotal, allowComma }: Props) {
  const { t, locale } = useT();
  const apart = numbers.product.rawGrams !== null;
  return (
    <WithKeypad onKey={onKey} allowComma={allowComma}>
      <Title id={titleId} titleRef={titleRef}>{t('lab.step.raw')}</Title>
      <FieldButton
        id="raw"
        selected={field === 'raw'}
        label={t('lab.step.raw')}
        value={rawShown(draft, numbers.totalGrams)}
        unit="g"
        size="xl"
        onSelect={onSelect}
      />
      {apart ? (
        <Button variant="bare" className={styles.inlineButton} onPress={onUseTotal}>
          {t('lab.useTotal', { grams: gramsText(numbers.totalGrams, locale) })}
        </Button>
      ) : <p className={styles.note}>{t('lab.rawIsTotal')}</p>}
    </WithKeypad>
  );
}

// ── In forno ────────────────────────────────────────────────────────────────────────────────────

function OvenStep({ elapsedMs, titleRef, titleId }: Props) {
  const { t } = useT();
  return (
    <div className={styles.oven}>
      <Flame aria-hidden="true" className={styles.ovenIcon} />
      <Title id={titleId} titleRef={titleRef}>{t('lab.step.oven')}</Title>
      <p className={styles.ovenClock} aria-hidden="true">{formatClock(elapsedMs)}</p>
      <p className={styles.note}>{t('lab.ovenHint')}</p>
    </div>
  );
}

// ── Impasto cotto ───────────────────────────────────────────────────────────────────────────────

function CookedStep({ draft, numbers, field, titleRef, titleId, onSelect, onKey, allowComma }: Props) {
  const { t } = useT();
  const money = useMoney();
  const typed = numbers.cookedGrams !== null;
  return (
    <WithKeypad onKey={onKey} allowComma={allowComma}>
      <Title id={titleId} titleRef={titleRef}>{t('lab.step.cooked')}</Title>
      <FieldButton id="cooked" selected={field === 'cooked'} label={t('lab.step.cooked')} value={draft.cooked} unit="g" size="xl" onSelect={onSelect} />
      {/* A live region that is always on the page, filled once there is something to say. */}
      <p className={styles.loss} aria-live="polite" data-bad={numbers.heavier}>
        {typed && numbers.heavier ? t('lab.heavier') : typed && numbers.lossPct !== null ? t('lab.loss', { pct: fcNumber(numbers.lossPct, money) }) : ''}
      </p>
    </WithKeypad>
  );
}

// ── Pezzi ottenuti ──────────────────────────────────────────────────────────────────────────────

function PiecesStep({ draft, base, field, presets, titleRef, titleId, onSelect, onKey, allowComma }: Props) {
  const { t, locale } = useT();
  return (
    <WithKeypad onKey={onKey} allowComma={allowComma}>
      <Title id={titleId} titleRef={titleRef}>{t('lab.step.pieces')}</Title>
      <FieldButton id="pieces" selected={field === 'pieces'} label={t('lab.step.pieces')} value={draft.pieces ?? presets.pieces} size="xl" onSelect={onSelect} />
      {base.piecesPerBatch === null ? null : <p className={styles.note}>{t('lab.cardPieces', { n: groupedNumber(base.piecesPerBatch, locale) })}</p>}
    </WithKeypad>
  );
}

// ── Tempo e persone ─────────────────────────────────────────────────────────────────────────────

function TimeStep({ draft, numbers, field, titleRef, titleId, onSelect, onKey, onFromTimer, onPeople, allowComma }: Props) {
  const { t } = useT();
  const typed = draft.minutes !== null;
  const minutes = draft.minutes ?? String(numbers.minutes);
  return (
    <WithKeypad onKey={onKey} allowComma={allowComma}>
      <Title id={titleId} titleRef={titleRef}>{t('lab.step.time')}</Title>
      <div className={styles.timeGroup}>
        <p className={styles.fieldLabel} aria-hidden="true">{t('lab.minutesLabel')}</p>
        <FieldButton id="minutes" selected={field === 'minutes'} label={t('lab.minutesLabel')} value={minutes} unit={t('lab.minutesUnit')} size="md" onSelect={onSelect} />
        {typed ? (
          <Button variant="bare" className={styles.inlineButton} onPress={onFromTimer}>
            <Timer aria-hidden="true" />
            <span>{t('lab.fromTimer')}</span>
          </Button>
        ) : (
          <p className={styles.note}>
            <Timer aria-hidden="true" className={styles.noteIcon} />
            <span>{t('lab.fromTimer')}</span>
          </p>
        )}
      </div>
      <div className={styles.timeGroup} role="group" aria-labelledby={`${titleId}-people`}>
        <p className={styles.fieldLabel} id={`${titleId}-people`}>{t('lab.people')}</p>
        <div className={styles.stepper}>
          <button
            type="button"
            className={styles.stepperButton}
            aria-label={t('lab.personLess')}
            aria-disabled={draft.people <= 1}
            onClick={() => { onPeople(draft.people - 1); }}
          >
            <Minus aria-hidden="true" />
          </button>
          <output className={styles.stepperValue} aria-label={t('lab.people')}>{draft.people}</output>
          <button
            type="button"
            className={styles.stepperButton}
            aria-label={t('lab.personMore')}
            aria-disabled={draft.people >= MAX_PEOPLE}
            onClick={() => { onPeople(draft.people + 1); }}
          >
            <Plus aria-hidden="true" />
          </button>
        </div>
      </div>
    </WithKeypad>
  );
}

// ── Risultato ───────────────────────────────────────────────────────────────────────────────────

const UNIT_LABEL = { piece: 'lab.res.piece', kg: 'lab.res.weightSold', pack: 'lab.res.pack' } as const;

function ResultStep({ numbers, base, titleRef, titleId }: Props) {
  const { t, locale } = useT();
  const money = useMoney();
  const partial = numbers.partial;
  const more = (value: string, isPartial: boolean): string => (isPartial ? t('fc.preview.moreThan', { value }) : value);
  const dash = '—';
  const cooked = numbers.cookedGrams !== null;

  const loss = numbers.lossPct !== null ? `${fcNumber(numbers.lossPct, money)}%` : dash;
  const lossSub = numbers.heavier ? t('lab.res.lossHeavier') : numbers.lossPct === null ? t('lab.res.lossNone') : '';
  const kilo = numbers.perKg === null ? dash : more(fcMoney(numbers.perKg, money), numbers.perKgPartial);
  const unitCost = numbers.unitCost === null ? dash : more(fcMoney(numbers.unitCost, money), partial);
  const withLabour = numbers.totalUnitCost === null ? '' : t('lab.res.withLabour', { cost: more(fcMoney(numbers.totalUnitCost, money), partial) });

  const summary = [
    t('lab.res.raw', { grams: gramsText(numbers.rawGrams, locale) }),
    cooked ? t('lab.res.cooked', { grams: gramsText(numbers.cookedGrams ?? 0, locale) }) : t('lab.res.cookedNone'),
  ];
  if (soldByPieces(base) && numbers.pieces !== null) summary.push(t('lab.n.pieces', { n: numbers.pieces }));
  summary.push(t('lab.n.minutes', { n: numbers.minutes }), t('lab.n.people', { n: numbers.people }));

  return (
    <div className={styles.result}>
      <Title id={titleId} titleRef={titleRef}>{t('lab.step.result')}</Title>
      <ul className={styles.tiles}>
        <li className={styles.tile}>
          <span className={styles.tileLabel}>{t('lab.res.loss')}</span>
          <span className={styles.tileValue}>{loss}</span>
          <span className={styles.tileSub}>{lossSub}</span>
        </li>
        <li className={styles.tile}>
          <span className={styles.tileLabel}>{cooked ? t('lab.res.kgCooked') : t('lab.res.kgDough')}</span>
          <span className={styles.tileValue}>{kilo}</span>
          <span className={styles.tileSub}>{numbers.perKgPartial ? t('lab.res.missingPrice') : ''}</span>
        </li>
        {numbers.unit === null ? null : (
          <li className={styles.tile}>
            <span className={styles.tileLabel}>{t(UNIT_LABEL[numbers.unit])}</span>
            <span className={styles.tileValue}>{unitCost}</span>
            <span className={styles.tileSub}>{partial && numbers.totalUnitCost === null ? t('lab.res.missingPrice') : withLabour}</span>
          </li>
        )}
      </ul>
      <p className={styles.resultLine}>{summary.join(' · ')}</p>
    </div>
  );
}

