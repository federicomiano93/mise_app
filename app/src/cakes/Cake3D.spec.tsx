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
  anchors: [] as Array<{ key: string; x: number; y: number }>,
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
      anchors: () => world.anchors,
      dispose: vi.fn(() => { world.disposed += 1; }),
    };
    world.scenes.push(scene);
    return scene;
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
  world.anchors = [];
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

describe('what repaints the scene', () => {
  it('hands the scene the looks the names give, and rebuilds when a recipe looks different, not when it only reads differently', async () => {
    const view = render(<Cake3D {...props()} />);
    await settled();
    await waitFor(() => { expect(lastScene().build).toHaveBeenCalledTimes(1); });
    expect(lastScene().build).toHaveBeenLastCalledWith(expect.anything(), 'cut', [expect.objectContaining({ base: { colour: '#ecca8a' } })]);
    // «Genoise» is the same golden sponge: nothing to repaint.
    view.rerender(<Cake3D {...props({ labels: { ...LABELS, cardName: () => 'Genoise' } })} />);
    expect(lastScene().build).toHaveBeenCalledTimes(1);
    // A cocoa sponge is another colour.
    view.rerender(<Cake3D {...props({ labels: { ...LABELS, cardName: () => 'Pan di Spagna al cacao' } })} />);
    await waitFor(() => { expect(lastScene().build).toHaveBeenCalledTimes(2); });
    expect(lastScene().build).toHaveBeenLastCalledWith(expect.anything(), 'cut', [expect.objectContaining({ base: { colour: '#7a4c30' } })]);
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
    await waitFor(() => { expect(lastScene().build).toHaveBeenLastCalledWith(expect.anything(), 'whole', expect.anything()); });
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

describe('the callouts', () => {
  const size = (width: number, height: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
  };
  const callouts: StageLabels = {
    ...LABELS,
    callout: () => '500 g · £1.00',
    total: 'Raw materials so far: £1.00',
  };
  const full: Cake = {
    ...CAKE,
    lines: [
      { tier: 0, part: 'base', productId: 'SPONGE', grams: 500 },
      { tier: 0, part: 'soak', productId: 'SPONGE', grams: 100 },
      { tier: 0, part: 'coating', productId: 'SPONGE', grams: 200 },
    ],
  };

  it('say only the recipe name and «g · €» — no part title — on each side of the cake, with a curved leader line each', async () => {
    size(900, 500);
    world.anchors = [{ key: 'base', x: 300, y: 300 }, { key: 'soak', x: 600, y: 200 }, { key: 'coating', x: 620, y: 260 }];
    const { container } = render(<Cake3D {...props({ labels: callouts }, full)} />);
    await settled();
    await waitFor(() => { expect(container.querySelectorAll('[data-part]')).toHaveLength(3); });
    const label = container.querySelector('[data-part="base"]') as HTMLElement;
    expect(label).toHaveTextContent('Sponge');
    expect(label).toHaveTextContent('500 g · £1.00');
    expect(label).not.toHaveTextContent('Base');
    expect(label.getAttribute('style')).toMatch(/left/);
    expect((container.querySelector('[data-part="soak"]') as HTMLElement).getAttribute('style')).toMatch(/right/);
    // One thin curve each (a cubic, never a straight line), joined to its point.
    // Each is drawn twice: a light halo under the line, so it reads on the backdrop.
    expect(container.querySelectorAll('svg[viewBox="0 0 900 500"] path[data-halo]')).toHaveLength(3);
    const paths = [...container.querySelectorAll('svg[viewBox="0 0 900 500"] path:not([data-halo])')];
    expect(paths).toHaveLength(3);
    for (const path of paths) expect(path.getAttribute('d')).toMatch(/^M [\d.]+ [\d.]+ C /);
  });

  it('show «Raw materials so far» over the cake, and nothing when the cake holds nothing', async () => {
    size(900, 500);
    world.anchors = [{ key: 'base', x: 300, y: 300 }];
    const view = render(<Cake3D {...props({ labels: callouts }, full)} />);
    await settled();
    expect(screen.getByText('Raw materials so far: £1.00')).toBeInTheDocument();
    view.rerender(<Cake3D {...props({ labels: { ...callouts, total: '' } }, full)} />);
    expect(screen.queryByText(/Raw materials so far/)).not.toBeInTheDocument();
  });

  it('on a stage too narrow for labels, show «Raw materials so far» as the last line of the list and not over the cake', async () => {
    size(300, 400);
    world.anchors = [{ key: 'base', x: 150, y: 300 }];
    const { container } = render(<Cake3D {...props({ labels: callouts }, full)} />);
    await settled();
    const totals = screen.getAllByText('Raw materials so far: £1.00');
    expect(totals).toHaveLength(1);
    expect(totals[0]?.parentElement?.lastElementChild).toBe(totals[0]);
    expect(container.querySelector('[data-part="base"]')?.parentElement).toBe(totals[0]?.parentElement);
  });

  it('are hidden from a screen reader: the steps beside the drawing say the same', async () => {
    size(900, 500);
    world.anchors = [{ key: 'base', x: 300, y: 300 }];
    const { container } = render(<Cake3D {...props({ labels: callouts }, full)} />);
    await settled();
    await waitFor(() => { expect(container.querySelector('[data-part="base"]')).not.toBeNull(); });
    expect((container.querySelector('[data-part="base"]') as HTMLElement).closest('[aria-hidden="true"]')).not.toBeNull();
    expect(screen.getByText('Raw materials so far: £1.00').closest('[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('one tap on a name box', () => {
  const size = (width: number, height: number) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(height);
  };

  it('chooses the part AND opens its step, with no second tap (a label beside the cake)', async () => {
    size(900, 500);
    world.anchors = [{ key: 'base', x: 300, y: 300 }];
    const onSelect = vi.fn();
    const onOpenPart = vi.fn();
    const { container } = render(<Cake3D {...props({ onSelect, onOpenPart })} />);
    await settled();
    await waitFor(() => { expect(container.querySelector('[data-part="base"]')).not.toBeNull(); });
    await userEvent.click(container.querySelector('[data-part="base"]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith({ tier: 0, part: 'base' });
    expect(onOpenPart).toHaveBeenCalledTimes(1);
    expect(onOpenPart).toHaveBeenCalledWith({ tier: 0, part: 'base' });
    expect(screen.getByRole('img', STAGE)).toHaveFocus();
  });

  it('does the same for a note under a stage too narrow for labels', async () => {
    size(300, 400);
    world.anchors = [{ key: 'base', x: 150, y: 300 }];
    const onSelect = vi.fn();
    const onOpenPart = vi.fn();
    const { container } = render(<Cake3D {...props({ onSelect, onOpenPart })} />);
    await settled();
    await waitFor(() => { expect(container.querySelector('[data-part="base"]')).not.toBeNull(); });
    await userEvent.click(container.querySelector('[data-part="base"]') as HTMLElement);
    expect(onSelect).toHaveBeenCalledWith({ tier: 0, part: 'base' });
    expect(onOpenPart).toHaveBeenCalledTimes(1);
  });
});

describe('the view buttons', () => {
  it('stand inside the stage, over the picture, each with its name', async () => {
    const { container } = render(<Cake3D {...props()} />);
    await settled();
    const stage = container.firstElementChild as HTMLElement;
    const viewport = screen.getByRole('img', STAGE);
    for (const button of [screen.getByRole('radio', { name: 'Cut-away' }), screen.getByRole('radio', { name: 'Whole' }), screen.getByRole('button', { name: /initial view/i })]) {
      expect(stage).toContainElement(button);
      expect(viewport).not.toContainElement(button);
    }
  });
});

