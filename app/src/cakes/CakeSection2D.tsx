import { useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { CakeGeometry, CakePart } from '@mise/shared/cake-model';
import type { Selected } from './cakeEditorModel';
import styles from './CakeSection2D.module.css';

// The words the drawing needs, handed in so this file has no language of its own (and the 3D view that follows takes the same ones).
export interface StageLabels {
  // The picture's name for a screen reader: «Section drawing of the cake: 2 tiers, 3 discs a tier. The parts list says the same.»
  summary: string;
  part: Readonly<Record<CakePart, string>>;
  // A card's name (the Food cost card's), '' for one that is gone.
  cardName: (productId: string) => string;
  // «420 g».
  grams: (grams: number) => string;
  // «Ø 24».
  diameter: (diameterCm: number) => string;
}

type Props = {
  geometry: CakeGeometry;
  selected: Selected | null;
  // The tier whose parts are named on the right (the one chosen in the parts list).
  tier: number;
  onSelect: (selected: Selected) => void;
  labels: StageLabels;
};

// ⚠️ THE PICTURE'S UNITS ARE SCREEN PIXELS: the viewBox is as wide as the stage really is (measured), so a 12px label is 12px on
// screen at every width. A fixed 640-unit viewBox shrank every word to 7px on the split. Before the stage is measured (and where
// nothing measures, as in a test) it is 640 wide.
const DEFAULT_WIDTH = 640;
const MIN_WIDTH = 200;
const HEIGHT_WIDE = 330;
// Narrow stages stack three short lines per label (name, grams, card), which needs more height.
const HEIGHT_NARROW = 372;
// Left of the cake: the diameter words.
const LEFT_MARGIN = 46;
const LABEL_SHARE = 0.36;
const LABEL_MIN = 96;
const LABEL_MAX = 240;
// Under this label column the part's name and grams do not fit on one line.
const NARROW_LABEL = 190;
const MAX_CAKE_UNITS = 440;
const CHAR_UNITS = 6.4;
// Heights are drawn taller than true (as in the mockup): a real cake is wide and low, and its layers would be slivers.
const HEIGHT_EXAGGERATION = 2.2;
const DISC_SHARE = 0.72;

// Parts from the top of the cake to the bottom: the order the labels stack in.
const PART_CLASS: Readonly<Record<CakePart, string>> = {
  decoration: 'decoration', coating: 'coating', filling: 'filling', soak: 'soak', base: 'base',
};

const sameSelection = (selected: Selected | null, tier: number, part: CakePart): boolean =>
  selected !== null && selected.tier === tier && selected.part === part;

interface Label { part: CakePart; y: number; x: number; tier: number }

// The cake in section, drawn from `cakeGeometry` (the ONE description of the cake): the discs, the layers between them, the coating
// around, the decoration on top, and for the chosen tier the name and grams of every part, joined to it by lines that never cross.
//
// ⚠️ THE PART AREAS ARE A MOUSE CONVENIENCE: they select the part in the parts list, but they are not in the tab order and say
// nothing to a screen reader — the parts list is the keyboard and screen-reader path, and the picture itself is one named image.
export function CakeSection2D({ geometry, selected, tier: shownTier, onSelect, labels }: Props) {
  const drawRef = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState(0);
  useLayoutEffect(() => {
    const node = drawRef.current;
    if (!node) return undefined;
    const read = () => { setMeasured(node.clientWidth); };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => { observer.disconnect(); };
  }, []);

  const tiers = geometry.tiers;
  const first = tiers[0];
  if (!first) return null;

  const width2d = measured > 0 ? Math.max(MIN_WIDTH, Math.round(measured)) : DEFAULT_WIDTH;
  const labelWidth = Math.max(LABEL_MIN, Math.min(LABEL_MAX, Math.round(width2d * LABEL_SHARE)));
  const narrow = labelWidth < NARROW_LABEL;
  const HEIGHT = narrow ? HEIGHT_NARROW : HEIGHT_WIDE;
  const BOARD_Y = HEIGHT - 24;
  const LABEL_X = width2d - labelWidth;
  const maxNameChars = Math.floor((labelWidth - 4) / CHAR_UNITS);
  // The cake takes what the diameter words and the label column leave, up to a size past which it only gets wider than it is tall.
  const cakeRoom = LABEL_X - LEFT_MARGIN - 18;
  const fullWidthUnits = Math.max(60, Math.min(MAX_CAKE_UNITS, cakeRoom - 16));
  const CENTRE_X = LEFT_MARGIN + cakeRoom / 2;

  const scale = fullWidthUnits / first.diameterCm;
  const discCm = first.discHeightCm;
  const heightScale = Math.min(scale * HEIGHT_EXAGGERATION, 250 / (first.discs * discCm * tiers.length + 3));
  const coat = Math.max(5, 0.6 * scale);

  const shapes: ReactNode[] = [];
  const marks: Label[] = [];
  let y = BOARD_Y;
  const select = (tier: number, part: CakePart) => () => { onSelect({ tier, part }); };

  tiers.forEach(tier => {
    const width = tier.diameterCm * scale;
    const x = CENTRE_X - width / 2;
    const cards = (part: CakePart) => tier.parts[part].productIds;
    const hasLayers = cards('filling').length > 0 && tier.discs > 1;
    const discPx = tier.discHeightCm * heightScale * DISC_SHARE;
    const layerPx = hasLayers ? tier.discHeightCm * heightScale * (1 - DISC_SHARE) : 0;
    // Without a filling the discs stand apart by an empty gap, so their number reads at a glance (as in the 3D view).
    const spacePx = hasLayers ? layerPx : discPx * 0.25;
    const top = y - (tier.discs * discPx + (tier.discs - 1) * spacePx);
    const key = (part: string, n = 0) => `${tier.index}-${part}-${n}`;
    const chosen = (part: CakePart) => (sameSelection(selected, tier.index, part) ? styles.chosen : '');

    if (cards('coating').length > 0) {
      shapes.push(
        <rect key={key('coating')} className={`${styles.hit} ${styles.coating} ${chosen('coating')}`} onClick={select(tier.index, 'coating')}
          x={x - coat} y={top - coat} width={width + 2 * coat} height={y - top + coat} rx={4} />,
      );
    }

    let cursor = y;
    let lastDiscY = y;
    let lastLayerY: number | null = null;
    let firstDiscY = y - discPx / 2;
    for (let disc = 0; disc < tier.discs; disc += 1) {
      shapes.push(
        <rect key={key('base', disc)} className={`${styles.hit} ${styles.base} ${chosen('base')}`} onClick={select(tier.index, 'base')}
          x={x} y={cursor - discPx} width={width} height={discPx} />,
      );
      if (cards('soak').length > 0) {
        shapes.push(
          <rect key={key('soak', disc)} className={`${styles.hit} ${styles.soak} ${chosen('soak')}`} onClick={select(tier.index, 'soak')}
            x={x} y={cursor - discPx} width={width} height={Math.max(2, discPx * 0.22)} />,
        );
      }
      if (disc === 0) firstDiscY = cursor - discPx / 2;
      lastDiscY = cursor - discPx * 0.9;
      cursor -= discPx;
      if (disc < tier.discs - 1 && hasLayers) {
        shapes.push(
          <rect key={key('filling', disc)} className={`${styles.hit} ${styles.filling} ${chosen('filling')}`} onClick={select(tier.index, 'filling')}
            x={x} y={cursor - layerPx} width={width} height={layerPx} />,
        );
        // A second card in the layer: dots of the soak colour along it, so two cards read as two things.
        if (cards('filling').length > 1) {
          for (let dot = 0; dot < Math.floor(width / 14); dot += 1) {
            shapes.push(
              <circle key={key('filling-dot', disc * 1000 + dot)} className={`${styles.hit} ${styles.soak}`} onClick={select(tier.index, 'filling')}
                cx={x + 7 + dot * 14} cy={cursor - layerPx / 2} r={Math.max(1, Math.min(4, layerPx / 2 - 0.5))} />,
            );
          }
        }
        lastLayerY = cursor - layerPx / 2;
        cursor -= layerPx;
      } else if (disc < tier.discs - 1) {
        cursor -= spacePx;
      }
    }

    const decorationY = top - coat - 6;
    if (cards('decoration').length > 0) {
      const count = Math.max(3, Math.floor(width / 22));
      for (let dot = 0; dot < count; dot += 1) {
        shapes.push(
          <circle key={key('decoration', dot)} className={`${styles.hit} ${styles.decoration} ${chosen('decoration')}`} onClick={select(tier.index, 'decoration')}
            cx={x + (width * (dot + 0.5)) / count} cy={decorationY} r={6} />,
        );
      }
    }

    shapes.push(
      <text key={key('diameter')} className={styles.diameter} x={x - coat - 10} y={(top + y) / 2} textAnchor="end">
        {labels.diameter(tier.diameterCm)}
      </text>,
    );

    if (tier.index === shownTier) {
      const right = x + width + coat;
      const at: Record<CakePart, number | null> = {
        decoration: decorationY,
        coating: (top + y) / 2,
        soak: lastDiscY,
        filling: lastLayerY,
        base: firstDiscY,
      };
      for (const part of Object.keys(PART_CLASS) as CakePart[]) {
        const height = at[part];
        if (height === null || cards(part).length === 0) continue;
        marks.push({ part, y: height, x: part === 'coating' ? right : x + width - 6, tier: tier.index });
      }
    }
    y = top - (cards('decoration').length > 0 ? 14 : coat);
  });

  // The names go on the right in the order of their height, so the lines that join them never cross.
  marks.sort((a, b) => a.y - b.y);
  const step = Math.max(narrow ? 62 : 42, (HEIGHT - 40) / Math.max(1, marks.length));
  const start = Math.max(18, Math.min(marks[0] ? marks[0].y - 10 : 18, HEIGHT - 20 - step * (marks.length - 1)));
  const notes = marks.map((mark, index) => {
    const ly = start + index * step;
    const tier = tiers[mark.tier];
    const part = tier ? tier.parts[mark.part] : { productIds: [], grams: 0 };
    const names = part.productIds.map(labels.cardName).filter(name => name !== '').join(' + ');
    const short = names.length > maxNameChars ? `${names.slice(0, maxNameChars - 1)}…` : names;
    const on = sameSelection(selected, mark.tier, mark.part);
    const reach = Math.min(60, (LABEL_X - 6 - mark.x) / 2);
    const partName = labels.part[mark.part];
    const grams = labels.grams(part.grams);
    return (
      <g key={`${mark.tier}-${mark.part}-note`}>
        <path className={styles.leader} data-chosen={on} fill="none"
          d={`M${mark.x} ${mark.y} C ${mark.x + reach} ${mark.y}, ${LABEL_X - 6 - reach} ${ly}, ${LABEL_X - 6} ${ly}`} />
        <circle className={styles.leaderDot} data-chosen={on} cx={mark.x} cy={mark.y} r={3} />
        <g className={styles.hit} onClick={select(mark.tier, mark.part)}>
          {narrow ? (
            <>
              <text className={styles.noteTitle} data-chosen={on} x={LABEL_X} y={ly - 3}>{partName}</text>
              <text className={styles.noteTitle} data-chosen={on} x={LABEL_X} y={ly + 14}>{grams}</text>
              <text className={styles.noteSub} x={LABEL_X} y={ly + 31}>{short}</text>
            </>
          ) : (
            <>
              <text className={styles.noteTitle} data-chosen={on} x={LABEL_X} y={ly - 3}>{`${partName} · ${grams}`}</text>
              <text className={styles.noteSub} x={LABEL_X} y={ly + 14}>{short}</text>
            </>
          )}
        </g>
      </g>
    );
  });

  const boardWidth = first.diameterCm * scale + 48;
  return (
    <div ref={drawRef} className={styles.draw}>
      <svg viewBox={`0 0 ${width2d} ${HEIGHT}`} role="img" aria-label={labels.summary}>
        <rect className={styles.board} x={CENTRE_X - boardWidth / 2} y={BOARD_Y} width={boardWidth} height={8} rx={3} />
        {shapes}
        {notes}
      </svg>
    </div>
  );
}
