import { useCallback, useEffect, useRef } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { Button, DropIndicator, GridList, GridListItem, I18nProvider, useDragAndDrop } from 'react-aria-components';
import { unitOf } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import type { DropPosition, EditRow } from './editorModel';
import { unitWord } from './IngredientRow';
import styles from './ReorderRows.module.css';

type Props = {
  rows: readonly EditRow[];
  // The heading that names the list (the ingredients heading).
  labelledBy: string;
  // The paragraph that tells how to move a row; every grip is described by it.
  hintId: string;
  // A row was dropped at a place (the mouse, the touch, or React Aria's own keyboard drag).
  onDrop: (movedKey: number, targetKey: number, position: DropPosition) => void;
  // ArrowUp / ArrowDown on a grip: one place.
  onStep: (key: number, delta: -1 | 1) => void;
  // The grip that is owed the focus. An object, so asking twice for the same row asks twice.
  focusGrip: { key: number } | null;
};

// The rows of a recipe in REORDER MODE: each is a grip, the name and the amount — nothing to type in, so nothing can
// be changed by accident while a row is carried. (The current app's mode, docs/parity/catalogue.md item 92.)
//
// Two keyboards, both promised by the hint: React Aria's own drag (focus the grip, Enter, the arrows, Enter) and the arrow
// keys pressed on a grip, which move the row one place at once.
// ⚠️ THE DIRECT ARROWS ARE CAUGHT ABOVE THE LIST, IN THE CAPTURE PHASE, NOT ON THE GRIP: a grid row (useGridListItem) takes
// ArrowUp and ArrowDown in its own capture handler, stops them and re-sends them to the list, so a handler on the grip
// never hears them (a first version of this file was exactly that, and moved nothing). Every other key is left alone, so
// Enter and Space reach the drag, and a drag that is under way owns the arrows (its listener is on the
// document, before this one).
export function ReorderRows({ rows, labelledBy, hintId, onDrop, onStep, focusGrip }: Props) {
  const { t, lang } = useT();
  const nameOf = (item: EditRow): string => {
    const label = String(item.row.label ?? '').trim();
    return label === '' ? t('cat.unnamedRow') : label;
  };

  const nameOfKey = (key: unknown): string => {
    const item = rows.find(row => row.key === key);
    return item ? nameOf(item) : '';
  };

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: keys => [...keys].map(key => ({
      'text/plain': nameOfKey(key),
    })),
    onReorder: event => {
      const moved = [...event.keys][0];
      if (moved === undefined) return;
      onDrop(Number(moved), Number(event.target.key), event.target.dropPosition);
    },
    renderDropIndicator: target => <DropIndicator target={target} className={styles.indicator} />,
  });

  // ⚠️ THE FOCUS IS PUT BACK ON THE MOVED GRIP AFTER THE RENDER: a node that is moved in the page can lose the focus. The rows
  // of a GridList are built after the first layout, so a grip asked for before it exists is focused by its own ref.
  const grips = useRef(new Map<number, HTMLButtonElement>());
  const wanted = useRef<number | null>(null);
  const gripRefs = useRef(new Map<number, (node: HTMLButtonElement | null) => void>());
  const gripRef = (key: number) => {
    let ref = gripRefs.current.get(key);
    if (!ref) {
      ref = node => {
        if (node === null) {
          grips.current.delete(key);
          return;
        }
        grips.current.set(key, node);
        if (wanted.current === key) {
          wanted.current = null;
          node.focus();
        }
      };
      gripRefs.current.set(key, ref);
    }
    return ref;
  };
  const focusNow = useCallback((key: number) => {
    const node = grips.current.get(key);
    if (node) {
      wanted.current = null;
      node.focus();
    } else {
      wanted.current = key;
    }
  }, []);
  useEffect(() => {
    if (focusGrip === null) return undefined;
    focusNow(focusGrip.key);
    const frame = requestAnimationFrame(() => { focusNow(focusGrip.key); });
    return () => { cancelAnimationFrame(frame); };
  }, [focusGrip, focusNow]);

  const amountOf = (item: EditRow): { number: string; unit: string } => {
    const unit = unitOf(item.row);
    const grams = item.row.grams;
    const empty = grams === '' || grams === undefined || grams === null;
    return { number: unit === 'to taste' || empty ? '' : String(grams), unit: unitWord(unit, t) };
  };

  // ⚠️ THE LIST IS DESCRIBED BY THE HINT, and not the grips: a grip described by the hint would hide React Aria's own «Press
  // Enter to start dragging» from a screen reader. The attribute is set by hand because the list's drop handling (useDroppableCollection)
  // hands the grid `aria-describedby: null`, which wipes a prop passed to GridList.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => { gridRef.current?.setAttribute('aria-describedby', hintId); });

  const gripKeyOf = (target: EventTarget): number | undefined => [...grips.current].find(([, node]) => node === target)?.[0];

  // ⚠️ EVERY GRIP IS ITS OWN TAB STOP, as in the current app (a GridList is one stop with the focus on a row, and a keyboard
  // user could not otherwise reach the third grip without the arrow dance). Tab / Shift+Tab on a grip with a neighbour
  // focuses that neighbour; at the first and last grip the key is let go, so the focus leaves the list normally.
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const key = gripKeyOf(event.target);
    if (key === undefined) return;
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const index = rows.findIndex(item => item.key === key);
      const next = rows[index + (event.shiftKey ? -1 : 1)];
      const node = next ? grips.current.get(next.key) : undefined;
      if (!node) return;
      event.preventDefault();
      event.stopPropagation();
      node.focus();
      return;
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    event.stopPropagation();
    onStep(key, event.key === 'ArrowUp' ? -1 : 1);
  };

  // A focus that lands on a ROW (Tab back into the list, a click, React Aria restoring the focus after a drop) is handed to
  // that row's grip. The drop indicators of a keyboard drag are not rows of ours (no data-key of a grip), so they are left alone.
  const onFocusRow = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'row') return;
    const key = [...grips.current.keys()].find(candidate => String(candidate) === target.getAttribute('data-key'));
    if (key !== undefined) grips.current.get(key)?.focus();
  };

  return (
    <I18nProvider locale={lang}>
      <div onKeyDownCapture={onKey} onFocusCapture={onFocusRow}>
        <GridList
          aria-labelledby={labelledBy}
          ref={gridRef}
          className={styles.list}
          items={rows}
          dragAndDropHooks={dragAndDropHooks}
        >
          {item => {
            const name = nameOf(item);
            const amount = amountOf(item);
            return (
              <GridListItem id={item.key} textValue={name} className={styles.row}>
                <Button
                  slot="drag"
                  ref={gripRef(item.key)}
                  className={styles.grip}
                  aria-label={t('cat.moveRow', { name })}
                >
                  <GripVertical aria-hidden="true" />
                </Button>
                <span className={styles.name}>{name}</span>
                <span className={styles.amount}>
                  <span className={styles.number}>{amount.number}</span>
                  <span className={styles.unit}>{amount.unit}</span>
                </span>
                <span className={styles.spacer} aria-hidden="true" />
              </GridListItem>
            );
          }}
        </GridList>
      </div>
    </I18nProvider>
  );
}
