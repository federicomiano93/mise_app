import type { CakeGeometry } from '@mise/shared/cake-model';
import type { Selected } from './cakeEditorModel';
import { CakeSection2D } from './CakeSection2D';
import type { StageLabels } from './CakeSection2D';

export type { StageLabels };

export type CakeStageProps = {
  geometry: CakeGeometry;
  // The part chosen in the parts list (null: none).
  selected: Selected | null;
  // The tier whose parts are named beside the drawing.
  tier: number;
  onSelect: (selected: Selected) => void;
  labels: StageLabels;
};

// ⚠️ THE SEAM FOR THE 3D VIEW (a later PR): the editor draws THIS, with a geometry (cakeGeometry), a selection and the words. Today it
// draws the flat section; the 3D view will be a lazy component taking the very same props, chosen here beside a «3D / Simple drawing»
// switch, so nothing in the editor changes when it arrives.
export function CakeStage(props: CakeStageProps) {
  return <CakeSection2D {...props} />;
}
