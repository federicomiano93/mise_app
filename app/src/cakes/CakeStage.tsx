import { Component, lazy, Suspense, useState } from 'react';
import type { ReactNode } from 'react';
import type { CakeGeometry } from '@mise/shared/cake-model';
import { useT } from '../i18n/useT';
import { useMediaQuery } from '../ui/useMediaQuery';
import type { Selected } from './cakeEditorModel';
import { CakeSection2D } from './CakeSection2D';
import type { StageLabels } from './CakeSection2D';
import { failureOf, stageDecision } from './cake3dModel';
import type { StageChoice, StageFailure } from './cake3dModel';
import styles from './CakeStage.module.css';

export type { StageLabels };

export type CakeStageProps = {
  geometry: CakeGeometry;
  // The part chosen in the parts list (null: none).
  selected: Selected | null;
  // The tier whose parts are named beside the drawing.
  tier: number;
  onSelect: (selected: Selected) => void;
  labels: StageLabels;
  // A second tap on the chosen part in the 3D view: the editor opens that part's «Add a card».
  onOpenPart?: (selected: Selected) => void;
};

// ⚠️ THREE.JS IS LOADED ONLY HERE, ON FIRST USE: this import() is the only door to Cake3D.tsx (and Cake3D.tsx is the only door to
// three), so a cake editor that never shows the 3D never downloads it (threeLoading.spec.ts, shell/worker.spec.ts).
const Cake3D = lazy(() => import('./Cake3D'));

// The choice is remembered for the session only (no storage key): a reload starts at the default again.
let remembered: StageChoice | null = null;
export function forgetStageChoice(): void { remembered = null; }

// Catches what the 3D view throws (no WebGL, the library did not load, a bug in the drawing) and tells the stage, which shows the flat
// drawing instead: a cake editor never loses its picture.
class Cake3DBoundary extends Component<{ onFail: (failure: StageFailure) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(error: unknown) { this.props.onFail(failureOf(error)); }
  override render() { return this.state.failed ? null : this.props.children; }
}

// The cake on the stage: a switch «3D | Simple drawing» and the chosen drawing, both made from the same geometry and words, so
// nothing in the editor depends on which one is showing. The flat drawing is the screen-reader and keyboard path in both cases.
export function CakeStage(props: CakeStageProps) {
  const { t } = useT();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [choice, setChoice] = useState<StageChoice | null>(remembered);
  const [failure, setFailure] = useState<StageFailure | null>(null);
  // Each try at the 3D is a new boundary, so choosing 3D again after a failure really tries again.
  const [attempt, setAttempt] = useState(0);
  const decision = stageDecision({ choice, reducedMotion, failure });
  const { onOpenPart, ...flat } = props;

  const choose = (next: StageChoice) => {
    remembered = next;
    setChoice(next);
    if (next === '3d' && failure !== null) {
      setFailure(null);
      setAttempt(count => count + 1);
    }
  };

  return (
    <div className={styles.stage}>
      <div role="radiogroup" aria-label={t('cakes.stage.views')} className={styles.switch}>
        {(['3d', '2d'] as const).map(option => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={decision.show === option}
            className={styles.option}
            onClick={() => { choose(option); }}
          >
            {t(option === '3d' ? 'cakes.stage.view3d' : 'cakes.stage.view2d')}
          </button>
        ))}
      </div>
      {decision.note ? <p className={styles.note} role="status">{t(`cakes.stage.note.${decision.note}`)}</p> : null}
      {decision.show === '3d' ? (
        <Cake3DBoundary key={attempt} onFail={setFailure}>
          <Suspense fallback={<div className={styles.loading} role="status">{t('cakes.stage.loading')}</div>}>
            <Cake3D {...props} />
          </Suspense>
        </Cake3DBoundary>
      ) : (
        <CakeSection2D {...flat} />
      )}
    </div>
  );
}
