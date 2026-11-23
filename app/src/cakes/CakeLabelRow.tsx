import { ChevronRight } from 'lucide-react';
import type { Ref } from 'react';
import type { Cake } from '@mise/shared/cake-model';
import { allergenName, canPrintLabel, labelWord, outputLanguage } from '@mise/shared/market';
import { allergensOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useCakeLabel } from './useCakeLabel';
import styles from './CakeLabelRow.module.css';

type Props = {
  // The cake as it is on screen now (the working copy).
  cake: Cake;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

// «Cake label», the row under «Cost and price»: a card-looking button that opens the label's full-screen view, with one line saying whether
// the label can be made — «Contains: …» once it can, what is missing while it cannot. To be put inside the card's <h3>, as FoldTitle is.
//
// ⚠️ THE ALLERGEN NAMES ARE THE VENUE'S COUNTRY'S WORDS (`allergenName` with the output language, read while drawing), like the label itself;
// everything else in the line is the interface's.
export function CakeLabelRow({ cake, onOpen, buttonRef }: Props) {
  const { t } = useT();
  const { location } = useSession();
  const { answer, loaded, unreadable } = useCakeLabel(cake);
  const lang = outputLanguage(location);

  let summary: string;
  if (!allergensOn(location) || lang === null || !canPrintLabel(location)) summary = t('cakes.label.summaryOff');
  else if (unreadable) summary = t('cakes.label.summaryUnreadable');
  else if (!loaded) summary = t('cakes.label.summaryChecking');
  else if (answer.state === 'empty') summary = t('cakes.label.summaryEmpty');
  else if (answer.state === 'blocked') {
    summary = answer.blockedCards > 0 ? t('cakes.label.summaryBlocked', { n: answer.blockedCards }) : t('cakes.label.summaryNoWeights');
  } else if (answer.label.allergens.length === 0) summary = t('cakes.label.summaryNone');
  else {
    summary = t('cakes.label.summaryContains', {
      contains: labelWord('contains', lang),
      names: answer.label.allergens.map(code => allergenName(code, lang)).join(', '),
    });
  }

  return (
    <button ref={buttonRef} type="button" className={styles.row} onClick={onOpen}>
      <span className={styles.text}>
        <span>{t('cakes.label.title')}</span>
        <small className={styles.summary}>{summary}</small>
      </span>
      <ChevronRight aria-hidden="true" className={styles.chevron} />
    </button>
  );
}
