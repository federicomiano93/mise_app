import { useT } from '../i18n/useT';
import styles from './NoPriceMark.module.css';

// The crossed-out euro at the END of a recipe row's link line: Food cost cannot price this row (current app ff1a2d38, 28 Oct 2026;
// item 30). No words and no amount on screen — the name is for a screen reader. It sits INSIDE the link button, so the button reads
// «→ Salt · no price».
//
// ⚠️ THE NAME IS READ NOW, in the language of the moment (never frozen at load). The svg is `aria-hidden` and the name sits on the
// wrapper, which is a role="img": a screen reader says it once, whichever way it walks the button.
// Lucide's «euro» plus a slash, drawn by hand because Lucide has no crossed-out euro; the same drawing as the current app's.
export function NoPriceMark() {
  const { t } = useT();
  return (
    <span className={styles.mark} role="img" aria-label={t('cat.noPriceMark')}>
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 10h12" />
        <path d="M4 14h9" />
        <path d="M19 6a7.7 7.7 0 0 0-5.2-2A7.9 7.9 0 0 0 6 12c0 4.4 3.5 8 7.8 8 2 0 3.8-.8 5.2-2" />
        <path d="M3 3l18 18" />
      </svg>
    </span>
  );
}
