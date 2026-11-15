import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppBoundary } from './AppBoundary';

const failure = new Error('the app is broken');

function Broken(): never {
  throw failure;
}

describe('AppBoundary', () => {
  let logged: MockInstance;

  beforeEach(() => {
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it('renders its children when nothing fails', () => {
    render(<AppBoundary><p>all fine</p></AppBoundary>);
    expect(screen.getByText('all fine')).toBeInTheDocument();
  });

  it('shows the whole-app error screen instead of a blank page', () => {
    render(<AppBoundary><Broken /></AppBoundary>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mise stopped working.');
    expect(screen.getByRole('button', { name: 'Reload the app' })).toBeInTheDocument();
  });

  it('reports the error through onError', () => {
    const onError = vi.fn();
    render(<AppBoundary onError={onError}><Broken /></AppBoundary>);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(failure);
  });
});
