import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { FormBar } from './FormBar';

describe('FormBar', () => {
  it('has a Back button named by the caller, the title as an h2, and the action', async () => {
    const onBack = vi.fn();
    render(
      <FormBar
        backLabel="Back"
        onBack={onBack}
        title="Edit Tuesday"
        action={<Button variant="primary">Save</Button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Edit Tuesday' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('draws Back off, and does nothing when pressed, while the caller says so', async () => {
    const onBack = vi.fn();
    render(<FormBar backLabel="Back" onBack={onBack} backDisabled title="Import" />);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('puts what the caller says under the title', () => {
    render(<FormBar backLabel="Back" onBack={() => undefined} title="Records" sub={<p>Last 15 days</p>} />);
    expect(screen.getByText('Last 15 days')).toBeInTheDocument();
  });

  it('gives the title an id and a ref, so a screen can be named by it and take the focus on it', () => {
    const ref = createRef<HTMLHeadingElement>();
    render(<FormBar backLabel="Back" onBack={() => undefined} title="Records" titleId="t" titleRef={ref} />);
    expect(ref.current).toBe(screen.getByRole('heading', { name: 'Records' }));
    expect(ref.current).toHaveAttribute('id', 't');
    ref.current?.focus();
    expect(ref.current).toHaveFocus();
  });

  it('turns the title into a door when asked: the h2 stays the focus target and keeps the visible name, the button says where it goes', async () => {
    const onTitle = vi.fn();
    const ref = createRef<HTMLHeadingElement>();
    render(<FormBar backLabel="Back" onBack={() => undefined} title="Alpine Mills" titleRef={ref} titleId="t" onTitle={onTitle} titleDoorLabel="Card of Alpine Mills in Records" />);
    const door = screen.getByRole('button', { name: 'Card of Alpine Mills in Records' });
    expect(ref.current).toContainElement(door);
    expect(screen.getByRole('heading', { level: 2, name: 'Alpine Mills' })).toBe(ref.current);
    // The label holds the visible name (label in name), and the screen's name stays the visible one.
    expect(door.getAttribute('aria-label')).toContain('Alpine Mills');
    expect(document.getElementById('t')).toHaveTextContent('Alpine Mills');
    await userEvent.setup().click(door);
    expect(onTitle).toHaveBeenCalledTimes(1);
  });

  it('draws a plain title with no button when no door is given', () => {
    render(<FormBar backLabel="Back" onBack={() => undefined} title="Records" titleDoorLabel="unused" />);
    expect(screen.queryByRole('button', { name: 'Records' })).not.toBeInTheDocument();
  });

  it('is a header with no action when there is none', () => {
    render(<FormBar backLabel="Back" onBack={() => undefined} title="Records" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
