import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake, CakePart } from '@mise/shared/cake-model';
import { CakeStage, forgetStageChoice } from './CakeStage';
import type { CakeStageProps, StageLabels } from './CakeStage';

// The stage's switch and its fallbacks. The 3D view itself needs WebGL, which jsdom has not: Cake3D is replaced by a stand-in that draws a
// marker, or throws what the real one throws, so what is pinned here is the CHOICE (3D by default, remembered for the session, never in
// storage) and what the stage does when the 3D cannot be drawn. The real drawing is driven in a browser (drive-mise2-cakes.mjs).

const behaviour = vi.hoisted(() => ({ mode: 'ok' as 'ok' | 'webgl' | 'load' }));

type Pick = { tier: number; part: string };
vi.mock('./Cake3D', async () => {
  const { Cake3DUnavailable } = await import('./cake3dModel');
  return {
    default: (props: { onSelect: (s: Pick) => void; onOpenPart?: (s: Pick) => void }) => {
      if (behaviour.mode === 'webgl') throw new Cake3DUnavailable('webgl');
      if (behaviour.mode === 'load') throw new Error('Failed to fetch dynamically imported module');
      return (
        <div data-testid="three-d">
          <button type="button" onClick={() => { props.onSelect({ tier: 0, part: 'base' }); }}>pick</button>
          <button type="button" onClick={() => { props.onOpenPart?.({ tier: 0, part: 'base' }); }}>open</button>
        </div>
      );
    },
  };
});

const CAKE: Cake = {
  id: 'c1', name: 'Plain', diameterCm: 22, tiers: 1, discs: 2, slices: 12,
  lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 500 }],
  packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: null, model: 1,
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

beforeEach(() => { forgetStageChoice(); behaviour.mode = 'ok'; window.localStorage.clear(); window.sessionStorage.clear(); });
afterEach(() => { Reflect.deleteProperty(window, 'matchMedia'); });

describe('the stage’s 3D | Simple drawing switch', () => {
  it('shows the 3D by default, with the switch above it', async () => {
    render(stage());
    expect(await screen.findByTestId('three-d')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '3D' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Simple drawing' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
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

  it('switches to the simple drawing (one named image) and back, remembering the choice for the session only', async () => {
    const view = render(stage());
    const user = userEvent.setup();
    await screen.findByTestId('three-d');
    await user.click(screen.getByRole('radio', { name: 'Simple drawing' }));
    expect(screen.queryByTestId('three-d')).not.toBeInTheDocument();
    expect(screen.getByRole('img', DRAWING)).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Simple drawing' })).toHaveAttribute('aria-checked', 'true');
    // Another editor opened in the same session starts on the drawing.
    view.unmount();
    render(stage());
    expect(screen.getByRole('img', DRAWING)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: '3D' }));
    expect(await screen.findByTestId('three-d')).toBeInTheDocument();
    // Nothing was written to the device.
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});

describe('when the 3D cannot be drawn', () => {
  it('falls back to the simple drawing with a note when the device has no WebGL', async () => {
    behaviour.mode = 'webgl';
    render(stage());
    expect(await screen.findByRole('img', DRAWING)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This device cannot draw the 3D view, so the simple drawing is shown.');
    expect(screen.getByRole('radio', { name: 'Simple drawing' })).toHaveAttribute('aria-checked', 'true');
  });

  it('falls back with its own note when the library did not load, and choosing 3D again tries again', async () => {
    behaviour.mode = 'load';
    render(stage());
    const user = userEvent.setup();
    expect(await screen.findByRole('img', DRAWING)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('The 3D view could not be loaded (is there a connection?), so the simple drawing is shown.');
    // Back online.
    behaviour.mode = 'ok';
    await user.click(screen.getByRole('radio', { name: '3D' }));
    expect(await screen.findByTestId('three-d')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('starts on the simple drawing, with a note, when the device asks for less motion — and 3D is still a tap away', async () => {
    motion(true);
    render(stage());
    const user = userEvent.setup();
    expect(screen.getByRole('img', DRAWING)).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('This device asks for less motion, so the simple drawing is shown. Choose 3D to see the cake.');
    await user.click(screen.getByRole('radio', { name: '3D' }));
    expect(await screen.findByTestId('three-d')).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole('status')).not.toBeInTheDocument(); });
  });
});
