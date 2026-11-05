import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent } from 'react';
import { GripVertical } from 'lucide-react';
import { Button, DropIndicator, GridList, GridListItem, I18nProvider, useDragAndDrop } from 'react-aria-components';
import { Navigate, useLocation } from 'react-router';
import { sortSuppliersByOrder } from '@mise/shared/supplier-order';
import { supplierLabel } from '@mise/shared/supplier-label';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { useAlert } from '../ui/useAlert';
import { useOrders, useOrdersStore } from './OrdersContext';
import { SUPPLIER_ORDER_DOOR, useHandBack } from './handBack';
import { cameFromList, useLeave } from './ordersNav';
import { SETTINGS_PATH } from './ordersPath';
import styles from './SupplierSequenceScreen.module.css';

// How long «Saved ✓» stays under the list.
const SAVED_MS = 2000;

type Row = { readonly id: string; readonly label: string };

// Where the ids end up when `moved` goes before or after `target`. A key that is not there leaves the order as it was.
export function movedIds(ids: readonly string[], moved: string, target: string, position: 'before' | 'after' | 'on'): string[] {
  if (moved === target || !ids.includes(moved) || !ids.includes(target)) return [...ids];
  const rest = ids.filter(id => id !== moved);
  const at = rest.indexOf(target);
  rest.splice(position === 'before' ? at : at + 1, 0, moved);
  return rest;
}

// «Supplier order», at /orders/settings/supplier-order (step 3f-8a, parity M8), one level below the Orders settings: the order the
// supplier list is drawn in, for every phone. Each move is saved at once (his choice A, 5 Nov 2026): no Save button.
//
// ⚠️ ONLY FOR WHOEVER RUNS THE PLACE: the door is not drawn for anybody else, the rules refuse the write, and an address typed in by
// somebody else goes back to the settings.
export function SupplierSequenceScreen() {
  const { canManage } = useSession();
  if (!canManage) return <Navigate to={SETTINGS_PATH} replace state={KEEP_FOCUS} />;
  return <Sequence />;
}

