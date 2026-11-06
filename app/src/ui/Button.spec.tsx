import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';

describe('Button', () => {
  it('is a button and presses', async () => {
    const onPress = vi.fn();
    render(<Button onPress={onPress}>Save</Button>);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('gives each variant its own look, and the base look to all but bare', () => {
    render(
      <>
        <Button variant="primary">primary</Button>
        <Button variant="secondary">secondary</Button>
        <Button variant="quiet">quiet</Button>
        <Button variant="danger">danger</Button>
        <Button variant="bare" className="mine">bare</Button>
      </>,
    );
    const classOf = (name: string) => screen.getByRole('button', { name }).className.split(' ');
    for (const name of ['primary', 'secondary', 'quiet', 'danger']) {
      expect(classOf(name), name).toHaveLength(2);
    }
    expect(new Set(['primary', 'secondary', 'quiet', 'danger'].map(name => classOf(name)[1])).size).toBe(4);
    // A bare button carries the caller's class and nothing of the base: two classes from two
    // modules weigh the same, so the base would fight the caller's.
    expect(classOf('bare')).toEqual(['mine']);
  });

  it('adds the caller\'s class after its own', () => {
    render(<Button className="extra">x</Button>);
    expect(screen.getByRole('button', { name: 'x' }).className.endsWith(' extra')).toBe(true);
  });

  it('adds the block class on request', () => {
    render(<><Button>plain</Button><Button block>wide</Button></>);
    expect(screen.getByRole('button', { name: 'wide' }).className.split(' '))
      .toHaveLength(screen.getByRole('button', { name: 'plain' }).className.split(' ').length + 1);
  });

  // The pending state keeps the focus on the button (a disabled one would drop it) and refuses
  // the press.
  it('ignores a press while pending, and says so', async () => {
    const onPress = vi.fn();
    render(<Button isPending onPress={onPress}>Wait</Button>);
    const button = screen.getByRole('button', { name: 'Wait' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    await userEvent.setup().click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('is disabled when asked to be', () => {
    render(<Button isDisabled>Off</Button>);
    expect(screen.getByRole('button', { name: 'Off' })).toBeDisabled();
  });
});
