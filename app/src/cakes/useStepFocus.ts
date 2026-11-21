import { useLayoutEffect, useRef } from 'react';

// A «−» / «+» pair whose pressed button turns disabled at its limit: the browser would drop the focus to the page, and a keyboard or
// screen-reader user loses their place. The focus moves to the other button of the pair instead (it is enabled whenever the pressed one
// hit its limit). Only when the focus was still on the button that went dead, so a limit reached by another control steals nothing.
export function useStepFocus(lessDisabled: boolean, moreDisabled: boolean) {
  const less = useRef<HTMLButtonElement>(null);
  const more = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const active = document.activeElement;
    const lost = (node: HTMLButtonElement | null) => active === document.body || active === node;
    if (lessDisabled && !moreDisabled && lost(less.current)) more.current?.focus();
    else if (moreDisabled && !lessDisabled && lost(more.current)) less.current?.focus();
  }, [lessDisabled, moreDisabled]);

  return { less, more };
}
