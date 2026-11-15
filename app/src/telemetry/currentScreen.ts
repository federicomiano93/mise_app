// currentScreen.ts — the name of the screen the person is on, as an error report should say it.
//
// The shell and the gate announce every screen they show with announceScreen() (usage.ts), a
// `mise:screen` event on the window. The usage tracker counts those; this file listens to the
// SAME event and keeps the last one, so the screen an error report names is exactly the screen
// the usage record counted — `m2:recipes`, never a name the two could disagree on.
//
// «m2» alone is the app before any screen has been announced (the first moments of a boot).

import { SCREEN_RE } from '@mise/shared/usage-model';
import { MISE2_PAGE, SCREEN_EVENT } from './usage';

let current: string = MISE2_PAGE;

// The name the error report puts on its line (ReporterDeps.screen).
export function currentScreen(): string {
  return current;
}

// Starts following the announcements. Returns a function that stops it and forgets the screen
// (the specs use it; the app never needs to).
//
// A name the usage record would refuse (see SCREEN_RE) is not kept either: the two must agree.
export function trackScreens(target: EventTarget = window): () => void {
  const onScreen = (event: Event): void => {
    const detail = (event as CustomEvent).detail as unknown;
    if (typeof detail !== 'string') return;
    // '' = the app's own front, as in the usage tracker's view().
    const name = detail === '' ? MISE2_PAGE : `${MISE2_PAGE}:${detail}`;
    if (SCREEN_RE.test(name)) current = name;
  };
  target.addEventListener(SCREEN_EVENT, onScreen);
  return () => {
    target.removeEventListener(SCREEN_EVENT, onScreen);
    current = MISE2_PAGE;
  };
}
