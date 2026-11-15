import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import styles from './FoldedGroup.module.css';

// A folded group at the foot of a list: the suppliers' «Not in use (N)» (3e-5b, the items switched off) and the recipes'
// «Archived (N)». The rows are never hidden, only put last and folded. The caller draws the title (it owns the words).
//
// ⚠️ THE OPEN STATE LIVES IN THE LIST (useFoldedOpen), NOT HERE, so a snapshot that redraws the rows never closes it.
// ⚠️ A ROW INSIDE A CLOSED <details> CANNOT TAKE THE FOCUS: the list opens the group by itself when the person needs a row of
// it (the item open beside the list, a search that finds one), and stays open until the person closes it.
export function FoldedGroup({ title, open, onToggle, children }: {
  title: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <details className={styles.group} open={open} onToggle={event => { onToggle(event.currentTarget.open); }}>
      <summary className={styles.title}>
        <ChevronDown aria-hidden="true" className={styles.chevron} />
        <span>{title}</span>
      </summary>
      {children}
    </details>
  );
}

// The open state of the group. `wanted` is «a row of the group is needed now»: the moment it turns true the group opens (and
// stays open until the person closes it, even while `wanted` stays true). A row the focus is handed back to opens it through
// handBack.ts, whose toggle event lands in `onToggle`.
// `resetKey` folds it again when it changes: the supplier screen stays mounted from one supplier to the next on the split.
export function useFoldedOpen(wanted: boolean, resetKey = ''): { open: boolean; onToggle: (open: boolean) => void } {
  const [open, setOpen] = useState(false);
  const [wasWanted, setWasWanted] = useState(false);
  const [key, setKey] = useState(resetKey);
  if (key !== resetKey) {
    setKey(resetKey);
    setOpen(false);
  }
  if (wanted !== wasWanted) {
    setWasWanted(wanted);
    if (wanted) setOpen(true);
  }
  return { open, onToggle: setOpen };
}
