import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { useT } from '../i18n/useT';
import styles from './NotInUseGroup.module.css';

// The folded group «Not in use (N)» at the bottom of an ingredient or packaging list (3e-5b): the items switched off with
// «Not in use at the moment». They are never hidden, only put last and folded.
//
// ⚠️ THE OPEN STATE LIVES IN THE LIST (useNotInUseOpen), NOT HERE, so a snapshot that redraws the rows never closes it.
// ⚠️ A ROW INSIDE A CLOSED <details> CANNOT TAKE THE FOCUS: the list opens the group by itself when the person needs a row of
// it (the item open beside the list, a search that finds one), and stays open until the person closes it.
export function NotInUseGroup({ count, open, onToggle, children }: {
  count: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}) {
  const { t } = useT();
  return (
    <details className={styles.group} open={open} onToggle={event => { onToggle(event.currentTarget.open); }}>
      <summary className={styles.title}>
        <ChevronDown aria-hidden="true" className={styles.chevron} />
        <span>{t('sup.notInUseGroup', { n: count })}</span>
      </summary>
      {children}
    </details>
  );
}

// The open state of the group. `wanted` is «a row of the group is needed now»: the moment it turns true the group opens (and
// stays open until the person closes it, even while `wanted` stays true). `show` opens it on demand.
export function useNotInUseOpen(wanted: boolean): { open: boolean; onToggle: (open: boolean) => void; show: () => void } {
  const [open, setOpen] = useState(false);
  const [wasWanted, setWasWanted] = useState(false);
  if (wanted !== wasWanted) {
    setWasWanted(wanted);
    if (wanted) setOpen(true);
  }
  const show = useCallback(() => { setOpen(true); }, []);
  return { open, onToggle: setOpen, show };
}
