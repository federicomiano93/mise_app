import { useId } from 'react';
import type { ReactNode } from 'react';
import { ToggleButton, ToggleButtonGroup } from 'react-aria-components';
import styles from './LabelSettings.module.css';

export type Choice<T> = { readonly value: T; readonly text: string };

type Props<T> = {
  // The words above the group; they also name the group for a screen reader.
  label: string;
  choices: readonly Choice<T>[];
  // The chosen one, or null when none of them is (never the case for a group that must show an answer).
  selected: T | null;
  onSelect: (value: T) => void;
  // The note under the group, read after its name.
  note?: string;
  // Under the group: the custom size's two boxes.
  children?: ReactNode;
};

// A single choice among a few buttons side by side (the paper, the printer, the resolution, the kind of date):
// React Aria's toggle button group, one selected at all times, arrow keys inside it, every button a thumb's height.
// The choices are told apart by their position, never by parsing their words back.
export function SegmentedChoice<T>({ label, choices, selected, onSelect, note, children }: Props<T>) {
  const ids = useId();
  const labelId = `${ids}-label`;
  const noteId = `${ids}-note`;
  const keyOf = (index: number): string => `${ids}-${index}`;
  const chosen = choices.findIndex(choice => choice.value === selected);
  return (
    <div className={styles.block}>
      <p id={labelId} className={styles.blockLabel}>{label}</p>
      <ToggleButtonGroup
        className={styles.segments}
        aria-labelledby={labelId}
        aria-describedby={note === undefined ? undefined : noteId}
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={chosen < 0 ? [] : [keyOf(chosen)]}
        onSelectionChange={keys => {
          const key = [...keys][0];
          const index = choices.findIndex((_, i) => keyOf(i) === key);
          const choice = choices[index];
          if (choice !== undefined) onSelect(choice.value);
        }}
      >
        {choices.map((choice, index) => (
          <ToggleButton key={keyOf(index)} id={keyOf(index)} className={styles.segment}>{choice.text}</ToggleButton>
        ))}
      </ToggleButtonGroup>
      {children}
      {note === undefined ? null : <p id={noteId} className={styles.note}>{note}</p>}
    </div>
  );
}
