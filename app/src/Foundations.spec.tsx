import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Foundations } from './Foundations';

describe('Foundations', () => {
  it('has a main landmark and exactly one level-1 heading', () => {
    render(<Foundations />);
    expect(screen.getByRole('main')).toBeInTheDocument();
    const h1s = screen.getAllByRole('heading', { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent('Mise 2');
  });

  it('shows the three sections as level-2 headings', () => {
    render(<Foundations />);
    const h2s = screen.getAllByRole('heading', { level: 2 }).map(h => h.textContent);
    expect(h2s).toEqual(['Colours', 'Type', 'Touch']);
  });

  it('shows the six colour swatches with their tokens', () => {
    render(<Foundations />);
    const expected: Array<[string, string]> = [
      ['Accent', '--accent'],
      ['Allergen / danger', '--danger'],
      ['To check', '--warn'],
      ['Done', '--ok'],
      ['Rail', '--rail'],
      ['Ground', '--bg'],
    ];
    for (const [name, token] of expected) {
      expect(screen.getByText(name)).toBeInTheDocument();
      expect(screen.getByText(token)).toBeInTheDocument();
    }
  });

  it('counts taps: none, one time, then several times', async () => {
    const user = userEvent.setup();
    render(<Foundations />);
    const button = screen.getByRole('button', { name: 'Tap to test' });
    const counter = screen.getByText('Not tapped yet');

    await user.click(button);
    expect(counter).toHaveTextContent('Tapped 1 time');
    await user.click(button);
    expect(counter).toHaveTextContent('Tapped 2 times');
  });

  it('can be operated from the keyboard with Enter and Space', async () => {
    const user = userEvent.setup();
    render(<Foundations />);
    const button = screen.getByRole('button', { name: 'Tap to test' });
    const counter = screen.getByText('Not tapped yet');

    // A bounded walk through the tab order: a page that traps or hides the button fails
    // here instead of looping forever.
    for (let step = 0; step < 10 && document.activeElement !== button; step += 1) {
      await user.tab();
    }
    expect(button).toHaveFocus();

    await user.keyboard('{Enter}');
    expect(counter).toHaveTextContent('Tapped 1 time');
    await user.keyboard(' ');
    expect(counter).toHaveTextContent('Tapped 2 times');
  });

  it('announces the count politely to screen readers', () => {
    render(<Foundations />);
    expect(screen.getByText('Not tapped yet')).toHaveAttribute('aria-live', 'polite');
  });
});
