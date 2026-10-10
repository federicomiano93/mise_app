import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { it as italian } from '../i18n/it';
import { I18nProvider } from '../i18n/I18nProvider';
import { PartBoundary } from './PartBoundary';

// The child throws while `broken` is true. A flag, not a prop, so a test can "fix" the part
// without re-rendering the boundary — which is what pressing Reload has to cope with.
let broken = true;
const failure = new Error('this part is broken');

function Flaky() {
  if (broken) throw failure;
  return <p>the part works</p>;
}

describe('PartBoundary', () => {
  let logged: MockInstance;

  beforeEach(() => {
    broken = true;
    // React logs every caught render error; they are expected here and would bury real output.
    logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logged.mockRestore();
  });

  it('renders its children when nothing fails', () => {
    broken = false;
    render(<PartBoundary><Flaky /></PartBoundary>);
    expect(screen.getByText('the part works')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the fallback, in words and with a Reload button, when a child throws', () => {
    render(<PartBoundary><Flaky /></PartBoundary>);
    const fallback = screen.getByRole('status');
    expect(fallback).toHaveTextContent('This part didn’t load.');
    expect(fallback).toHaveTextContent('The rest of the screen works.');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.queryByText('the part works')).not.toBeInTheDocument();
  });

  it('reports the thrown error once through onError', () => {
    const onError = vi.fn();
    render(<PartBoundary onError={onError}><Flaky /></PartBoundary>);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toBe(failure);
    expect(onError.mock.calls[0]?.[1]).toHaveProperty('componentStack');
  });

  it('draws the children again when Reload is pressed', async () => {
    const user = userEvent.setup();
    render(<PartBoundary><Flaky /></PartBoundary>);

    broken = false;
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    expect(screen.getByText('the part works')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows the fallback again when Reload is pressed and the part still fails', async () => {
    const user = userEvent.setup();
    render(<PartBoundary><Flaky /></PartBoundary>);

    await user.click(screen.getByRole('button', { name: 'Reload' }));

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('recovers when resetKey changes', () => {
    const { rerender } = render(<PartBoundary resetKey="boom"><Flaky /></PartBoundary>);
    expect(screen.getByRole('status')).toBeInTheDocument();

    broken = false;
    rerender(<PartBoundary resetKey="orders"><Flaky /></PartBoundary>);

    expect(screen.getByText('the part works')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps the fallback while resetKey stays the same', () => {
    const { rerender } = render(<PartBoundary resetKey="boom"><Flaky /></PartBoundary>);
    broken = false;
    rerender(<PartBoundary resetKey="boom"><Flaky /></PartBoundary>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('treats a thrown undefined as a failure too', () => {
    function ThrowsNothing(): never {
      throw undefined;
    }
    render(<PartBoundary><ThrowsNothing /></PartBoundary>);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('draws no heading of its own without a title: it is a part of a screen', () => {
    render(<PartBoundary><Flaky /></PartBoundary>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('keeps the screen named when it has a title: one h1 and the tab title', () => {
    render(
      <MemoryRouter>
        <PartBoundary title="Recipes"><Flaky /></PartBoundary>
      </MemoryRouter>,
    );
    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent('Recipes');
    expect(document.title).toBe('Recipes · Mise');
    expect(screen.getByRole('status')).toHaveTextContent('This part didn’t load.');
  });

  describe('focus', () => {
    function Screen() {
      if (broken) throw failure;
      return <h1 tabIndex={-1}>the screen</h1>;
    }

    it('goes to the first heading of the restored children after Reload', async () => {
      const user = userEvent.setup();
      render(<PartBoundary><Screen /></PartBoundary>);
      expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();

      broken = false;
      await user.click(screen.getByRole('button', { name: 'Reload' }));

      expect(screen.getByRole('heading', { name: 'the screen' })).toHaveFocus();
    });

    it('makes a heading focusable when it carries no tabindex', async () => {
      const user = userEvent.setup();
      function PlainScreen() {
        if (broken) throw failure;
        return <h1>a plain heading</h1>;
      }
      render(<PartBoundary><PlainScreen /></PartBoundary>);

      broken = false;
      await user.click(screen.getByRole('button', { name: 'Reload' }));

      expect(screen.getByRole('heading', { name: 'a plain heading' })).toHaveFocus();
    });

    it('goes to the container when the restored children have no heading', async () => {
      const user = userEvent.setup();
      render(<PartBoundary><Flaky /></PartBoundary>);

      broken = false;
      await user.click(screen.getByRole('button', { name: 'Reload' }));

      const container = screen.getByText('the part works').parentElement;
      expect(container).toHaveAttribute('tabindex', '-1');
      expect(container).toHaveFocus();
    });

    it('stays on the Reload button when the part fails again', async () => {
      const user = userEvent.setup();
      render(<PartBoundary><Flaky /></PartBoundary>);

      await user.click(screen.getByRole('button', { name: 'Reload' }));

      expect(screen.getByRole('button', { name: 'Reload' })).toHaveFocus();
    });

    it('is left alone when resetKey clears the failure: that is a navigation, Page moves it', () => {
      const { rerender } = render(<PartBoundary resetKey="boom"><Screen /></PartBoundary>);
      broken = false;
      rerender(<PartBoundary resetKey="orders"><Screen /></PartBoundary>);

      expect(screen.getByRole('heading', { name: 'the screen' })).not.toHaveFocus();
      expect(document.body).toHaveFocus();
    });
  });

  it('speaks the language of the provider', () => {
    render(
      <I18nProvider initialLanguage="it" initialMessages={italian}>
        <PartBoundary><Flaky /></PartBoundary>
      </I18nProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Questa parte non si è caricata.');
    expect(screen.getByRole('button', { name: 'Ricarica' })).toBeInTheDocument();
  });
});
