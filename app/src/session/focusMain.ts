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
