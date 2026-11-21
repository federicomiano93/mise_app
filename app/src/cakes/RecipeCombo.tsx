import { useRef, useState } from 'react';
import type { Ref } from 'react';
import { Button, ComboBox, Input, ListBox, ListBoxItem, Popover } from 'react-aria-components';
import { ChevronDown, Search } from 'lucide-react';
import { filterByName, matchSpans } from './cakeStepsModel';
import styles from './RecipeCombo.module.css';

export type ComboOption = {
  id: string;
  name: string;
  // A second, smaller line («per kg» figures, or why the option cannot be chosen).
  sub: string;
  // Listed but not choosable (the card is already in this part, or would loop).
  off: boolean;
};

type Props = {
  // The box's name for a screen reader («Search a recipe for Base»).
  label: string;
  placeholder: string;
  options: readonly ComboOption[];
  // What the list says when the typed letters match nothing, and the arrow button's name.
  emptyText: string;
  openLabel: string;
  onPick: (id: string) => void;
  inputRef?: Ref<HTMLInputElement>;
};

// The name with the typed letters marked, accents and capitals ignored.
function Highlighted({ name, query }: { name: string; query: string }) {
  return (
    <span className={styles.name}>
      {matchSpans(name, query).map((span, index) => (span.match ? <mark key={index} className={styles.mark}>{span.text}</mark> : <span key={index}>{span.text}</span>))}
    </span>
  );
}

// A search box with a list under it (React Aria's combo box: arrows, Enter, Escape, the list is named and announced). A tap opens
// every option, typing narrows them, and choosing one hands its id up and EMPTIES the box: what was chosen is shown by the row that
// appears, never by the box.
export function RecipeCombo({ label, placeholder, options, emptyText, openLabel, onPick, inputRef }: Props) {
  const [text, setText] = useState('');
  // ⚠️ React Aria writes the chosen option's name into the box when a choice is made; the box must stay empty, whichever of the two
  // events (the text change, the choice) arrives first.
  const justPicked = useRef(false);
  const shown = filterByName(options, text);

  return (
    <ComboBox
      className={styles.combo}
      aria-label={label}
      items={shown}
      inputValue={text}
      onInputChange={value => { if (justPicked.current) return; setText(value); }}
      selectedKey={null}
      onSelectionChange={key => {
        if (key === null) return;
        justPicked.current = true;
        setTimeout(() => { justPicked.current = false; }, 0);
        setText('');
        onPick(String(key));
      }}
      menuTrigger="focus"
      allowsEmptyCollection
    >
      <div className={styles.field}>
        <Search className={styles.icon} aria-hidden="true" />
        <Input ref={inputRef} className={styles.input} placeholder={placeholder} />
        <Button className={styles.arrow} aria-label={openLabel}>
          <ChevronDown aria-hidden="true" />
        </Button>
      </div>
      {/* The list is as wide as the box (React Aria sets --trigger-width on the popover; it is not one of the design tokens, so the stylesheet cannot name it). */}
      <Popover className={styles.popover} style={{ width: 'var(--trigger-width)' }} placement="bottom start" offset={4}>
        <ListBox className={styles.list} renderEmptyState={() => <p className={styles.empty}>{emptyText}</p>}>
          {shown.map(option => (
            <ListBoxItem key={option.id} id={option.id} textValue={option.name} isDisabled={option.off} className={styles.item}>
              <Highlighted name={option.name} query={text} />
              {option.sub === '' ? null : <span className={styles.sub}>{option.sub}</span>}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </ComboBox>
  );
}
