import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake, CakePart } from '@mise/shared/cake-model';
import { CakeStage, setCake3DLoader } from './CakeStage';
import type { CakeStageProps, StageLabels } from './CakeStage';

// The stage and its fallbacks (there is no switch between the two drawings: the person never chooses). The 3D view itself needs WebGL, which jsdom has not: Cake3D is replaced by a stand-in that draws a
// marker, or throws what the real one throws, so what is pinned here is what the stage shows (3D by default) and what it does when the 3D cannot be drawn. The real drawing is driven in a browser (drive-mise2-cakes.mjs).

const behaviour = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'webgl' | 'bug' }));

type Pick = { tier: number; part: string };
vi.mock('./Cake3D', () => ({
  default: (props: { onSelect: (s: Pick) => void; onOpenPart?: (s: Pick) => void; onUnavailable: (reason: 'webgl' | 'load' | 'error') => void }) => {
    // The real view says why it cannot draw (in an effect, as the real one does), and only a real bug throws.
    useEffect(() => {
      if (behaviour.mode === 'webgl') props.onUnavailable('webgl');
    }, [props]);
    if (behaviour.mode === 'bug') throw new Error('a bug in the drawing');
    if (behaviour.mode === 'webgl') return null;
    return (
      <div data-testid="three-d">
        <button type="button" onClick={() => { props.onSelect({ tier: 0, part: 'base' }); }}>pick</button>
        <button type="button" onClick={() => { props.onOpenPart?.({ tier: 0, part: 'base' }); }}>open</button>
      </div>
    );
  },
}));

const CAKE: Cake = {
  id: 'c1', name: 'Plain', diameterCm: 22, tiers: 1, discs: 2, slices: 12,
  lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 500 }],
  packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, discHeightCm: null, ref: null, model: 1,
};
const LABELS: StageLabels = {
  summary: 'Section drawing of the cake: 1 tier.',
  part: { decoration: 'Decoration', coating: 'Coating', filling: 'Filling', soak: 'Soak', base: 'Base' } as Record<CakePart, string>,
  cardName: () => 'Sponge',
  grams: g => `${String(g)} g`,
  diameter: d => `Ø ${String(d)}`,
};

const stage = (extra: Partial<CakeStageProps> = {}) => (
  <CakeStage geometry={cakeGeometry(CAKE)} selected={null} tier={0} onSelect={vi.fn()} labels={LABELS} {...extra} />
);

const motion = (reduce: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
};

const DRAWING = { name: 'Section drawing of the cake: 1 tier.' };

let logged: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  setCake3DLoader(null);
  behaviour.mode = 'ok';
  window.localStorage.clear();
  window.sessionStorage.clear();
  logged = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia'); logged.mockRestore(); });

describe('the stage', () => {
  it('shows the 3D, and offers no switch to the simple drawing: the person never chooses', async () => {
    render(stage());
    expect(await screen.findByTestId('three-d')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', DRAWING)).not.toBeInTheDocument();
    // The note's live region is on the page from the start, and empty.
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    // Nothing is kept on the device.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('hands the 3D view the very same props, and the second tap reaches onOpenPart', async () => {
    const onSelect = vi.fn();
    const onOpenPart = vi.fn();
    render(stage({ onSelect, onOpenPart }));
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'pick' }));
    expect(onSelect).toHaveBeenCalledWith({ tier: 0, part: 'base' });
    await user.click(screen.getByRole('button', { name: 'open' }));
    expect(onOpenPart).toHaveBeenCalledWith({ tier: 0, part: 'base' });
  });
});

describe('when the 3D cannot be drawn', () => {
  it('falls back to the simple drawing with a note when the device has no WebGL, with no way to ask for 3D', async () => {
    behaviour.mode = 'webgl';
    render(stage());
    expect(await screen.findByRole('img', DRAWING)).toBeInTheDocument();
    expect(await screen.findByText('This device cannot draw the 3D view, so the simple drawing is shown.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    // An expected fallback is no error: nothing reaches React's error logging (and so the owner's error log).
    expect(logged).not.toHaveBeenCalled();
  });

  it('falls back with its own note when the file did not load (a REJECTED import), logs no error, and the next editor really asks again', async () => {
    const loads = vi.fn(() => Promise.reject(new Error('Failed to fetch dynamically imported module')));
    setCake3DLoader(loads);
    const first = render(stage());
    expect(await screen.findByRole('img', DRAWING)).toBeInTheDocument();
    expect(await screen.findByText('The 3D view could not be loaded (is there a connection?), so the simple drawing is shown.')).toBeInTheDocument();
    expect(logged).not.toHaveBeenCalled();
    expect(loads).toHaveBeenCalledTimes(1);
    // Back online: another editor makes a new import, not the failed one remembered.
    first.unmount();
    setCake3DLoader(() => import('./Cake3D'));
    render(stage());
    expect(await screen.findByTestId('three-d')).toBeInTheDocument();
    expect(loads).toHaveBeenCalledTimes(1);
    await waitFor(() => { expect(screen.getByRole('status')).toBeEmptyDOMElement(); });
  });

  it('a real bug in the drawing shows the simple drawing with a neutral note (not the connection one), and is logged', async () => {
    behaviour.mode = 'bug';
    render(stage());
    expect(await screen.findByRole('img', DRAWING)).toBeInTheDocument();
    expect(await screen.findByText('The 3D view stopped working, so the simple drawing is shown.')).toBeInTheDocument();
    expect(screen.queryByText(/connection/)).not.toBeInTheDocument();
    expect(logged).toHaveBeenCalled();
  });

  it('shows the simple drawing, with a note, when the device asks for less motion: no 3D at all and no switch', async () => {
    motion(true);
    render(stage());
    expect(screen.getByRole('img', DRAWING)).toBeInTheDocument();
    expect(await screen.findByText('This device asks for less motion, so the simple drawing is shown.')).toHaveAttribute('role', 'status');
    expect(screen.queryByTestId('three-d')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });
});
