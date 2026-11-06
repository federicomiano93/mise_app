// The words row of the head (OrdersHead.module.css): the places kept for «Send» and the swap are as tall as the buttons, so the row measures
// the same before and after the live data arrives (a line holding only placeholders is not 0px tall).

import { describe, expect, it } from 'vitest';
import css from './OrdersHead.module.css?raw';

function rule(selector: string): string {
  const start = css.indexOf(`\n${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf('}', start));
}

describe('the placeholders of the words row', () => {
  it.each(['.sendPlace', '.swapPlace'])('%s has the height of a button', selector => {
    expect(rule(selector)).toMatch(/min-height:\s*var\(--hit\)/);
  });
});
