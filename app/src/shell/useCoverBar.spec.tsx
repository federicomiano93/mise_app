import { render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCoverBar } from './useCoverBar';
import { TitleSlotContext } from './titleSlot';

function Covering({ covered }: { covered: boolean }) {
  useCoverBar(covered);
  return null;
}

function mount(covered: boolean) {
  const header = document.createElement('header');
  const slot = document.createElement('div');
  header.appendChild(slot);
  document.body.appendChild(header);
  render(
    <TitleSlotContext.Provider value={slot}>
      <Covering covered={covered} />
    </TitleSlotContext.Provider>,
  );
  return header;
}

function width(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: wide && query.includes('700px'), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('useCoverBar', () => {
  it('makes the bar unreachable from 700px while the layer covers it', () => {
    width(true);
    const header = mount(true) as HTMLElement & { inert?: boolean };
    const unreachable = header.inert === true || header.getAttribute('aria-hidden') === 'true';
    expect(unreachable).toBe(true);
  });

  it('leaves the bar alone below 700px, where it is not shown', () => {
    width(false);
    const header = mount(true) as HTMLElement & { inert?: boolean };
    expect(header.inert === true).toBe(false);
    expect(header.hasAttribute('aria-hidden')).toBe(false);
  });

  it('leaves the bar alone when no layer covers it', () => {
    width(true);
    const header = mount(false) as HTMLElement & { inert?: boolean };
    expect(header.inert === true).toBe(false);
    expect(header.hasAttribute('aria-hidden')).toBe(false);
  });
});
