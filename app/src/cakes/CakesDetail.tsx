import { CakeEditor } from './CakeEditor';
import type { CakesView } from './cakesPath';
import { ReferenceScreen } from './ReferenceScreen';

// The whole screen when a cake, a new cake or the settings is open. With the list on screen it draws nothing (Cakes is one level at a
// time at every width).
export function CakesDetail({ view }: { view: CakesView }) {
  switch (view.kind) {
    case 'list':
      return null;
    case 'new':
      return <CakeEditor id={null} />;
    case 'cake':
      return <CakeEditor id={view.id} />;
    case 'reference':
      return <ReferenceScreen />;
  }
}
