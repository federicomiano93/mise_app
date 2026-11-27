import { Pencil, Printer } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import styles from './BookBand.module.css';

// The controls of the book's title line, for whoever runs the place only (the section decides): the pencil, «Choose the products», and
// the one primary action, Print.
//
// ⚠️ UNDER 700px ICONS ALONE, FROM 700px ICON AND WORDS, BY THE SAME TEXT: the words are base.css's `visually-hidden` (they stay in the
// DOM, so the accessible name IS the visible text where it is shown, and never an aria-label that says something else) and are drawn
// from 700px. The icon and its words sit on one flex row, centred on each other.
type Props = { canPrint: boolean; onChoose: () => void; onPrint: () => void };

export function BookBand({ canPrint, onChoose, onPrint }: Props) {
  const { t } = useT();
  return (
    <>
      <Button variant="bare" className={styles.action} onPress={onChoose}>
        <Pencil aria-hidden="true" />
        <span className={`visually-hidden ${styles.words}`}>{t('allergenBook.choose')}</span>
      </Button>
      <Button variant="bare" className={`${styles.action} ${styles.primary}`} isDisabled={!canPrint} onPress={onPrint}>
        <Printer aria-hidden="true" />
        <span className={`visually-hidden ${styles.words}`}>{t('allergenBook.print')}</span>
      </Button>
    </>
  );
}
