import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RovingRadios } from './RovingRadios';

const OPTIONS = [{ value: 'a', text: 'Alpha' }, { value: 'b', text: 'Beta' }, { value: 'c', text: 'Gamma' }] as const;

function Harness({ onChoose = () => {} }: { onChoose?: (value: string) => void }) {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a');
  return (
    <RovingRadios
      label="Letters"
      className="g"
      optionClassName="o"
      options={OPTIONS}
      value={value}
      onChoose={next => { setValue(next); onChoose(next); }}
    />
  );
}

const radio = (name: string) => screen.getByRole('radio', { name });

describe('RovingRadios', () => {
  it('has one tab stop: the chosen radio', () => {
    render(<Harness />);
    expect(radio('Alpha')).toHaveAttribute('tabindex', '0');
    expect(radio('Beta')).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radiogroup', { name: 'Letters' })).toBeInTheDocument();
  });

  it('moves and chooses with the arrows, wrapping at both ends, and the focus goes with the choice', async () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    const user = userEvent.setup();
    radio('Alpha').focus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Beta')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Beta')).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(radio('Gamma')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(radio('Alpha')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(radio('Gamma')).toHaveAttribute('aria-checked', 'true');
    await user.keyboard('{ArrowUp}');
    expect(radio('Beta')).toHaveFocus();
    expect(onChoose).toHaveBeenLastCalledWith('b');
  });

  it('goes to the first and the last with Home and End', async () => {
    render(<Harness />);
    const user = userEvent.setup();
    radio('Alpha').focus();
    await user.keyboard('{End}');
    expect(radio('Gamma')).toHaveAttribute('aria-checked', 'true');
    expect(radio('Gamma')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(radio('Alpha')).toHaveAttribute('aria-checked', 'true');
  });

  it('chooses on a click, and leaves other keys and modified arrows alone', async () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    const user = userEvent.setup();
    await user.click(radio('Gamma'));
    expect(onChoose).toHaveBeenCalledWith('c');
    onChoose.mockClear();
    await user.keyboard('x');
    await user.keyboard('{Alt>}{ArrowLeft}{/Alt}');
    expect(onChoose).not.toHaveBeenCalled();
  });
});
