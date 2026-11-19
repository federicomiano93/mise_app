import { useEffect, useId, useRef, useState } from 'react';
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
    onChange: (value: string) => void;
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

  const rows: NameRow[] = enabled && open ? suggestNames(value) : [];
  const shown = rows.length > 0;
  const activeRow = active >= 0 && active < rows.length ? active : -1;
  const listRef = useRef<HTMLDivElement>(null);

  // The keyboard may cover the window: bring the field up, only when it would not fit.
  useEffect(() => {
    const list = listRef.current;
    const field = fieldRef.current;
    if (!shown || list === null || field === null || typeof field.scrollIntoView !== 'function') return;
    const visible = window.visualViewport?.height ?? window.innerHeight;
    if (list.getBoundingClientRect().bottom > visible) field.scrollIntoView({ block: 'start' });
  }, [shown, rows.length]);

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
      onChange: text => {
        setOpen(true);
        setActive(-1);
        onChange(text);
      },
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
