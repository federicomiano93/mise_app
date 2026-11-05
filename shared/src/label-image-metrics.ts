// label-image-metrics.ts — the image label's font metrics, as the table the golden harness wrote
// (fixtures/label-image-metrics.json; how and why: label-image-fonts.ts). A module of its own so the app can fetch it
// only when the image label is opened (a dynamic import), never with the first screen.

import metricsText from './fixtures/label-image-metrics.json?raw';
import { loadMetrics } from './label-image-fonts';
import type { LabelMetrics, StoredLabelMetrics } from './label-image-fonts';

let loaded: LabelMetrics | null = null;

export function labelMetrics(): LabelMetrics {
  loaded ??= loadMetrics(JSON.parse(metricsText) as StoredLabelMetrics);
  return loaded;
}
