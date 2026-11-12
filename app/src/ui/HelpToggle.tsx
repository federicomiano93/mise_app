import { useId, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from './Button';
import styles from './HelpToggle.module.css';

type ToggleProps = {
  // The section's title: it names the button («Explanation: Price»).
  title: string;
  open: boolean;
  // The id of the paragraph it opens.
  controls: string;
  onToggle: () => void;
};

// The «?» itself: 44 by 44, a bare button that wears no browser frame.
export function HelpToggle({ title, open, controls, onToggle }: ToggleProps) {
  const { t } = useT();
  return (
    <Button
      variant="bare"
      className={styles.toggle}
      aria-label={t('ui.explanation', { title })}
      aria-expanded={open}
      aria-controls={controls}
      onPress={onToggle}
    >
      <CircleHelp aria-hidden="true" className={styles.icon} />
    </Button>
  );
}

type HeadProps = {
  // The section's title: it is the heading itself, and names the button.
  title: string;
  // The explanation, shown under the heading while the «?» is pressed.
  help: string;
  // The heading's id, for the section that is labelled by it.
  titleId: string;
  // The summary's caption: a smaller, muted heading.
  quiet?: boolean;
};

// A section heading with its «?» (Federico, 11 Nov 2026): the explanation of a box never sits on the page all the time, it opens
// under the title when asked and closes with the same tap.
//
// ⚠️ CLOSED AT MOUNT AND NEVER STORED: a screen redrawn, a product opened again, starts with every explanation shut.
// ⚠️ A BUTTON, NOT A TOOLTIP: aria-expanded and aria-controls tell a screen reader what it opens, and Enter and Space work (React
// Aria). The paragraph is `hidden` while closed, so it is not read.
export function HelpHead({ title, help, titleId, quiet = false }: HeadProps) {
  const textId = useId();
  const [open, setOpen] = useState(false);
  return (
    <div className={`${styles.head} ${quiet ? styles.quiet : ''}`}>
      <div className={styles.row}>
        <h3 id={titleId} className={styles.title}>{title}</h3>
        <HelpToggle title={title} open={open} controls={textId} onToggle={() => { setOpen(value => !value); }} />
      </div>
      <p id={textId} className={styles.text} hidden={!open}>{help}</p>
    </div>
  );
}
