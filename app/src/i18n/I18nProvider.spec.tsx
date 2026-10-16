import { useContext } from 'react';
import { describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { en } from './en';
import { it as italian } from './it';
import { I18nContext } from './I18nContext';
import { I18nProvider } from './I18nProvider';
import { useT } from './useT';

function Probe() {
  const { t, lang, locale } = useT();
  const { setLanguage } = useContext(I18nContext);
  return (
    <div>
      <p data-testid="text">{t('section.orders')}</p>
      <p data-testid="title">{t('page.title', { title: 'Orders' })}</p>
      <p data-testid="lang">{`${lang} ${locale}`}</p>
      <button type="button" onClick={() => void setLanguage('it')}>to Italian</button>
      <button type="button" onClick={() => void setLanguage('en')}>to English</button>
    </div>
  );
}

describe('I18nProvider and useT', () => {
  it('works with no provider at all: English', () => {
    render(<Probe />);
    expect(screen.getByTestId('text')).toHaveTextContent('Orders');
    expect(screen.getByTestId('lang')).toHaveTextContent('en en-GB');
  });

  it('translates with the language it starts in and sets <html lang>', () => {
    render(
      <I18nProvider initialLanguage="it" initialMessages={italian}>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('text')).toHaveTextContent('Ordini');
    expect(screen.getByTestId('title')).toHaveTextContent('Orders · Mise');
    expect(screen.getByTestId('lang')).toHaveTextContent('it it-IT');
    expect(document.documentElement.lang).toBe('it');
  });

  it('swaps the language and <html lang> when setLanguage resolves', async () => {
    render(
      <I18nProvider initialLanguage="en" initialMessages={en}>
        <Probe />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('en');

    await act(async () => {
      screen.getByRole('button', { name: 'to Italian' }).click();
    });
    expect(screen.getByTestId('text')).toHaveTextContent('Ordini');
    expect(document.documentElement.lang).toBe('it');

    await act(async () => {
      screen.getByRole('button', { name: 'to English' }).click();
    });
    expect(screen.getByTestId('text')).toHaveTextContent('Orders');
    expect(document.documentElement.lang).toBe('en');
  });
});
