import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HelpHead, HelpToggle } from './HelpToggle';
import css from './HelpToggle.module.css?raw';

// The «?» of a section (Federico, 11 Nov 2026): a bare 44px button next to the title that opens the section's explanation under
// the heading. Closed at mount, nothing stored.

const draw = () => render(
  <section aria-labelledby="t">
    <HelpHead title="Price" help="The price on the label." titleId="t" />
  </section>,
);
const button = () => screen.getByRole('button', { name: 'Explanation: Price' });
const text = () => screen.getByText('The price on the label.');

describe('HelpHead', () => {
  it('draws the title as a level-3 heading that names the section, with the «?» right of it', () => {
    draw();
    expect(screen.getByRole('heading', { level: 3, name: 'Price' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Price' })).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.compareDocumentPosition(button()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('is closed at mount: aria-expanded false, the text hidden, and the button names what it opens', () => {
    draw();
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    expect(button().getAttribute('aria-controls')).toBe(text().id);
    expect(text()).not.toBeVisible();
    // The icon is decoration: the name is the label's.
    expect(button().querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('opens on a tap, and the same tap closes it', async () => {
    const user = userEvent.setup();
    draw();
    await user.click(button());
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    expect(text()).toBeVisible();
    await user.click(button());
    expect(button()).toHaveAttribute('aria-expanded', 'false');
    expect(text()).not.toBeVisible();
  });

  it('opens and closes from the keyboard: Enter, then Space', async () => {
    const user = userEvent.setup();
    draw();
    await user.tab();
    expect(button()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(button()).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard(' ');
    expect(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('starts closed again when it is drawn afresh: the state is not stored', async () => {
    const user = userEvent.setup();
    const first = draw();
    await user.click(button());
    first.unmount();
    draw();
    expect(button()).toHaveAttribute('aria-expanded', 'false');
  });

  it('gives two sections two different ids', () => {
    render(
      <>
        <HelpHead title="Price" help="One." titleId="a" />
        <HelpHead title="Work" help="Two." titleId="b" />
      </>,
    );
    const ids = screen.getAllByRole('button').map(one => one.getAttribute('aria-controls'));
    expect(new Set(ids).size).toBe(2);
  });
});

describe('HelpToggle', () => {
  it('is a controlled button: it says whether it is open and calls back when pressed', async () => {
    const user = userEvent.setup();
    let pressed = 0;
    render(<HelpToggle title="Work" open controls="x" onToggle={() => { pressed += 1; }} />);
    const toggle = screen.getByRole('button', { name: 'Explanation: Work' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'x');
    await user.click(toggle);
    expect(pressed).toBe(1);
  });
});

describe('the look of the «?»', () => {
  const rule = (selector: string): string => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(match => (match[1] ?? '').split(',').map(part => part.trim()).includes(selector))
      .map(match => match[2] ?? '')
      .join(';');
  };

  it('is 44 by 44, clears the browser frame and fill, and wears the quiet ink', () => {
    const body = rule('.toggle');
    expect(body).toMatch(/width:\s*44px/);
    expect(body).toMatch(/height:\s*44px/);
    expect(body).toMatch(/border:\s*0/);
    expect(body).toMatch(/background:\s*none/);
    expect(body).toContain('color: var(--ink-3)');
  });

  it('turns to the accent tint and ink while open', () => {
    const body = rule('.toggle[aria-expanded="true"]');
    expect(body).toContain('background: var(--accent-tint)');
    expect(body).toContain('color: var(--accent-ink)');
  });

  it('draws a 22px icon and a 1.5 line height explanation in the muted ink', () => {
    expect(rule('.icon')).toMatch(/width:\s*22px/);
    const text = rule('.text');
    expect(text).toContain('color: var(--ink-2)');
    expect(text).toContain('font-size: var(--fs-sm)');
    expect(text).toContain('line-height: 1.5');
  });
});
