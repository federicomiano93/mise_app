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
import type { StageFailure } from './cake3dModel';
import { useSpoken } from './useSpoken';
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

// ⚠️ A FAILED import() IS REMEMBERED BY lazy() FOR THE LIFE OF THE PAGE, so each editor makes its own lazy component: opening a cake
// again after a failure (offline the first time) really asks for the file again.
const lazyCake3D = () => lazy(() => loadCake3D().catch((): Loaded => ({ default: LoadFailed })));

// Catches what the 3D view throws that was NOT expected (a bug in the drawing) and tells the stage, which shows the flat drawing instead:
// a cake editor never loses its picture. The expected failures never get here (Cake3D reports them with onUnavailable).
class Cake3DBoundary extends Component<{ onFail: (failure: StageFailure) => void; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch() { this.props.onFail('error'); }
  override render() { return this.state.failed ? null : this.props.children; }
}

function Loading() {
  const { t } = useT();
  const said = useSpoken(t('cakes.stage.loading'));
  return <div className={styles.loading} role="status">{said}</div>;
}

// The cake on the stage: the 3D view, and the simple drawing ONLY where the 3D cannot run (no WebGL 2, the file did not arrive, the
// drawing stopped) or the device asks for less motion, with a note saying why. NO SWITCH between the two (his call, 21 Nov 2026): the
// person never has to choose. Both are made from the same geometry and words, and both are one named image with the same summary, the
// parts list beside them being the keyboard and screen-reader way to choose a part.
export function CakeStage(props: CakeStageProps) {
  const { t } = useT();
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [failure, setFailure] = useState<StageFailure | null>(null);
  const [Cake3D] = useState(lazyCake3D);
  const decision = stageDecision({ reducedMotion, failure });
  const said = useSpoken(decision.note ? t(`cakes.stage.note.${decision.note}`) : '');
  const { onOpenPart, ...flat } = props;

  return (
    <div className={styles.stage}>
      <p className={styles.note} role="status">{said}</p>
      {decision.show === '3d' ? (
        <Cake3DBoundary onFail={setFailure}>
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
