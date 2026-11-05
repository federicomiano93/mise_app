import { useId } from 'react';
import type { ReactNode } from 'react';
import { SettingSwitch } from './SettingSwitch';
import styles from './SettingsParts.module.css';

// The small pieces the editing screens of Settings (Extra dough, Divisor, Dough history) are made of.

// The sentence under the bar that says what the screen is for.
export function Help({ children }: { children: ReactNode }) {
  return <p className={styles.help}>{children}</p>;
}

// A card of rows.
export function Rows({ children }: { children: ReactNode }) {
  return <div className={styles.list}>{children}</div>;
}

// A name and the switch that goes with it. The switch is named by the words drawn beside it.
export function SwitchRow({ name, selected, onChange }: {
  name: string; selected: boolean; onChange: (selected: boolean) => void;
}) {
  const nameId = `${useId()}-name`;
  return (
    <div className={styles.row}>
      <span id={nameId} className={styles.name}>{name}</span>
      <SettingSwitch selected={selected} onChange={onChange} labelledBy={nameId} />
    </div>
  );
}

// A list with nothing in it, said quietly (not as an alarm).
export function Empty({ children }: { children: ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}
