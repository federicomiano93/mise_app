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

  it('is a header with no action when there is none', () => {
    render(<FormBar backLabel="Back" onBack={() => undefined} title="Records" />);
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });
});
