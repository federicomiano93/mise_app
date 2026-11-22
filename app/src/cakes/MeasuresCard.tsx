import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { Ref } from 'react';
import { MAX_TIERS, MIN_TIER_CM, discHeightOf, maxTiersFor, tierDiameters } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import { localNumber } from '@mise/shared/currency';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { setMeasure, setName } from './cakeEditorModel';
import { useStepFocus } from './useStepFocus';
import styles from './MeasuresCard.module.css';

type Props = {
  cake: Cake;
  edit: (change: (current: Cake) => Cake) => void;
  // The name's box, and whether Save found it empty (it is then highlighted and takes the focus).
  nameRef: Ref<HTMLInputElement>;
  nameInvalid: boolean;
  // Whether the card shows its body or only its title and one summary line. Held by the form: Save with an empty name opens it.
  open: boolean;
  onToggle: (open: boolean) => void;
};

type StepperProps = {
  title: string;
  sub: string;
  value: string;
  lessLabel: string;
  moreLabel: string;
  onLess: () => void;
  onMore: () => void;
  lessDisabled: boolean;
  moreDisabled: boolean;
  // Said on its own line under the row (why «+» is blocked).
  note?: string;
};

// A measure the cake has: its name and what it means, then «−», the value and «+». Both buttons are 56px (the steppers' size).
// Also used by the cost card, for the slices.
export function Stepper({ title, sub, value, lessLabel, moreLabel, onLess, onMore, lessDisabled, moreDisabled, note }: StepperProps) {
  const noteId = useId();
  const focus = useStepFocus(lessDisabled, moreDisabled);
  return (
    <div className={styles.row}>
      <div className={styles.what}>
        <b>{title}</b>
        <span>{sub}</span>
      </div>
      <div className={styles.step}>
        <Button ref={focus.less} variant="bare" className={styles.stepButton} aria-label={lessLabel} isDisabled={lessDisabled} onPress={onLess}>−</Button>
        <output className={styles.value}>{value}</output>
        <Button
          ref={focus.more}
          variant="bare"
          className={styles.stepButton}
          aria-label={moreLabel}
          isDisabled={moreDisabled}
          {...(note === undefined ? {} : { 'aria-describedby': noteId })}
          onPress={onMore}
        >
          +
        </Button>
      </div>
      {note === undefined ? null : <p id={noteId} className={styles.limit}>{note}</p>}
    </div>
  );
}

type MeasureBoxProps = {
  id: string;
  label: string;
  // A name for the box when the label on screen is not the whole of it («Diameter in centimetres»).
  ariaLabel?: string;
  value: number;
  // The unit drawn inside the box, at its right.
  unit?: string;
  // The keyboard a phone raises: whole numbers by default, 'decimal' for a box that takes «4,5».
  inputMode?: 'numeric' | 'decimal';
  // What the box shows when nothing is being typed (default: the plain number); a decimal box passes the venue's separator.
  display?: string;
  onCommit: (value: number) => void;
};

// A number typed into a small box: the text stays as typed until the person leaves the box (or presses Enter), then it is handed up and
// the box shows what the cake took (the cake clamps it: a diameter to what its tiers need, the discs to 1–5).
// ⚠️ NOT PER KEYSTROKE: «2» on the way to «22» would be clamped to the smallest diameter at once.
function MeasureBox({ id, label, ariaLabel, value, unit, inputMode = 'numeric', display, onCommit }: MeasureBoxProps) {
  const [typed, setTyped] = useState<string | null>(null);
  const commit = () => {
    if (typed === null) return;
    const number = Number(typed.replace(',', '.'));
    if (typed.trim() !== '' && Number.isFinite(number)) onCommit(number);
    setTyped(null);
  };
  return (
    <div className={styles.measure}>
      <label htmlFor={id} className={styles.measureLabel}>{label}</label>
      <span className={styles.unitBox}>
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          className={styles.input}
          data-unit={unit !== undefined}
          {...(ariaLabel === undefined ? {} : { 'aria-label': ariaLabel })}
          value={typed ?? display ?? String(value)}
          onChange={event => { setTyped(event.target.value); }}
          onBlur={commit}
          onKeyDown={event => { if (event.key === 'Enter') commit(); }}
        />
        {unit === undefined ? null : <span className={styles.unit} aria-hidden="true">{unit}</span>}
      </span>
    </div>
  );
}

