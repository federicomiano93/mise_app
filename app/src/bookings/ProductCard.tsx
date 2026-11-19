import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatMoney } from '@mise/shared/price-model';
import { formatWeight } from '@mise/shared/price-list';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { LIMITS, boxNumber, effectiveUnit, linePack, parseQty } from './bookingModel';
import type { DraftLine, LinePrice } from './bookingModel';
import styles from './ProductCard.module.css';

type Props = {
  // 0-based; the circle says it 1-based, so the numbers follow the cards as one is taken away.
  index: number;
  line: DraftLine;
  price: LinePrice;
  // What the line comes to, or null (no price, or no readable quantity).
  amount: number | null;
  // The card itself (a jump to a line's name lands on it) and its quantity box.
  cardId: string;
  qtyId: string;
  nameError: string | null;
  qtyError: string | null;
  onChange: (patch: Partial<DraftLine>) => void;
  onRemove: () => void;
};

// One product of the booking, as a compact card (bookings rebuild step 2, 19 Nov 2026; the owner's design, approved on the
// tablet): its number in a black circle, «Scacciata broccoli · 1,5 kg», a small red bin; − / N / + (the + filled blue, the −
// off at 1) with the price of one and what the line comes to on the right; the line's note under it. The quantity can be typed
// too (thirty panettoni are not thirty presses). A line of kilos from an old booking says «kg» after its number.
export function ProductCard({ index, line, price, amount, cardId, qtyId, nameError, qtyError, onChange, onRemove }: Props) {
  const { t, locale } = useT();
  const money = useMoney();
  const n = index + 1;
  const unit = effectiveUnit(line, price);
  const qty = parseQty(line.qty, unit);
  const current = typeof qty === 'number' ? qty : null;
  const step = (by: number) => {
    const next = current === null ? 1 : Math.min(LIMITS.qty, Math.max(1, Math.round((current + by) * 1000) / 1000));
    onChange({ qty: boxNumber(next, money.layout.decimal) });
  };
  const pack = linePack(price);
  const detail = line.weightKg !== null
    ? formatWeight(line.weightKg, locale)
    : pack !== null
      ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }).format(pack.packSize)} ${pack.packUnit === 'pcs' ? t('bookings.unit.pcs') : pack.packUnit}`
      : null;
  const fullName = detail === null ? line.name : `${line.name} · ${detail}`;
  const errors = [nameError, qtyError].filter((text): text is string => text !== null);
  const errorId = `${qtyId}-error`;
  return (
    <div id={cardId} tabIndex={-1} className={styles.card} role="group" aria-label={t('bookings.card.label', { n, name: fullName })}>
      <div className={styles.top}>
        <span className={styles.number} aria-hidden="true">{n}</span>
        <p className={styles.name}>
          <span className={styles.strong}>{line.name}</span>
          {detail !== null ? <span className={styles.detail}>{` · ${detail}`}</span> : null}
        </p>
        <Button variant="bare" className={styles.remove} aria-label={t('bookings.card.remove', { name: fullName })} onPress={onRemove}>
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
      <div className={styles.row}>
        <div className={styles.stepper}>
          <Button
            variant="bare"
            className={`${styles.round} ${styles.less}`}
            aria-label={t('bookings.card.less', { name: fullName })}
            isDisabled={current !== null && current <= 1}
            onPress={() => { step(-1); }}
          >
            <Minus aria-hidden="true" />
          </Button>
          <input
            id={qtyId}
            className={styles.qty}
            value={line.qty}
            inputMode="decimal"
            autoComplete="off"
            maxLength={9}
            aria-label={t('bookings.card.qty', { name: fullName })}
            aria-invalid={qtyError !== null ? true : undefined}
            aria-describedby={errors.length > 0 ? errorId : undefined}
            onChange={event => { onChange({ qty: event.currentTarget.value }); }}
          />
          <Button
            variant="bare"
            className={`${styles.round} ${styles.more}`}
            aria-label={t('bookings.card.more', { name: fullName })}
            onPress={() => { step(1); }}
          >
            <Plus aria-hidden="true" />
          </Button>
          {unit === 'kg' ? <span className={styles.unit}>{t('bookings.unit.kg')}</span> : null}
        </div>
        {/* The line total only: the owner asked (19 Nov 2026) for no price of one piece on the card. */}
        {amount !== null ? (
          <div className={styles.money}>
            <span className={styles.amount}>{formatMoney(amount, money)}</span>
          </div>
        ) : null}
      </div>
      {errors.length > 0 ? <p id={errorId} className={styles.error}>{errors.join(' ')}</p> : null}
      <input
        className={styles.note}
        value={line.note}
        maxLength={LIMITS.lineNote}
        autoComplete="off"
        placeholder={t('bookings.card.notePlaceholder')}
        aria-label={t('bookings.card.note', { name: fullName })}
        onChange={event => { onChange({ note: event.currentTarget.value }); }}
      />
    </div>
  );
}
