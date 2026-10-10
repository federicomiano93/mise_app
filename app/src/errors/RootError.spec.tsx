import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { it as italian } from '../i18n/it';
import { I18nProvider } from '../i18n/I18nProvider';
import { RootError } from './RootError';

describe('RootError', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows its message in English with no provider above it', () => {
    render(<RootError />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mise stopped working.');
    expect(screen.getByText('Reloading usually fixes it. Nothing you saved is lost.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload the app' })).toBeInTheDocument();
  });

  it('is a landmark of its own', () => {
    render(<RootError />);
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('reloads the page when the button is pressed', async () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    const user = userEvent.setup();
    render(<RootError />);

    await user.click(screen.getByRole('button', { name: 'Reload the app' }));

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('speaks Italian under an Italian provider', () => {
    render(
      <I18nProvider initialLanguage="it" initialMessages={italian}>
        <RootError />
      </I18nProvider>,
    );
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mise si è fermata.');
    expect(screen.getByRole('button', { name: "Ricarica l'app" })).toBeInTheDocument();
  });
});
