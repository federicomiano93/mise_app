import { useId } from 'react';
import type { Ref } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../ui/Button';
import styles from './SettingsRow.module.css';

type Common = {
  title: string;
  // One sentence under the title.
  sub?: string;
  // Drawn in the amber of «to check» (tokens.css): a holiday in progress. The words say it too; colour is never the only signal.
  warn?: boolean;
};

type AsLink = Common & {
  to: string;
  state?: unknown;
  // Called as the door is pressed (before the navigation).
  onOpen?: () => void;
  ref?: Ref<HTMLAnchorElement>;
};

type AsButton = Common & {
  onPress: () => void;
  ref?: Ref<HTMLButtonElement>;
};

// One row of a Settings card: the title, a sentence under it and a chevron, as tall as a thumb's target, the WHOLE row being the
// target. A door to another screen is a link (an address of its own); a row that opens a dialog is a button. Both are named by their
// title and DESCRIBED by the sentence, so a screen reader says the title and then, after a pause, what it is for.
export function SettingsRow(props: AsLink | AsButton) {
  const titleId = useId();
  const subId = useId();
  const { title, sub, warn = false } = props;
  const className = warn ? `${styles.row} ${styles.warn}` : styles.row;
  const inside = (
    <>
      <span className={styles.text}>
        <span id={titleId} className={styles.title}>{title}</span>
        {sub === undefined ? null : <span id={subId} className={styles.sub}>{sub}</span>}
      </span>
      <ChevronRight className={styles.chevron} aria-hidden="true" />
    </>
  );
  const described = sub === undefined ? undefined : subId;

  if ('to' in props) {
    return (
      <Link ref={props.ref} to={props.to} state={props.state} onClick={props.onOpen} className={className} aria-labelledby={titleId} aria-describedby={described}>
        {inside}
      </Link>
    );
  }
  return (
    <Button ref={props.ref} variant="bare" className={className} onPress={props.onPress} aria-labelledby={titleId} aria-describedby={described}>
      {inside}
    </Button>
  );
}
