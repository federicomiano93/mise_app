import { ChevronDown } from 'lucide-react';
import type { Ref } from 'react';
import styles from './FoldTitle.module.css';

type Props = {
  // The title's words, and the one summary line shown under them while the card is folded.
  title: string;
  summary: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  // The id of the folding body (`aria-controls`); the body is only on the page while the card is open.
  bodyId: string;
  buttonRef?: Ref<HTMLButtonElement>;
};

// The title of a card that folds (Measures, Parts, Cost and price): a full-width 48px button with a chevron, to be put inside the card's
// <h3>. Folded, the card says what it holds in one line under the title.
export function FoldTitle({ title, summary, open, onToggle, bodyId, buttonRef }: Props) {
  return (
    <button ref={buttonRef} type="button" className={styles.fold} aria-expanded={open} aria-controls={bodyId} onClick={() => { onToggle(!open); }}>
      <span className={styles.foldText}>
        <span>{title}</span>
        {open ? null : <small className={styles.foldSummary}>{summary}</small>}
      </span>
      <ChevronDown aria-hidden="true" className={styles.chevron} data-open={open} />
    </button>
  );
}
