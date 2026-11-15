// The page going out of sight (pageHidden.ts): the current app's «the page going out of sight sends what is waiting; going
// away for good does not» (tests/draft-journal.test.mjs), the listening half. The sending half is draftSync's sendWaiting
// (draftSync.journal.spec.ts).

import { describe, expect, it } from 'vitest';
import { watchPageHidden } from './pageHidden';
import type { PageEvents } from './pageHidden';

function events() {
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const win = new EventTarget();
  const hide = () => {
    doc.visibilityState = 'hidden';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  const show = () => {
    doc.visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  return { page: { doc, win } as unknown as PageEvents, win, hide, show };
}

describe('watchPageHidden', () => {
  it('runs when the page is hidden while alive, never when it comes back into sight', () => {
    const e = events();
    let runs = 0;
    watchPageHidden(() => { runs += 1; }, e.page);
    e.show();
    expect(runs).toBe(0);
    e.hide();
    expect(runs).toBe(1);
  });

  it('going away for good (pagehide first) does not run: the note answers for it', () => {
    const e = events();
    let runs = 0;
    watchPageHidden(() => { runs += 1; }, e.page);
    e.win.dispatchEvent(new Event('pagehide'));
    e.hide();
    expect(runs).toBe(0);
    // Back from the browser's page cache, alive after all: hiding it again runs.
    e.win.dispatchEvent(new Event('pageshow'));
    e.show();
    e.hide();
    expect(runs).toBe(1);
  });

  it('stops listening when unsubscribed', () => {
    const e = events();
    let runs = 0;
    const stop = watchPageHidden(() => { runs += 1; }, e.page);
    stop();
    e.hide();
    expect(runs).toBe(0);
  });
});
