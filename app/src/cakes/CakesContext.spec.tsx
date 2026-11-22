import { describe, expect, it } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import type { ReferenceGrams } from '@mise/shared/cake-model';
import { DataProvider } from '../data/DataContext';
import type { DataServices } from '../data/DataContext';
import { isBusy } from '../session/busy';
import { fakeCakesSource } from '../testing/fakeCakesSource';
import { renderWithSession } from '../testing/renderWithSession';
import { CakesProvider, useCakes, useCakesStore } from './CakesContext';

const REF: ReferenceGrams = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };

function Probe() {
  const { cakes, cakesLoaded, standard } = useCakes();
  const store = useCakesStore();
  return (
    <div>
      <p>{cakesLoaded ? `cakes: ${cakes.map(c => c.name).join(',')}` : 'loading'}</p>
      <p>{standard ? `base ${standard.rows.find(r => r.diameterCm === 22)?.baseG}` : 'no reference'}</p>
      <button type="button" onClick={() => store.saveStandard({ ...standard!, rows: standard!.rows.map(r => (r.diameterCm === 22 ? { ...r, baseG: 350 } : r)) })}>save</button>
    </div>
  );
}

function draw(source = fakeCakesSource({ cakes: [{ id: 'c1', name: 'Sacher' }], reference: { bakery: 'bakery', grams: REF, updatedAt: 'x' } })) {
  const services = { cakes: () => source } as unknown as DataServices;
  const view = renderWithSession(
    <DataProvider services={services}><CakesProvider><Probe /></CakesProvider></DataProvider>,
    { session: { locationId: 'bakery' } },
  );
  return { source, ...view };
}

describe('CakesProvider', () => {
  it('listens only while it is mounted, and hands the cakes and the reference to its children', async () => {
    const { source, unmount } = draw();
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(await screen.findByText('cakes: Sacher')).toBeInTheDocument();
    expect(screen.getByText('base 300')).toBeInTheDocument();
    expect(source.watchCakes).toHaveBeenCalledTimes(1);
    expect(source.watchReference).toHaveBeenCalledTimes(1);
    unmount();
    // Nothing is told to a stopped listener: pushing again changes nothing and throws nothing.
    expect(() => act(() => { source.push(); })).not.toThrow();
  });

  it('holds the session’s busy marker while the reference is on its way, and lets it go when answered', async () => {
    const { source, user } = draw();
    await screen.findByText('base 300');
    expect(isBusy()).toBe(false);
    await user.click(screen.getByRole('button', { name: 'save' }));
    expect(screen.getByText('base 350')).toBeInTheDocument();
    await waitFor(() => expect(source.saved).toHaveLength(1));
    await waitFor(() => expect(isBusy()).toBe(false));
  });

  it('outside the provider, the hooks say which provider is missing', () => {
    expect(() => renderWithSession(<Probe />)).toThrow(/CakesProvider/);
  });
});
