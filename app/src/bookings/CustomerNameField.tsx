import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import { useT } from '../i18n/useT';
import { applyName, suggestNames } from './nameSuggestions';
import type { NameRow } from './nameSuggestions';
import styles from './CustomerNameField.module.css';

// The attributes the name's input gets, and the window to draw under it (see `useNameSuggest`).
export type NameSuggest = {
  fieldRef: RefObject<HTMLDivElement | null>;
  inputProps: {
    role: 'combobox';
    'aria-autocomplete': 'list';
    'aria-expanded': boolean;
    'aria-controls': string | undefined;
    'aria-activedescendant': string | undefined;
    onChange: (input: HTMLInputElement) => void;
    onSelect: (input: HTMLInputElement) => void;
    onBlur: () => void;
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
  };
  list: ReactNode;
};

// The common names offered under «Nome cliente» while it is typed (the owner's ask, 19 Nov 2026; Italian venues only: the lists
// are Italian names). Same pattern as Food cost's `NameSuggest` (a combobox that never picks by itself; Enter only on a row
// highlighted with the arrows; Escape and leaving the box close it), with three differences on purpose:
// ⚠️ A WINDOW OVER THE FORM, NOT IN ITS FLOW. Food cost's list pushes the fields below it down; here the owner asked for a window
// laid over them, so the form does not jump at every letter. It sits right under the box, as wide as the box.
// ⚠️ THE KEYBOARD CAN COVER IT. On a tablet or a phone the on-screen keyboard hides the lower part of the page, and the window with
// it. When it opens (or grows) and its bottom is below what the keyboard leaves visible, the field is scrolled up so the box sits
// near the top; a window that already fits makes the page stay still, letter after letter.
// ⚠️ A TAP ON IT MUST NOT CLOSE IT FIRST: touching a row would move the focus off the box, the blur would close the window and the
// tap would land on nothing — the window swallows the pointer going down, which keeps the focus (and the keyboard) where it is.
const caretAtEnd = (input: HTMLInputElement): boolean => input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

// The field is laid out in three columns from this width (px).
const WIDE_FIELD = 560;

// The space left between the form bar and the box when the field is scrolled up (px).
const GAP_UNDER_BAR = 8;

// The nearest ancestor that scrolls on its own (the tablet's detail column, else the shell's main), or null for the page itself.
function scrollerOf(node: HTMLElement): HTMLElement | null {
  for (let at = node.parentElement; at !== null; at = at.parentElement) {
    const overflow = getComputedStyle(at).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return at;
  }
  return null;
}

// ⚠️ THE FIT IS AGAINST THE SMALLER OF TWO BOTTOMS: what the keyboard leaves of the screen (the visual viewport) and the bottom of the
// scrolling column the form sits in, which CLIPS what hangs below it (measured on the lab tablet: with the keyboard up, 1.5 rows).
// The bar's real bottom is measured now: on a phone it wraps to two or three lines. The label may go under it, the box may not.
function bringIntoView(list: HTMLElement, field: HTMLElement): void {
  const scroller = scrollerOf(field);
  const viewport = window.visualViewport;
  const screenBottom = viewport ? viewport.offsetTop + viewport.height : window.innerHeight;
  const limit = scroller === null ? screenBottom : Math.min(screenBottom, scroller.getBoundingClientRect().bottom);
  if (list.getBoundingClientRect().bottom <= limit) return;
  const input = field.querySelector('input');
  if (input === null) return;
  const bar = field.closest('section')?.querySelector('header');
  const floor = bar ? bar.getBoundingClientRect().bottom : scroller === null ? 0 : scroller.getBoundingClientRect().top;
  const by = input.getBoundingClientRect().top - floor - GAP_UNDER_BAR;
  if (by <= 0) return;
  if (scroller === null) window.scrollBy({ top: by });
  else if (typeof scroller.scrollBy === 'function') scroller.scrollBy({ top: by });
  else scroller.scrollTop += by;
}

