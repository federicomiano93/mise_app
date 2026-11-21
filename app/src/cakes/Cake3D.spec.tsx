import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake, CakePart } from '@mise/shared/cake-model';
import Cake3D from './Cake3D';
import type { Cake3DProps } from './Cake3D';
import type { SceneHooks } from './cake3dScene';
import type { StageLabels } from './CakeStage';

// The REAL Cake3D.tsx with the scene replaced by a recording stand-in (WebGL does not exist in jsdom and is not what is tested here):
// what is pinned is the component's own duties — it frees what it makes, it asks for one scene at a time, it rebuilds only when the cake's
// SHAPE changes, it listens for R only inside the stage, it says why it cannot draw instead of throwing, and it hands the focus to the stage.

const world = vi.hoisted(() => ({
  webgl: true,
  created: 0,
  disposed: 0,
  throwOnCreate: false,
  hooks: null as unknown,
  scenes: [] as Array<{ build: ReturnType<typeof vi.fn>; goHome: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
}));

vi.mock('./threeParts', () => ({}));
vi.mock('./cake3dModel', async importOriginal => ({ ...(await importOriginal<typeof import('./cake3dModel')>()), webglAvailable: () => world.webgl }));
vi.mock('./cake3dScene', () => ({
  createCakeScene: (_lib: unknown, _canvas: unknown, _css: unknown, hooks: unknown) => {
    if (world.throwOnCreate) throw new Error('no context');
    world.created += 1;
    world.hooks = hooks;
    const scene = {
      build: vi.fn(),
      setSelection: vi.fn(),
      resize: vi.fn(),
      goHome: vi.fn(),
      anchors: () => [],
      dispose: vi.fn(() => { world.disposed += 1; }),
    };
    world.scenes.push(scene);
    return scene;
  },
}));

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

const props = (extra: Partial<Cake3DProps> = {}, cake: Cake = CAKE): Cake3DProps => ({
  geometry: cakeGeometry(cake), selected: null, tier: 0, onSelect: vi.fn(), labels: LABELS, onUnavailable: vi.fn(), ...extra,
});

const settled = async () => { await waitFor(() => { expect(world.created).toBeGreaterThan(0); }); };
const lastScene = () => world.scenes[world.scenes.length - 1]!;
const STAGE = { name: LABELS.summary };

beforeEach(() => {
  world.webgl = true;
  world.created = 0;
  world.disposed = 0;
  world.throwOnCreate = false;
  world.hooks = null;
  world.scenes = [];
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the 3D view’s resources', () => {
  it('frees the scene when it closes', async () => {
    const view = render(<Cake3D {...props()} />);
    await settled();
    expect(world.disposed).toBe(0);
    view.unmount();
    expect(world.disposed).toBe(world.created);
  });

  it('⚠️ keeps ONE live scene under StrictMode, which mounts everything twice', async () => {
    const view = render(<StrictMode><Cake3D {...props()} /></StrictMode>);
    await settled();
    await act(async () => { await Promise.resolve(); });
    expect(world.created - world.disposed).toBe(1);
    view.unmount();
    expect(world.created - world.disposed).toBe(0);
  });
});

describe('what rebuilds the scene', () => {
  it('rebuilds for a change of shape, never for grams or a card’s name', async () => {
    const view = render(<Cake3D {...props()} />);
    await settled();
    await waitFor(() => { expect(lastScene().build).toHaveBeenCalledTimes(1); });
    // Grams typed, a card renamed: the labels' words change, the meshes stay.
    const typed: Cake = { ...CAKE, lines: [{ tier: 0, part: 'base', productId: 'SPONGE', grams: 640 }] };
    view.rerender(<Cake3D {...props({ labels: { ...LABELS, cardName: () => 'Genoise' } }, typed)} />);
    expect(screen.queryByText('Sponge')).not.toBeInTheDocument();
    expect(lastScene().build).toHaveBeenCalledTimes(1);
    // A wider cake is another shape.
    view.rerender(<Cake3D {...props({}, { ...typed, diameterCm: 28 })} />);
    await waitFor(() => { expect(lastScene().build).toHaveBeenCalledTimes(2); });
  });
});

describe('the R key', () => {
  const withOutside = () => render(<div><input aria-label="outside" /><Cake3D {...props()} /></div>);

  it('goes back to the initial view only while the focus is inside the stage', async () => {
    withOutside();
    await settled();
    const user = userEvent.setup();
    const goHome = lastScene().goHome;
    // Typing in a box outside the stage, and a press with the focus on the page itself: nothing.
    await user.click(screen.getByRole('textbox', { name: 'outside' }));
    await user.keyboard('r');
    document.body.focus();
    await user.keyboard('R');
    expect(goHome).not.toHaveBeenCalled();
    // On the stage, and on one of its buttons: yes. A modified R is somebody else's shortcut.
    screen.getByRole('img', STAGE).focus();
    await user.keyboard('r');
    expect(goHome).toHaveBeenCalledTimes(1);
    screen.getByRole('radio', { name: 'Whole' }).focus();
    await user.keyboard('R');
    expect(goHome).toHaveBeenCalledTimes(2);
    await user.keyboard('{Control>}r{/Control}');
    expect(goHome).toHaveBeenCalledTimes(2);
  });

  it('makes the stage a tab stop that names the shortcut', () => {
    withOutside();
    const stage = screen.getByRole('img', STAGE);
    expect(stage).toHaveAttribute('tabindex', '0');
    expect(stage).toHaveAttribute('aria-keyshortcuts', 'R');
  });
});

describe('the cut-away | whole switch from the keyboard', () => {
  it('moves and chooses with the arrows', async () => {
    render(<Cake3D {...props()} />);
    await settled();
    const user = userEvent.setup();
    screen.getByRole('radio', { name: 'Cut-away' }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('radio', { name: 'Whole' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Whole' })).toHaveFocus();
    await waitFor(() => { expect(lastScene().build).toHaveBeenLastCalledWith(expect.anything(), 'whole'); });
  });
});

describe('when it cannot draw it says so, and never throws', () => {
  it('says «webgl» without asking for the library when the device has no WebGL 2', async () => {
    world.webgl = false;
    const onUnavailable = vi.fn();
    render(<Cake3D {...props({ onUnavailable })} />);
    await waitFor(() => { expect(onUnavailable).toHaveBeenCalledWith('webgl'); });
    expect(world.created).toBe(0);
  });

  it('says «webgl» when the context cannot be made', async () => {
    world.throwOnCreate = true;
    const onUnavailable = vi.fn();
    render(<Cake3D {...props({ onUnavailable })} />);
    await waitFor(() => { expect(onUnavailable).toHaveBeenCalledWith('webgl'); });
  });

  it('says «error» when the scene gives up on a context that did not come back', async () => {
    const onUnavailable = vi.fn();
    render(<Cake3D {...props({ onUnavailable })} />);
    await settled();
    act(() => { (world.hooks as SceneHooks).onGaveUp(); });
    expect(onUnavailable).toHaveBeenCalledWith('error');
  });

  it('says «load» when the library does not arrive (a REJECTED import), without a render error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.resetModules();
    vi.doMock('./threeParts', () => { throw new Error('Failed to fetch dynamically imported module'); });
    const { default: Fresh } = await import('./Cake3D');
    const onUnavailable = vi.fn();
    render(<Fresh {...props({ onUnavailable })} />);
    await waitFor(() => { expect(onUnavailable).toHaveBeenCalledWith('load'); });
    expect(world.created).toBe(0);
    expect(logged).not.toHaveBeenCalled();
    vi.doUnmock('./threeParts');
  });
});

describe('a second tap on the chosen part', () => {
  it('opens its chooser and leaves the focus on the stage, so closing the chooser never lands on the page', async () => {
    const onOpenPart = vi.fn();
    const onSelect = vi.fn();
    const chosen = { tier: 0, part: 'base' as const };
    render(<Cake3D {...props({ selected: chosen, onOpenPart, onSelect })} />);
    await settled();
    expect(document.body).toHaveFocus();
    act(() => { (world.hooks as SceneHooks).onTap(chosen); });
    expect(onOpenPart).toHaveBeenCalledWith(chosen);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByRole('img', STAGE)).toHaveFocus();
  });

  it('a first tap only chooses the part', async () => {
    const onOpenPart = vi.fn();
    const onSelect = vi.fn();
    render(<Cake3D {...props({ selected: null, onOpenPart, onSelect })} />);
    await settled();
    act(() => { (world.hooks as SceneHooks).onTap({ tier: 0, part: 'base' }); });
    expect(onSelect).toHaveBeenCalledWith({ tier: 0, part: 'base' });
    expect(onOpenPart).not.toHaveBeenCalled();
  });
});

describe('the touch hint', () => {
  it('is on the page for a touch screen to show (the stylesheet hides it elsewhere)', () => {
    render(<Cake3D {...props()} />);
    expect(screen.getByText('Two fingers to turn and zoom the cake.')).toBeInTheDocument();
  });
});