function Sequence() {
  const { t, lang } = useT();
  const { state } = useLocation();
  const { suppliers, config, configLoaded } = useOrders();
  const store = useOrdersStore();
  const [alert, alertDialog] = useAlert();
  const handBack = useHandBack();
  const leave = useLeave(SETTINGS_PATH, () => { handBack.expect(SUPPLIER_ORDER_DOOR); });
  const titleId = useId();
  const hintId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Opened from the settings the page leaves the focus alone (FROM_LIST): it goes to this title, once.
    if (cameFromList(state)) title.current?.focus();
  }, []);

  // The active suppliers in the venue's order. ⚠️ The pseudo-supplier «No supplier» is not a document, so it is not here.
  const stored = useMemo<Row[]>(() => sortSuppliersByOrder(
    suppliers.filter(s => s.active !== false),
    config.supplierOrder,
    supplierLabel,
  ).map(s => ({ id: s.id, label: supplierLabel(s) })), [suppliers, config.supplierOrder]);

  // The order after a move, shown at once while the write is on its way; null follows the data.
  const [local, setLocal] = useState<readonly string[] | null>(null);
  const request = useRef(0);
  const [phase, setPhase] = useState<'idle' | 'saving' | 'saved'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  const rows = useMemo<Row[]>(() => {
    if (local === null) return stored;
    const byId = new Map(stored.map(row => [row.id, row] as const));
    const ordered = local.flatMap(id => byId.get(id) ?? []);
    // A supplier that arrived meanwhile goes last, as the data would put it.
    return [...ordered, ...stored.filter(row => !local.includes(row.id))];
  }, [stored, local]);

  const save = (ids: readonly string[]) => {
    request.current += 1;
    const mine = request.current;
    setLocal(ids);
    setPhase('saving');
    if (timer.current !== null) clearTimeout(timer.current);
    const settle = (ok: boolean) => {
      // A newer move owns the screen now.
      if (mine !== request.current) return;
      setLocal(null);
      if (ok) {
        setPhase('saved');
        timer.current = setTimeout(() => { timer.current = null; setPhase('idle'); }, SAVED_MS);
      } else {
        setPhase('idle');
        // ⚠️ THE LIST GOES BACK FIRST, THE NOTICE COMES AFTER IT HAS DRAWN: a modal that opens in the same render as a re-ordered grid
        // sends React Aria's hiding of the page behind it into a loop that never ends.
        setTimeout(() => { void alert({ message: t('ord.sequence.err'), okLabel: t('common.ok') }); }, 0);
      }
    };
    store.saveSetting({ kind: 'supplierOrder', ids }).then(outcome => { settle(outcome === 'saved' || outcome === 'unchanged'); }, () => { settle(false); });
  };

  const ids = rows.map(row => row.id);
  const labelOf = (id: string): string => rows.find(row => row.id === id)?.label ?? '';

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: keys => [...keys].map(key => ({ 'text/plain': labelOf(String(key)) })),
    onReorder: event => {
      const moved = [...event.keys][0];
      if (moved === undefined || !configLoaded) return;
      save(movedIds(ids, String(moved), String(event.target.key), event.target.dropPosition));
    },
    renderDropIndicator: target => <DropIndicator target={target} className={styles.indicator} />,
  });

  // ⚠️ THE FOCUS IS PUT BACK ON THE MOVED GRIP AFTER THE RENDER: a node that is moved in the page can lose the focus. The rows of a
  // GridList are built after the first layout, so a grip asked for before it exists is focused by its own ref.
  const grips = useRef(new Map<string, HTMLButtonElement>());
  const wanted = useRef<string | null>(null);
  const gripRefs = useRef(new Map<string, (node: HTMLButtonElement | null) => void>());
  const gripRef = (id: string) => {
    let ref = gripRefs.current.get(id);
    if (!ref) {
      ref = node => {
        if (node === null) {
          grips.current.delete(id);
          return;
        }
        grips.current.set(id, node);
        if (wanted.current === id) {
          wanted.current = null;
          node.focus();
        }
      };
      gripRefs.current.set(id, ref);
    }
    return ref;
  };
  const focusNow = useCallback((id: string) => {
    const node = grips.current.get(id);
    if (node) {
      wanted.current = null;
      node.focus();
    } else {
      wanted.current = id;
    }
  }, []);
  const [focusGrip, setFocusGrip] = useState<{ id: string } | null>(null);
  useEffect(() => {
    if (focusGrip === null) return undefined;
    focusNow(focusGrip.id);
    const frame = requestAnimationFrame(() => { focusNow(focusGrip.id); });
    return () => { cancelAnimationFrame(frame); };
  }, [focusGrip, focusNow]);

  // The list is described by the hint, and not the grips: a grip described by the hint would hide React Aria's own «Press Enter to
  // start dragging» from a screen reader. The attribute is set by hand because the list's drop handling hands the grid
  // `aria-describedby: null`, which wipes a prop passed to GridList.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => { gridRef.current?.setAttribute('aria-describedby', hintId); });

  const gripIdOf = (target: EventTarget): string | undefined => [...grips.current].find(([, node]) => node === target)?.[0];

  // ⚠️ THE DIRECT ARROWS ARE CAUGHT ABOVE THE LIST, IN THE CAPTURE PHASE, NOT ON THE GRIP: a grid row takes ArrowUp and ArrowDown in
  // its own capture handler, stops them and re-sends them to the list, so a handler on the grip never hears them. Every other key is
  // left alone, so Enter and Space reach React Aria's drag, and a drag under way owns the arrows. Every grip is its own tab stop: Tab
  // on a grip with a neighbour focuses that neighbour; at the first and last the key is let go.
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const id = gripIdOf(event.target);
    if (id === undefined) return;
    if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      const next = ids[ids.indexOf(id) + (event.shiftKey ? -1 : 1)];
      const node = next === undefined ? undefined : grips.current.get(next);
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
    if (!configLoaded) return;
    const at = ids.indexOf(id);
    const to = at + (event.key === 'ArrowUp' ? -1 : 1);
    const target = ids[to];
    if (target === undefined) return;
    save(movedIds(ids, id, target, event.key === 'ArrowUp' ? 'before' : 'after'));
    setFocusGrip({ id });
  };

  // A focus that lands on a ROW (Tab back into the list, a click, React Aria restoring the focus after a drop) is handed to that
  // row's grip. The drop indicators of a keyboard drag are not rows of ours, so they are left alone.
  const onFocusRow = (event: FocusEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute('role') !== 'row') return;
    const id = [...grips.current.keys()].find(candidate => candidate === target.getAttribute('data-key'));
    if (id !== undefined) grips.current.get(id)?.focus();
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('ord.sequence.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        <p id={hintId} className={styles.hint}>{t('ord.sequence.hint')}</p>
        {rows.length === 0 ? (
          <p className={styles.empty}>{t('ord.sequence.none')}</p>
        ) : (
          <I18nProvider locale={lang}>
            <div onKeyDownCapture={onKey} onFocusCapture={onFocusRow}>
              <GridList
                aria-labelledby={titleId}
                ref={gridRef}
                className={styles.list}
                items={rows}
                // ⚠️ React Aria caches each row's drawing by its item object: without this a row keeps what it drew at its OLD place.
                dependencies={[rows]}
                dragAndDropHooks={dragAndDropHooks}
              >
                {item => (
                  <GridListItem id={item.id} textValue={item.label} className={styles.row}>
                    <span className={styles.name}>{item.label}</span>
                    <Button slot="drag" ref={gripRef(item.id)} className={styles.grip} aria-label={t('ord.sequence.move', { name: item.label })}>
                      <GripVertical aria-hidden="true" />
                    </Button>
                  </GridListItem>
                )}
              </GridList>
            </div>
          </I18nProvider>
        )}
        <p role="status" className={styles.state}>
          {phase === 'saving' ? t('ord.sequence.saving') : phase === 'saved' ? t('settings.saved') : ''}
        </p>
      </div>
      {alertDialog}
    </section>
  );
}