export function useNameSuggest({ enabled, value, maxLength, onChange }: {
  enabled: boolean;
  value: string;
  maxLength: number | undefined;
  onChange: (value: string) => void;
}): NameSuggest | null {
  const { t } = useT();
  const ids = useId();
  const listId = `${ids}-list`;
  const fieldRef = useRef<HTMLDivElement>(null);
  // Opened by typing; closed by leaving the box, Escape, a tap outside, or when the pick leaves nothing more to offer.
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  // Only while the caret is at the end of the text (`open` is closed by an edit or a move anywhere else): a pick in an earlier word
  // would replace the wrong one.
  const rows: NameRow[] = enabled && open ? suggestNames(value) : [];
  const shown = rows.length > 0;
  const activeRow = active >= 0 && active < rows.length ? active : -1;
  const listRef = useRef<HTMLDivElement>(null);

  // Wide enough for three columns? Measured on the field itself, not on the screen: the editor's width changes with the layout
  // (the tablet's form takes the whole width, a phone's is narrow), and a media query could not see it.
  const [wide, setWide] = useState(false);
  useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!enabled || field === null) return undefined;
    const measure = () => { setWide(field.offsetWidth >= WIDE_FIELD); };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const watcher = new ResizeObserver(measure);
    watcher.observe(field);
    return () => { watcher.disconnect(); };
  }, [enabled]);

  // The keyboard, or the form's own scroll column, may hide the window: when its bottom is lower than what can be seen, scroll so
  // the box sits just under the form bar. A window that already fits scrolls nothing (no jump at every letter).
  useLayoutEffect(() => {
    const list = listRef.current;
    const field = fieldRef.current;
    if (!shown || list === null || field === null) return;
    bringIntoView(list, field);
  }, [shown, rows.length, wide]);

  // A tap outside the field closes the window (a touch on a page that cannot take the focus does not blur the box).
  useEffect(() => {
    if (!shown) return undefined;
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && fieldRef.current?.contains(event.target)) return;
      setOpen(false);
      setActive(-1);
    };
    document.addEventListener('pointerdown', close);
    return () => { document.removeEventListener('pointerdown', close); };
  }, [shown]);

  if (!enabled) return null;

  const pick = (row: NameRow) => {
    setActive(-1);
    onChange(applyName(value, row, maxLength));
  };

  return {
    fieldRef,
    inputProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-expanded': shown,
      'aria-controls': shown ? listId : undefined,
      'aria-activedescendant': activeRow >= 0 ? `${ids}-${activeRow}` : undefined,
      onChange: input => {
        setOpen(caretAtEnd(input));
        setActive(-1);
        onChange(input.value);
      },
      // The caret moved (a tap, an arrow) into an earlier word: the window goes. It never opens from here, only typing opens it.
      onSelect: input => { if (!caretAtEnd(input)) setOpen(false); },
      onBlur: () => { setOpen(false); setActive(-1); },
      onKeyDown: event => {
        if (!shown) return;
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          setActive((activeRow + 1) % rows.length);
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          setActive(activeRow < 0 ? rows.length - 1 : (activeRow - 1 + rows.length) % rows.length);
        } else if (event.key === 'Enter' && activeRow >= 0) {
          // Not the form's submit: Enter on a highlighted row only picks it.
          event.preventDefault();
          const row = rows[activeRow];
          if (row) pick(row);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          setOpen(false);
          setActive(-1);
        }
      },
    },
    list: shown ? (
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={t('bookings.form.nameSuggest')}
        className={styles.window}
        data-wide={wide}
        onPointerDown={event => { event.preventDefault(); }}
        onMouseDown={event => { event.preventDefault(); }}
      >
        {rows.map((row, index) => (
          <div
            key={row.name}
            id={`${ids}-${index}`}
            role="option"
            aria-selected={index === activeRow}
            className={styles.row}
            data-active={index === activeRow}
            onClick={() => { pick(row); }}
          >
            {/* The letters already typed in bold, the rest in the normal weight. */}
            <strong className={styles.typed}>{row.name.slice(0, row.typedLetters)}</strong>
            <span>{row.name.slice(row.typedLetters)}</span>
          </div>
        ))}
      </div>
    ) : null,
  };
}
