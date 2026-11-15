import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { en } from '../i18n/en';
import { I18nProvider } from '../i18n/I18nProvider';
import { Page } from './Page';

function draw(ui: ReactNode) {
  return render(
    <I18nProvider initialLanguage="en" initialMessages={en}>
      <MemoryRouter>{ui}</MemoryRouter>
    </I18nProvider>,
  );
}

describe('Page', () => {
  it('draws only the title in its head when it has no action', () => {
    draw(<Page title="Orders"><p>Body</p></Page>);
    const head = screen.getByRole('heading', { level: 1, name: 'Orders' }).parentElement as HTMLElement;
    expect(head.tagName).toBe('HEADER');
    expect(head.children).toHaveLength(1);
  });

  it('draws the action in the head, after the title', () => {
    draw(<Page title="Orders" action={<button type="button">Act</button>}><p>Body</p></Page>);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Orders' });
    const act = screen.getByRole('button', { name: 'Act' });
    expect((h1.parentElement as HTMLElement).contains(act)).toBe(true);
    expect(h1.compareDocumentPosition(act) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
