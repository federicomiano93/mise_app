import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { CakePart } from '@mise/shared/cake-model';
import type { CakeStageProps } from './CakeStage';
import type { Selected } from './cakeEditorModel';
import {
  Cake3DUnavailable, cakeLayout, cakeShare, labelBoxFor, leaderPath, placeLabels, tapAction, webglAvailable,
} from './cake3dModel';
import type { PlacedLabel, StageView } from './cake3dModel';
import { createCakeScene } from './cake3dScene';
import type { CakeScene, SceneColours } from './cake3dScene';
import { useT } from '../i18n/useT';
import styles from './Cake3D.module.css';

// The tokens the scene is painted with, read from the page's own stylesheet when the view opens (never typed here).
function readColours(host: HTMLElement): SceneColours {
  const style = getComputedStyle(host);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    base: read('--cake-base'), soak: read('--cake-soak'), filling: read('--cake-filling'), coating: read('--cake-coating'),
    decoration: read('--cake-decoration'), board: read('--cake-board'),
    accent: read('--accent'), backdrop: read('--sunken'), ground: read('--line'),
  };
}

const sameSelection = (a: Selected | null, b: Selected | null) => a !== null && b !== null && a.tier === b.tier && a.part === b.part;

// The cake in three dimensions: ONE renderer, drawn on demand, from the same `cakeGeometry` and words as the flat section. Loaded only
// when a cake editor shows it (CakeStage lazy-loads this file, and this file loads three.js with import()).
//
// ⚠️ THE ACCESSIBILITY PATH IS THE 2D'S: the canvas, the labels and the lines are hidden from a screen reader (aria-hidden), the stage is
// one named image with the flat drawing's summary, and the parts list beside it stays the way to choose by keyboard.
// ⚠️ IT SAYS WHY IT CANNOT DRAW by throwing Cake3DUnavailable (no WebGL / the library did not arrive): CakeStage's boundary catches it
// and shows the flat drawing with a note.
export default function Cake3D({ geometry, selected, tier, onSelect, labels, onOpenPart }: CakeStageProps) {
  const { t } = useT();
  const viewport = useRef<HTMLDivElement>(null);
  const canvasHost = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CakeScene | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<StageView>('cut');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [placed, setPlaced] = useState<PlacedLabel[]>([]);
  const [moving, setMoving] = useState(true);
  const [hover, setHover] = useState<Selected | null>(null);
  if (failure) throw failure;

  const layout = useMemo(() => cakeLayout(geometry), [geometry]);

  // What the scene's callbacks (made once) must see now.
  const latest = useRef({ selected, tier, onSelect, onOpenPart, size });
  useLayoutEffect(() => { latest.current = { selected, tier, onSelect, onOpenPart, size }; });

  const act = useCallback((picked: Selected | null) => {
    const { selected: current, onSelect: select, onOpenPart: open } = latest.current;
    const action = tapAction(picked, current);
    if (picked && action === 'select') select(picked);
    else if (picked && action === 'open') open?.(picked);
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
    if (!webglAvailable()) { setFailure(new Cake3DUnavailable('webgl')); return undefined; }
    let cancelled = false;
    let scene: CakeScene | null = null;
    // A fresh canvas for each scene: a canvas whose context was given up cannot draw again.
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    void (async () => {
      let lib: Awaited<typeof import('three')>;
      let Controls: Awaited<typeof import('three/addons/controls/OrbitControls.js')>['OrbitControls'];
      try {
        const [three, addon] = await Promise.all([import('three'), import('three/addons/controls/OrbitControls.js')]);
        lib = three;
        Controls = addon.OrbitControls;
      } catch {
        if (!cancelled) setFailure(new Cake3DUnavailable('load'));
        return;
      }
      if (cancelled) return;
      try {
        scene = createCakeScene(lib, Controls, canvas, readColours(host), {
          onMoving: next => { setMoving(next); },
          onRest: refreshLabels,
          onTap: act,
          onHover: next => { setHover(next); },
        });
      } catch {
        if (!cancelled) setFailure(new Cake3DUnavailable('webgl'));
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
    sceneRef.current?.build(layout, view);
    refreshLabels();
  }, [ready, layout, view, refreshLabels]);

  useEffect(() => { if (ready) sceneRef.current?.setSelection(selected); }, [ready, selected]);
  useEffect(() => { if (ready) refreshLabels(); }, [ready, tier, refreshLabels]);

  // R goes back to the initial view (not while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key !== 'r' && event.key !== 'R') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]'))) return;
      sceneRef.current?.goHome();
    };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); };
  }, []);

  const box = labelBoxFor(Math.max(size.width, 1), Math.max(size.height, 1));
  const shown = geometry.tiers[Math.min(tier, geometry.tiers.length - 1)];
  const narrow = box.columns === 1;
  const stacked = box.columns === 0;
  // The parts the chosen tier has, top to bottom (the labels of a stage with no room beside the cake).
  const listed = (['decoration', 'coating', 'filling', 'soak', 'base'] as const).filter(part => {
    const info = shown?.parts[part];
    return info !== undefined && info.productIds.length > 0 && !(part === 'filling' && (shown?.discs ?? 0) < 2);
  });
  const noteOf = (part: CakePart) => {
    const info = shown?.parts[part];
    return {
      title: `${labels.part[part]} · ${labels.grams(info?.grams ?? 0)}`,
      names: (info?.productIds ?? []).map(labels.cardName).filter(name => name !== '').join(' + '),
    };
  };

  return (
    <div className={styles.stage} data-stacked={stacked}>
      <div className={styles.bar}>
        <div role="radiogroup" aria-label={t('cakes.stage.cutGroup')} className={styles.views}>
          {(['cut', 'whole'] as const).map(choice => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={view === choice}
              className={styles.view}
              onClick={() => { setView(choice); }}
            >
              {t(choice === 'cut' ? 'cakes.stage.cut' : 'cakes.stage.whole')}
            </button>
          ))}
        </div>
        <button type="button" className={styles.home} aria-keyshortcuts="R" onClick={() => { sceneRef.current?.goHome(); }}>
          <RotateCcw aria-hidden="true" />
          <span>{t('cakes.stage.home')}</span>
        </button>
      </div>
      <div ref={viewport} className={styles.viewport} role="img" aria-label={labels.summary}>
        <div ref={canvasHost} className={styles.canvasHost} aria-hidden="true" />
        <div className={styles.overlay} data-moving={moving || !ready || stacked} aria-hidden="true">
          <svg className={styles.leaders} viewBox={`0 0 ${String(Math.max(size.width, 1))} ${String(Math.max(size.height, 1))}`} focusable="false">
            {placed.map(label => {
              const on = sameSelection(selected, { tier, part: label.key as CakePart });
              return (
                <g key={label.key}>
                  <path className={styles.leader} data-chosen={on} fill="none" d={leaderPath(label)} />
                  <circle className={styles.leaderDot} data-chosen={on} cx={label.anchor.x} cy={label.anchor.y} r={3} />
                </g>
              );
            })}
          </svg>
          {placed.map(label => {
            const part = label.key as CakePart;
            const info = shown?.parts[part];
            const chosen = sameSelection(selected, { tier, part });
            const names = (info?.productIds ?? []).map(labels.cardName).filter(name => name !== '').join(' + ');
            const grams = labels.grams(info?.grams ?? 0);
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
                onClick={() => { act({ tier, part }); }}
              >
                {narrow ? (
                  <>
                    <span className={styles.title}>{labels.part[part]}</span>
                    <span className={styles.title}>{grams}</span>
                  </>
                ) : (
                  <span className={styles.title}>{`${labels.part[part]} · ${grams}`}</span>
                )}
                <span className={styles.names}>{names}</span>
              </div>
            );
          })}
        </div>
      </div>
      {stacked ? (
        <div className={styles.notes} aria-hidden="true">
          {listed.map(part => {
            const note = noteOf(part);
            return (
              <div
                key={part}
                className={styles.note}
                data-chosen={sameSelection(selected, { tier, part })}
                data-hover={sameSelection(hover, { tier, part })}
                data-part={part}
                onClick={() => { act({ tier, part }); }}
              >
                <span className={styles.title}>{note.title}</span>
                <span className={styles.names}>{note.names}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
