import { useId } from 'react';
import type { Ref } from 'react';
import { MAX_DISCS, MAX_TIERS, MIN_DISCS, MIN_TIER_CM, maxTiersFor, minDiameterFor, tierDiameters } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { DIAMETER_STEP_CM, EDITOR_MAX_DIAMETER_CM, setMeasure, setName } from './cakeEditorModel';
import { useStepFocus } from './useStepFocus';
import styles from './MeasuresCard.module.css';

type Props = {
  cake: Cake;
  edit: (change: (current: Cake) => Cake) => void;
  // The name's box, and whether Save found it empty (it is then highlighted and takes the focus).
  nameRef: Ref<HTMLInputElement>;
  nameInvalid: boolean;
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

// The cake's name and measures (the slices and the assembly minutes are in the cost card: they only change figures there). No category (his call, 21 Nov 2026): every cake's card sits in Food cost's «Cakes» group.
export function MeasuresCard({ cake, edit, nameRef, nameInvalid }: Props) {
  const { t } = useT();
  const ids = useId();
  const move = (measure: Parameters<typeof setMeasure>[1], value: number) => { edit(current => setMeasure(current, measure, value)); };

  const carries = maxTiersFor(cake.diameterCm);
  const smallest = tierDiameters(cake.diameterCm, cake.tiers + 1)[cake.tiers] ?? 0;
  const tiersBlocked = cake.tiers >= MAX_TIERS || carries <= cake.tiers;
  // Said only when it is the DIAMETER that stops another tier (not the three-tier ceiling).
  const tiersNote = cake.tiers < MAX_TIERS && carries <= cake.tiers
    ? t('cakes.measure.tiersLimit', { d: smallest, min: MIN_TIER_CM })
    : undefined;

  return (
    <section className={styles.card} aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className={styles.title}>{t('cakes.measures.title')}</h3>

      <div className={styles.field}>
        <label htmlFor={`${ids}-name`} className={styles.label}>{t('cakes.name')}</label>
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

      <Stepper
        title={t('cakes.measure.diameter')}
        sub={t('cakes.measure.diameterSub')}
        value={t('cakes.measure.cm', { n: cake.diameterCm })}
        lessLabel={t('cakes.measure.diameterLess')}
        moreLabel={t('cakes.measure.diameterMore')}
        lessDisabled={cake.diameterCm - DIAMETER_STEP_CM < minDiameterFor(cake.tiers)}
        moreDisabled={cake.diameterCm >= EDITOR_MAX_DIAMETER_CM}
        onLess={() => { move('diameterCm', cake.diameterCm - DIAMETER_STEP_CM); }}
        onMore={() => { move('diameterCm', cake.diameterCm + DIAMETER_STEP_CM); }}
      />
      <Stepper
        title={t('cakes.measure.tiers')}
        sub={t('cakes.measure.tiersSub')}
        value={String(cake.tiers)}
        lessLabel={t('cakes.measure.tiersLess')}
        moreLabel={t('cakes.measure.tiersMore')}
        lessDisabled={cake.tiers <= 1}
        moreDisabled={tiersBlocked}
        {...(tiersNote === undefined ? {} : { note: tiersNote })}
        onLess={() => { move('tiers', cake.tiers - 1); }}
        onMore={() => { move('tiers', cake.tiers + 1); }}
      />
      <Stepper
        title={t('cakes.measure.discs')}
        sub={t('cakes.measure.discsSub')}
        value={String(cake.discs)}
        lessLabel={t('cakes.measure.discsLess')}
        moreLabel={t('cakes.measure.discsMore')}
        lessDisabled={cake.discs <= MIN_DISCS}
        moreDisabled={cake.discs >= MAX_DISCS}
        onLess={() => { move('discs', cake.discs - 1); }}
        onMore={() => { move('discs', cake.discs + 1); }}
      />
    </section>
  );
}
