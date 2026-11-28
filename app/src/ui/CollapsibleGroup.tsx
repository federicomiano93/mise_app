import { useId } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import styles from './CollapsibleGroup.module.css';

// One group of a grouped list (Food cost's cards under their category, the Ricettario's recipes under theirs): a framed card whose
// header is a button of 48px and more (name, how many inside, a chevron) that opens and closes the rows under it.
//
// ⚠️ THE OPEN STATE LIVES IN THE LIST, NOT HERE, so a snapshot that redraws the rows never closes a group, and the list can open the
// one the person is returning to. A closed group's rows stay in the page but `hidden`: nothing inside can take the focus, so a list
// that hands the focus back to a row opens that row's group first. `children` is the rows' list; it is drawn without a frame of its
// own (the group's is the frame).
export function CollapsibleGroup({ name, count, open, onToggle, children }: {
  name: string;
  count: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const bodyId = useId();
  return (
    <section className={styles.group}>
      <h2 className={styles.heading}>
        <button type="button" className={styles.button} aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
          <ChevronRight aria-hidden="true" className={styles.chevron} data-open={open} />
          <span className={styles.name}>{name}</span>
          <span className={styles.count}>{count}</span>
        </button>
      </h2>
      {/* data-collapsible-body: a list's handBack opens a closed group before it focuses one of its rows (recipes/handBack.ts). */}
      <div id={bodyId} className={styles.body} data-collapsible-body="" hidden={!open}>{children}</div>
    </section>
  );
}
