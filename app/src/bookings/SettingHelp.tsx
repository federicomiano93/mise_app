import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { HelpToggle } from '../ui/HelpToggle';
import styles from './SettingHelp.module.css';

// The «?» beside a setting's name in the bookings settings, and the tinted box it opens under the row (the owner's layout: no
// explanation sits on the page all the time). Closed at mount and never stored, like ui/HelpToggle's HelpHead.
export function useHelp(name: string, help: string | undefined): { toggle: ReactNode; box: ReactNode } {
  const textId = useId();
  const [open, setOpen] = useState(false);
  if (help === undefined) return { toggle: null, box: null };
  return {
    toggle: <HelpToggle title={name} open={open} controls={textId} onToggle={() => { setOpen(value => !value); }} />,
    box: <p id={textId} className={styles.help} hidden={!open}>{help}</p>,
  };
}