// The cake's name and measures, in one compact block over the steps: the name, then the diameter («cm» inside its box), the tiers and
// the discs (the slices and the assembly minutes are in the cost step: they only change figures there). No category (his call, 21 Nov
// 2026): every cake's card sits in Food cost's «Cakes» group.
export function MeasuresCard({ cake, edit, nameRef, nameInvalid, open, onToggle }: Props) {
  const { t } = useT();
  const money = useMoney();
  const ids = useId();
  const move = (measure: Parameters<typeof setMeasure>[1], value: number) => { edit(current => setMeasure(current, measure, value)); };

  const carries = maxTiersFor(cake.diameterCm);
  const smallest = tierDiameters(cake.diameterCm, cake.tiers + 1)[cake.tiers] ?? 0;
  // Said only when it is the DIAMETER that stops another tier (not the three-tier ceiling).
  const tiersNote = cake.tiers < MAX_TIERS && carries <= cake.tiers
    ? t('cakes.measure.tiersLimit', { d: smallest, min: MIN_TIER_CM })
    : undefined;

  // The height as the venue writes numbers («4,5» in Italy, «4.5» in the UK), the same way the reference screen says it.
  const height = discHeightOf(cake);
  const heightText = localNumber(String(height), money, false);
  // Folded, the measures read as one line under the title.
  const summary = [
    cake.name.trim() === '' ? t('cakes.measures.summaryUntitled') : cake.name.trim(),
    `${localNumber(String(cake.diameterCm), money, false)} ${t('cakes.ref.unitCm')}`,
    t('cakes.measures.summaryTiers', { n: cake.tiers }),
    t('cakes.measures.summaryDiscs', { n: cake.discs }),
    t('cakes.measures.summaryHeight', { h: heightText }),
  ].join(' · ');
  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className={styles.title}>
        <button type="button" className={styles.fold} aria-expanded={open} aria-controls={`${ids}-body`} onClick={() => { onToggle(!open); }}>
          <span className={styles.foldText}>
            <span>{t('cakes.measures.title')}</span>
            {open ? null : <small className={styles.foldSummary}>{summary}</small>}
          </span>
          <ChevronDown aria-hidden="true" className={styles.chevron} data-open={open} />
        </button>
      </h3>

      {open ? <div id={`${ids}-body`}>
      <div className={styles.grid}>
        <div className={styles.measure} data-wide="true">
          <label htmlFor={`${ids}-name`} className={styles.measureLabel}>{t('cakes.name')}</label>
          <input
            ref={nameRef}
            id={`${ids}-name`}
            type="text"
            className={styles.input}
            autoComplete="off"
            maxLength={200}
            aria-invalid={nameInvalid ? true : undefined}
            data-invalid={nameInvalid}
            value={cake.name}
            onChange={event => { edit(current => setName(current, event.target.value)); }}
          />
        </div>
        <MeasureBox
          id={`${ids}-diameter`}
          label={t('cakes.measure.diameter')}
          ariaLabel={t('cakes.measure.diameterAria')}
          value={cake.diameterCm}
          unit={t('cakes.ref.unitCm')}
          onCommit={value => { move('diameterCm', value); }}
        />
        <MeasureBox id={`${ids}-tiers`} label={t('cakes.measure.tiers')} value={cake.tiers} onCommit={value => { move('tiers', value); }} />
        <MeasureBox id={`${ids}-discs`} label={t('cakes.measure.discs')} value={cake.discs} onCommit={value => { move('discs', value); }} />
        <MeasureBox
          id={`${ids}-height`}
          label={t('cakes.measure.discHeight')}
          ariaLabel={t('cakes.measure.discHeightAria')}
          value={height}
          display={heightText}
          unit={t('cakes.ref.unitCm')}
          inputMode="decimal"
          onCommit={value => { move('discHeightCm', value); }}
        />
      </div>
      {tiersNote === undefined ? null : <p className={styles.limit}>{tiersNote}</p>}
      </div> : null}
    </section>
  );
}
