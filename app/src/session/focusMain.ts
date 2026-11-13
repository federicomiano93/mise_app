// Puts the keyboard focus back on the screen after a dialog or a form that had it went away with nothing of its own to
// return to (the invitation question asked when the app opened; the join form left from inside a venue): the screen's
// heading when it takes the focus (the shell's Page h1), else its first control. Never left on the page itself, where a
// keyboard user is lost and a screen reader says nothing.
export function focusMain(doc: Document = document): void {
  const main = doc.querySelector('main');
  if (!main) return;
  const target = main.querySelector<HTMLElement>('h1[tabindex]')
    ?? main.querySelector<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])');
  target?.focus();
}

// The same, for a screen that may not be drawn yet (the venue's language or a section still loading after a join): it looks
// again every `everyMs` until there is something to focus, for at most `forMs`, and gives up the moment the focus is
// somewhere other than the page itself (the person, or the screen, already put it somewhere).
export function focusMainSoon(doc: Document = document, everyMs = 100, forMs = 3000): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const until = Date.now() + forMs;
  const attempt = () => {
    const active = doc.activeElement;
    if (active && active !== doc.body) return;
    focusMain(doc);
    const now = doc.activeElement;
    if ((!now || now === doc.body) && Date.now() < until) timer = setTimeout(attempt, everyMs);
  };
  timer = setTimeout(attempt, 0);
  return () => { clearTimeout(timer); };
}
