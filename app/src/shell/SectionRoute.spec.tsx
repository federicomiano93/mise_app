import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';

// A built section is its own chunk and is fetched only when somebody opens it — and only behind the
// visibility gate. The section itself is replaced here by a stand-in that counts how often it was
// asked for and waits at a gate, so «not loaded» and «still loading» can both be seen.
//
// ⚠️ The specs run in this order on purpose: a module that has been imported stays imported, so
// «never loaded» has to be asserted before the first spec that loads it.
const control = vi.hoisted(() => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => { release = resolve; });
  return { imports: 0, gate, release: () => { release(); } };
});

vi.mock('../pastries/PastriesSection', async () => {
  control.imports += 1;
  await control.gate;
  const { createElement } = await import('react');
  return { default: () => createElement('p', null, 'The real Pastries') };
});

const main = () => within(screen.getByRole('main'));

describe('a built section', () => {
  it('is not fetched for a venue that did not buy it: «not available», and its code never loads', async () => {
    renderApp('/pastries', { session: { location: { sections: { pastries: false } } } });

    expect(main().getByRole('heading', { level: 1, name: 'Pastries' })).toBeInTheDocument();
    expect(main().getByText('This section is not on for you at this venue.')).toBeInTheDocument();
    // Give a wrongly started fetch every chance to show itself.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(control.imports).toBe(0);
    expect(main().queryByText('The real Pastries')).not.toBeInTheDocument();
    expect(main().queryByText('Loading…')).not.toBeInTheDocument();
  });

  // Every section in the list is built now (Orders was the last, step 3f-1), so the other screen opened is Settings.
  it('is not fetched by the other screens either', async () => {
    renderApp('/settings');
    expect(main().getByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(control.imports).toBe(0);
  });

  it('is fetched when it is opened, showing its title and a quiet line meanwhile', async () => {
    renderApp('/pastries');

    expect(await main().findByText('Loading…')).toBeInTheDocument();
    expect(main().getByRole('heading', { level: 1, name: 'Pastries' })).toBeInTheDocument();
    // Not a live region: a status read out for the fraction of a second a fetch takes is noise.
    expect(main().getByText('Loading…').closest('[role="status"]')).toBeNull();
    expect(control.imports).toBe(1);
    expect(document.title).toBe('Pastries · Mise');

    control.release();

    expect(await main().findByText('The real Pastries')).toBeInTheDocument();
    expect(main().queryByText('Loading…')).not.toBeInTheDocument();
  });

  it('keeps the navigation around it while it loads', async () => {
    renderApp('/pastries');
    expect(await main().findByText('The real Pastries')).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'All sections' })).toBeInTheDocument();
    // Opened again, the module is already there.
    expect(control.imports).toBe(1);
  });
});
