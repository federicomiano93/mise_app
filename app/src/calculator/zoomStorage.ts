import { DEFAULT_ZOOM_STEP, clampStep, parseStep } from '@mise/shared/zoom-steps';

// The full-screen recipe's text size on THIS device, under the key the current app uses (same origin, so both
// apps remember the same size). ⚠️ Anything that is not a single digit 0–5 reads as the default, never as an
// extreme; a storage that throws (blocked site data) reads as the default and forgets silently.
export const ZOOM_STORAGE_KEY = 'mise.calcZoomStep';

export function readZoomStep(): number {
  try {
    return parseStep(window.localStorage.getItem(ZOOM_STORAGE_KEY));
  } catch {
    return DEFAULT_ZOOM_STEP;
  }
}

export function saveZoomStep(step: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clampStep(step)));
  } catch { /* the size just is not remembered */ }
}
