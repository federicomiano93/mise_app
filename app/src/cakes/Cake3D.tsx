import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CakePart } from '@mise/shared/cake-model';
import type { CakeStageProps } from './CakeStage';
import type { Selected } from './cakeEditorModel';
import {
  cakeLayout, cakeShare, labelBoxFor, leaderPath, placeLabels, sceneSignature, tapAction, webglAvailable,
} from './cake3dModel';
import type { PlacedLabel, StageFailure, StageView } from './cake3dModel';
import { cakeLooks, looksKey } from './cakeLook';
import { createCakeScene } from './cake3dScene';
import type { CakeScene, SceneColours, Three } from './cake3dScene';
import { RovingRadios } from './RovingRadios';
import { useT } from '../i18n/useT';
import styles from './Cake3D.module.css';

export type Cake3DProps = CakeStageProps & {
  // The 3D cannot be drawn, for an EXPECTED reason (no WebGL 2, the library did not arrive, the graphics context lost for good): the stage
  // shows the simple drawing with its note. Said, never thrown: a throw reaches the error log, and these are not bugs.
  onUnavailable: (reason: StageFailure) => void;
};

// The tokens the scene is painted with, read from the page's own stylesheet when the view opens (never typed here).
function readColours(host: HTMLElement): SceneColours {
  const style = getComputedStyle(host);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    base: read('--cake-base'), soak: read('--cake-soak'), filling: read('--cake-filling'), coating: read('--cake-coating'),
    decoration: read('--cake-decoration'), board: read('--cake-board'),
    ground: read('--line'),
    stageCenter: read('--cake-stage-center'), stageEdge: read('--cake-stage-edge'),
  };
}

const sameSelection = (a: Selected | null, b: Selected | null) => a !== null && b !== null && a.tier === b.tier && a.part === b.part;

