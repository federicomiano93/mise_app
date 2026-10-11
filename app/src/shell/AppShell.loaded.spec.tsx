import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderApp } from '../testing/renderApp';
import { browserUsageDeps } from '../telemetry/usage';

// ⚠️ ITS OWN FILE ON PURPOSE. markLoaded() keeps the page's load time in a variable of the
// usage module, set once for the life of the page; a spec file gets a fresh module, so here the
// shell is the first and only one to set it. Beside other specs that draw the shell the first
// of them would set it and this one would prove nothing.
describe('AppShell: the load time', () => {
  it('marks the page loaded when the shell is first drawn, and only then', async () => {
    const deps = browserUsageDeps(async () => undefined);
    expect(deps.navigationMs()).toBeNull();

    const { user } = renderApp('/orders');
    const loaded = deps.navigationMs();
    expect(loaded).not.toBeNull();

    // Moving to another section is not another load: the time stays the first one.
    await user.click(screen.getAllByRole('link', { name: 'Recipes' })[0] as HTMLElement);
    await screen.findByRole('heading', { level: 1, name: 'Recipes' });
    expect(deps.navigationMs()).toBe(loaded);
  });
});
