import { useEffect, useState } from 'react';
import type { LabelMetrics } from '@mise/shared/label-image-fonts';

// The width table of the label faces. It is large (every character at every size), so it is fetched when an image label
// screen first needs it and is in no other screen's bundle. Shared by the «with logo» product label and the HACCP label:
// both measure with the same table, which is what lets one engine draw both.
export function useLabelMetrics(): LabelMetrics | 'failed' | null {
  const [metrics, setMetrics] = useState<LabelMetrics | 'failed' | null>(null);
  useEffect(() => {
    let alive = true;
    import('@mise/shared/label-image-metrics').then(
      module => { if (alive) setMetrics(module.labelMetrics()); },
      () => { if (alive) setMetrics('failed'); },
    );
    return () => { alive = false; };
  }, []);
  return metrics;
}
