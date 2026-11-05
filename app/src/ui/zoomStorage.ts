import { DEFAULT_ZOOM_STEP, clampStep, parseStep } from '@mise/shared/zoom-steps';

// The full-screen recipe's text size on THIS device, under the key the current app uses (same origin, so both
// apps remember the same size). The Calculator and the Recipe catalogue each have a key of their own, as in the
// current app: a baker may want the dough big and the recipe book small.
export const CALCULATOR_ZOOM_KEY = 'mise.calcZoomStep';
export const CATALOGUE_ZOOM_KEY = 'mise.catZoomStep';

// ⚠️ Anything that is not a single digit 0–5 reads as the default, never as an extreme; a storage that throws
// (blocked site data) reads as the default and forgets silently.
export function readZoomStep(key: string): number {
  try {
    return parseStep(window.localStorage.getItem(key));
  } catch {
    return DEFAULT_ZOOM_STEP;
  }
}

export function saveZoomStep(key: string, step: number): void {
  try {
    window.localStorage.setItem(key, String(clampStep(step)));
  } catch { /* the size just is not remembered */ }
}