// The cake in three dimensions: ONE renderer, drawn on demand, from the same `cakeGeometry` and words as the flat section. Loaded only
// when a cake editor shows it (CakeStage lazy-loads this file, and this file loads three.js with import()).
//
// ⚠️ THE ACCESSIBILITY PATH IS THE 2D'S: the canvas, the labels and the lines are hidden from a screen reader (aria-hidden), the stage is
// one named image with the flat drawing's summary, and the parts list beside it stays the way to choose by keyboard.
// ⚠️ IT SAYS WHY IT CANNOT DRAW through `onUnavailable` (no WebGL 2 / the library did not arrive / the context was lost for good):
// CakeStage then shows the flat drawing with a note. It never throws for those — an error boundary's catch is logged as an error.
export default function Cake3D({ geometry, selected, tier, onSelect, labels, onOpenPart, onUnavailable }: Cake3DProps) {
  const { t } = useT();
  const viewport = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CakeScene | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<StageView>('cut');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [placed, setPlaced] = useState<PlacedLabel[]>([]);
  const [moving, setMoving] = useState(true);
  const [hover, setHover] = useState<Selected | null>(null);

  const layout = useMemo(() => cakeLayout(geometry), [geometry]);
  // ⚠️ THE SCENE IS REBUILT ONLY WHEN ITS SHAPE CHANGES (diameters, discs, which parts have cards, cut-away or whole): grams and names
  // change the labels' words, which React redraws by itself, and never the meshes.
  // ⚠️ THE LOOK FOLLOWS THE RECIPES' NAMES: a card renamed to something that looks different repaints the cake; the grams never do.
  const looks = cakeLooks(geometry, labels.cardName);
  const signature = sceneSignature(layout, view, looksKey(looks));

  // What the scene's callbacks (made once) must see now.
  const latest = useRef({ selected, tier, onSelect, onOpenPart, onUnavailable, layout, looks, size });
  useLayoutEffect(() => { latest.current = { selected, tier, onSelect, onOpenPart, onUnavailable, layout, looks, size }; });

  const act = useCallback((picked: Selected | null) => {
    const { selected: current, onSelect: select, onOpenPart: open } = latest.current;
    const action = tapAction(picked, current);
    if (picked && action === 'select') select(picked);
    else if (picked && action === 'open') {
      // The step this opens puts the cursor in its own search box; the focus is parked on the stage first, not on the page (a canvas tap
      // focuses nothing by itself).
      viewport.current?.focus({ preventScroll: true });
      open?.(picked);
    }
  }, []);

  // One tap on a name box (not on the cake itself) chooses the part AND opens its step: the owner chose «second tap opens» for the cake only.
  const openFromName = useCallback((picked: Selected) => {
    const { onSelect: select, onOpenPart: open } = latest.current;
    select(picked);
    viewport.current?.focus({ preventScroll: true });
    open?.(picked);
  }, []);

  const refreshLabels = useCallback(() => {
    const scene = sceneRef.current;
    const { width, height } = latest.current.size;
    if (!scene || width === 0 || height === 0) { setPlaced([]); return; }
    setPlaced(placeLabels(scene.anchors(latest.current.tier), labelBoxFor(width, height)));
  }, []);

  // The library, the renderer and the canvas: made when the view opens, freed when it closes.
  useEffect(() => {
    const host = canvasHost.current;
    if (!host) return undefined;
    if (!webglAvailable()) { latest.current.onUnavailable('webgl'); return undefined; }
    let cancelled = false;
    let scene: CakeScene | null = null;
    // A fresh canvas for each scene: a canvas whose context was given up cannot draw again.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    void (async () => {
      let lib: Three;
      try {
        lib = await import('./threeParts');
      } catch {
        if (!cancelled) latest.current.onUnavailable('load');
        return;
      }
      if (cancelled) return;
      try {
        scene = createCakeScene(lib, canvas, readColours(host), {
          onMoving: next => { setMoving(next); },
          onRest: refreshLabels,
          onTap: act,
          onHover: next => { setHover(next); },
          onGaveUp: () => { latest.current.onUnavailable('error'); },
        });
      } catch {
        if (!cancelled) latest.current.onUnavailable('webgl');
        return;
      }
      sceneRef.current = scene;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      sceneRef.current = null;
      scene?.dispose();
      canvas.remove();
      setReady(false);
    };
  }, [act, refreshLabels]);

  // The stage's size, kept up to date.
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return undefined;
    const read = () => { setSize({ width: node.clientWidth, height: node.clientHeight }); };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || size.width === 0) return;
    const box = labelBoxFor(size.width, size.height);
    const { share, centre } = cakeShare(box);
    scene.resize(size.width, size.height, share, centre);
    refreshLabels();
  }, [ready, size, refreshLabels]);

  useEffect(() => {
    if (!ready) return;
    sceneRef.current?.build(latest.current.layout, view, latest.current.looks);
    refreshLabels();
    // Keyed on the signature (the shape), not on the layout object, which is new at every keystroke.
  }, [ready, signature, view, refreshLabels]);

  useEffect(() => { if (ready) sceneRef.current?.setSelection(selected); }, [ready, selected]);
  useEffect(() => { if (ready) refreshLabels(); }, [ready, tier, refreshLabels]);

  // R goes back to the initial view, but only while the focus is inside the stage (not while typing, and not page-wide).
  const onStageKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key !== 'r' && event.key !== 'R') return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return;
    sceneRef.current?.goHome();
  };

  const box = labelBoxFor(Math.max(size.width, 1), Math.max(size.height, 1));
  const shown = geometry.tiers[Math.min(tier, geometry.tiers.length - 1)];
  const stacked = box.columns === 0;
  // The parts the chosen tier has, top to bottom (the labels of a stage with no room beside the cake).
  const listed = (['decoration', 'coating', 'filling', 'soak', 'base'] as const).filter(part => {
    const info = shown?.parts[part];
    return info !== undefined && info.productIds.length > 0 && !(part === 'filling' && (shown?.discs ?? 0) < 2);
  });
  // A part's callout: the recipe name(s), then its grams and cost — no part title (the cake itself shows which part it is).
  const calloutOf = (part: CakePart) => {
    const info = shown?.parts[part];
    return {
      names: (info?.productIds ?? []).map(labels.cardName).filter(name => name !== '').join(' + '),
      figures: labels.callout?.(tier, part) ?? labels.grams(info?.grams ?? 0),
    };
  };

  return (
    <div className={styles.stage} data-stacked={stacked} onKeyDown={onStageKey}>
      <div className={styles.bar}>
        <RovingRadios
          label={t('cakes.stage.cutGroup')}
          className={styles.views}
          optionClassName={styles.view}
          options={[{ value: 'cut', text: t('cakes.stage.cut') }, { value: 'whole', text: t('cakes.stage.whole') }]}
          value={view}
          onChoose={setView}
        />
        <button type="button" className={styles.home} aria-keyshortcuts="R" onClick={() => { sceneRef.current?.goHome(); }}>
          <RotateCcw aria-hidden="true" />
          <span>{t('cakes.stage.home')}</span>
        </button>
      </div>
      <div ref={viewport} className={styles.viewport} role="img" aria-label={labels.summary} aria-keyshortcuts="R" tabIndex={0}>
        <div ref={canvasHost} className={styles.canvasHost} aria-hidden="true" />
        <div className={styles.overlay} data-moving={moving || !ready || stacked} aria-hidden="true">
          <svg className={styles.leaders} viewBox={`0 0 ${String(Math.max(size.width, 1))} ${String(Math.max(size.height, 1))}`} focusable="false">
            {placed.map(label => {
              const on = sameSelection(selected, { tier, part: label.key as CakePart });
              return (
                <g key={label.key}>
                  <path className={styles.leaderHalo} data-halo="true" data-chosen={on} fill="none" d={leaderPath(label)} />
                  <path className={styles.leader} data-chosen={on} fill="none" d={leaderPath(label)} />
                  <circle className={styles.leaderDot} data-chosen={on} cx={label.anchor.x} cy={label.anchor.y} r={3} />
                </g>
              );
            })}
          </svg>
          {placed.map(label => {
            const part = label.key as CakePart;
            const chosen = sameSelection(selected, { tier, part });
            const { names, figures } = calloutOf(part);
            const style = {
              top: label.slot.y - box.labelHeight / 2,
              height: box.labelHeight,
              width: box.labelWidth,
              ...(label.side === 'left' ? { left: box.margin } : { right: box.margin }),
            };
            return (
              <div
                key={part}
                className={styles.label}
                style={style}
                data-chosen={chosen}
                data-hover={sameSelection(hover, { tier, part })}
                data-part={part}
                onClick={() => { openFromName({ tier, part }); }}
              >
                <span className={styles.title}>{names}</span>
                <span className={styles.names}>{figures}</span>
              </div>
            );
          })}
          {labels.total && !stacked ? <p className={styles.total}>{labels.total}</p> : null}
        </div>
      </div>
      <p className={styles.touchHint}>{t('cakes.stage.touchHint')}</p>
      {stacked ? (
        <div className={styles.notes} aria-hidden="true">
          {listed.map(part => {
            const note = calloutOf(part);
            return (
              <div
                key={part}
                className={styles.note}
                data-chosen={sameSelection(selected, { tier, part })}
                data-hover={sameSelection(hover, { tier, part })}
                data-part={part}
                onClick={() => { openFromName({ tier, part }); }}
              >
                <span className={styles.title}>{note.names}</span>
                <span className={styles.names}>{note.figures}</span>
              </div>
            );
          })}
          {labels.total ? <p className={styles.noteTotal}>{labels.total}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
