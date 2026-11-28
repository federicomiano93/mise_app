import { useState } from 'react';
import { Calculator, ChevronRight } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { PocketCalculator } from './PocketCalculator';
import styles from './CalculatorCard.module.css';

// «Calcolatrice» on the Home: one row that opens the pocket calculator (PocketCalculator.tsx). Home only; nothing is kept.
export function CalculatorCard() {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="bare" className={styles.card} onPress={() => { setOpen(true); }}>
        <Calculator className={styles.icon} aria-hidden="true" />
        <span className={styles.label}>{t('pocket.title')}</span>
        <ChevronRight className={styles.chevron} aria-hidden="true" />
      </Button>
      {open ? <PocketCalculator onClose={() => { setOpen(false); }} /> : null}
    </>
  );
}
