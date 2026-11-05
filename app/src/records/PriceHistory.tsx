import { useEffect, useId, useRef, useState } from 'react';
import { formatPricePerUnit } from '@mise/shared/price-model';
import type { Money } from '@mise/shared/currency';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { sharedTranslate } from './priceCardModel';
import styles from './IngredientCard.module.css';

type Entry = Readonly<Record<string, unknown>>;

type Props = {
  id: string;
  money: Money;
  read(id: string): Promise<readonly Entry[]>;
  // Said when the read failed (the card shows the app's alert); the button is back by then.
  onFailed(): void;
};

// "10 Aug 2026" from an ISO stamp; anything unreadable falls back to the raw value (the current app's shortDate).
function shortDate(iso: unknown, locale: string): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return String(iso ?? '');
  return date.toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

// The append-only record of what an ingredient has cost (parity C25), loaded only when asked for: a separate read per
// ingredient that nobody fixing a spelling should pay for (P14). Existing items only; the merge button is step 3e-7.
export function PriceHistory({ id, money, read, onFailed }: Props) {
  const { t, locale } = useT();
  const labelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [state, setState] = useState<'idle' | 'loading' | readonly Entry[]>('idle');
  // The button the person pressed is gone once the answer is drawn: focus moves to the answer, not back to the page (P18).
  const answer = useRef<HTMLElement | null>(null);
  const answered = typeof state !== 'string';
  useEffect(() => {
    if (answered) answer.current?.focus();
  }, [answered]);

  function show() {
    if (state !== 'idle') return;
    setState('loading');
    read(id).then(entries => {
      if (mounted.current) setState(entries);
    }, (error: unknown) => {
      console.error('Loading the price history failed:', error);
      if (!mounted.current) return;
      setState('idle');
      onFailed();
    });
  }

  const shared = sharedTranslate(t);
  return (
    <div role="group" aria-labelledby={labelId} className={styles.history}>
      <span id={labelId} className={styles.label}>{t('sup.price.history')}</span>
      {typeof state === 'string' ? (
        <Button
          ref={button}
          variant="quiet"
          isDisabled={state === 'loading'}
          onPress={show}
        >
          {t(state === 'loading' ? 'sup.price.history.loading' : 'sup.price.history.show')}
        </Button>
      ) : state.length === 0 ? (
        <p ref={node => { answer.current = node; }} tabIndex={-1} className={styles.hint}>{t('sup.price.history.empty')}</p>
      ) : (
        <ul ref={node => { answer.current = node; }} tabIndex={-1} aria-labelledby={labelId} className={styles.historyList}>
          {state.map((entry, index) => (
            <li key={String(entry.id ?? index)} className={styles.historyRow}>
              <span>{formatPricePerUnit(entry, money, shared)}</span>
              <span>
                {entry.source === 'invoice' ? <span className={styles.historyTag}>{t('sup.price.history.fromInvoice')}</span> : null}
                {shortDate(entry.recordedAt, locale)}
              </span>
              {typeof entry.packLabel === 'string' && entry.packLabel ? <span className={styles.historyPack}>{entry.packLabel}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
