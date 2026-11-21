import { Component, lazy, Suspense, useEffect, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import type { CakeGeometry } from '@mise/shared/cake-model';
import { useT } from '../i18n/useT';
import { useMediaQuery } from '../ui/useMediaQuery';
import type { Selected } from './cakeEditorModel';
import { CakeSection2D } from './CakeSection2D';
import type { StageLabels } from './CakeSection2D';
import type { Cake3DProps } from './Cake3D';
import { stageDecision } from './cake3dModel';
import type { StageChoice, StageFailure } from './cake3dModel';
import { RovingRadios } from './RovingRadios';
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
// threeParts.ts, which is the only file that imports three), so a cake editor that never shows the 3D never downloads it
// (threeLoading.spec.ts, shell/worker.spec.ts).
type Loaded = { default: ComponentType<Cake3DProps> };
let loadCake3D: () => Promise<Loaded> = () => import('./Cake3D');
// For specs only: a loader that fails, or null for the real one.
export function setCake3DLoader(loader: (() => Promise<Loaded>) | null): void {
  loadCake3D = loader ?? (() => import('./Cake3D'));
}

// What stands in for the 3D view when its file did not arrive (offline the first time): it says so instead of throwing, because a
// throw reaches the error log and this is no bug.
function LoadFailed({ onUnavailable }: Cake3DProps) {
  useEffect(() => { onUnavailable('load'); }, [onUnavailable]);
  return null;
}

// ⚠️ A FAILED import() IS REMEMBERED BY lazy() FOR THE LIFE OF THE PAGE, so each try at the 3D makes a new lazy component: choosing 3D
// again after a failure really asks for the file again.
const lazyCake3D = () => lazy(() => loadCake3D().catch((): Loaded => ({ default: LoadFailed })));

// The choice is remembered for the session only (no storage key): a reload starts at the default again.
let remembered: StageChoice | null = null;
export function forgetStageChoice(): void { remembered = null; }

// Catches what the 3D view throws that was NOT expected (a bug in the drawing) and tells the stage, which shows the flat drawing instead:
// a cake editor never loses its picture. The expected failures never get here (Cake3D reports them with onUnavailable).
class Cake3DBoundary extends Component<{ onFail: (failure: StageFailure) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { this.props.onFail('error'); }
  override render() { return this.state.failed ? null : this.props.children; }
}

// ⚠️ A LIVE REGION INSERTED ALREADY FILLED IS NOT ANNOUNCED RELIABLY (docs/architecture.md, «Traps already paid for»): it is drawn empty
// and its words come in an effect, after it is on the page.
function useSpoken(text: string): string {
  const [said, setSaid] = useState('');
  useEffect(() => { setSaid(text); }, [text]);
  return said;
}

function Loading() {
  const { t } = useT();
  const said = useSpoken(t('cakes.stage.loading'));
  return <div className={styles.loading} role="status">{said}</div>;
}

// The cake on the stage: a switch «3D | Simple drawing» and the chosen drawing, both made from the same geometry and words, so
// nothing in the editor depends on which one is showing. The flat drawing is the screen-reader and keyboard path in both cases.
export function CakeStage(props: CakeStageProps) {
  const { t } = useT();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [choice, setChoice] = useState<StageChoice | null>(remembered);
  const [failure, setFailure] = useState<StageFailure | null>(null);
  // Each try at the 3D is a new boundary and a new lazy import, so choosing 3D again after a failure really tries again.
  const [attempt, setAttempt] = useState(0);
  const [Cake3D, setCake3D] = useState(lazyCake3D);
  const decision = stageDecision({ choice, reducedMotion, failure });
  const said = useSpoken(decision.note ? t(`cakes.stage.note.${decision.note}`) : '');
  const { onOpenPart, ...flat } = props;

  const choose = (next: StageChoice) => {
    remembered = next;
    setChoice(next);
    if (next === '3d' && failure !== null) {
      setFailure(null);
      setAttempt(count => count + 1);
      setCake3D(lazyCake3D());
    }
  };

  return (
    <div className={styles.stage}>
      <RovingRadios
        label={t('cakes.stage.views')}
        className={styles.switch}
        optionClassName={styles.option}
        options={[{ value: '3d', text: t('cakes.stage.view3d') }, { value: '2d', text: t('cakes.stage.view2d') }]}
        value={decision.show}
        onChoose={choose}
      />
      <p className={styles.note} role="status">{said}</p>
      {decision.show === '3d' ? (
        <Cake3DBoundary key={attempt} onFail={setFailure}>
          <Suspense fallback={<Loading />}>
            <Cake3D {...props} onUnavailable={setFailure} />
          </Suspense>
        </Cake3DBoundary>
      ) : (
        <CakeSection2D {...flat} />
      )}
    </div>
  );
}
