import { useId } from 'react';
import type { Ref } from 'react';
import { Button, Menu, MenuItem, MenuTrigger, Popover } from 'react-aria-components';
import styles from './RowMenu.module.css';

export type RowMenuItem = {
  readonly id: string;
  readonly text: string;
  // Why the item cannot be chosen; drawn under it and read with it. Only on a disabled item.
  readonly why?: string;
  readonly disabled: boolean;
};

type Props = {
  // The ingredient's name, as drawn on the row: the button's text.
  label: string;
  // Names the menu («Actions for Flour»).
  menuLabel: string;
  items: readonly RowMenuItem[];
  onAction: (id: string) => void;
  // The row asks for the button to press it for a tap anywhere on the row (RecipeView), and to put the focus back on it.
  buttonRef: Ref<HTMLButtonElement>;
};

// A recipe row's menu (Federico, 7 Nov 2026): the ingredient's name is the button, and a press opens a small menu anchored to it,
// with «Split into 2 parts» and «Order». React Aria's menu: arrow keys, Home / End, Escape closes and gives the focus back to the
// button, a press outside closes it, and the popover is placed by script (no Popover API: the lab tablet runs Chrome 101).
//
// ⚠️ A DISABLED ITEM SAYS WHY IN ITS OWN TEXT («Too small to split»), so the reason is read with the item. React Aria skips a
// disabled item with the arrow keys, which the current app did not (its item stayed focusable); the words are the same.
export function RowMenu({ label, menuLabel, items, onAction, buttonRef }: Props) {
  const nameId = useId();
  return (
    <MenuTrigger>
      <Button ref={buttonRef} className={styles.name}>{label}</Button>
      <Popover className={styles.popover} placement="bottom end" offset={4}>
        {/* ⚠️ React Aria names the menu by its button («Flour»); the current app's words say what the menu is («Actions for Flour»), so
            the menu points at its own name. A hidden element can name a control by reference. */}
        <span id={nameId} hidden>{menuLabel}</span>
        <Menu className={styles.menu} aria-labelledby={nameId} onAction={key => { onAction(String(key)); }}>
          {items.map(item => (
            <MenuItem key={item.id} id={item.id} textValue={item.text} isDisabled={item.disabled} className={styles.item}>
              <span className={styles.itemText}>{item.text}</span>
              {item.disabled && item.why !== undefined ? <span className={styles.why}>{item.why}</span> : null}
            </MenuItem>
          ))}
        </Menu>
      </Popover>
    </MenuTrigger>
  );
}
