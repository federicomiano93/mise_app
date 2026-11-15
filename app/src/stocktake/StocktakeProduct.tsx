import { useCallback, useEffect, useId, useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { consumption, isClosed, productsOfMonth } from '@mise/shared/inventory-model';
import type { InventoryMonth } from '@mise/shared/inventory-model';
import type { Money } from '@mise/shared/currency';
import { lineValue, parsePackSize } from '@mise/shared/inventory-value';
import { formatMoney } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { KEEP_FOCUS } from '../shell/Page';
import { FormBar } from '../ui/FormBar';
import { CountBox } from './CountBox';
import type { Product } from './countListModel';
import { productOpener, useHandBack } from './handBack';
import { useStocktake } from './StocktakeContext';
import { boxText, displayNumber, monthName } from './stocktakeFormat';
import { productLabel } from './stocktakeModel';
import { cameFromList, useLeave } from './stocktakeNav';
import { monthPath } from './stocktakePath';
import { blockerText, isPricedByUnit, packNoteText } from './productValue';
import styles from './StocktakeProduct.module.css';

type Props = { month: string; id: string };

// One product of the month: the answer at the top, the three numbers it is made of, and — for
// whoever runs the place — the weight of a pack, which is what turns a count into money.
//
// ⚠️ THE ANSWER IS AT THE TOP, NOT UNDER THE FIELDS. It is the reason the screen exists, and every
// box below changes it.
//
// ⚠️ AN EMPLOYEE COUNTS AND SEES NO MONEY (Federico, 13 Sep 2026): no value, no pack-weight box,
// no price in any note. The rules refuse an employee's write to the weight anyway.
//
// ⚠️ THE BOXES FOLLOW THE LIVE MONTH WHILE THEY DO NOT HAVE THE FOCUS (CountBox): a colleague's count
// appears, and the box being typed into is never written into. The answer and the pack note are
// drawn from the live month every time, so they never lag behind a box.
export function StocktakeProduct({ month: monthId, id }: Props) {
  const { t, locale } = useT();
  const { canManage } = useSession();
  const money = useMoney();
  const { state } = useLocation();
  const snapshot = useStocktake();
  const handBack = useHandBack();
  const ids = useId();
  const titleId = `${ids}-title`;
  const title = useRef<HTMLHeadingElement>(null);

  const { ingredients, ingredientsLoaded, monthLoaded } = snapshot;
  // The store answers one render late after the address changes: until it names this month there is
  // nothing to draw it from.
  const month = snapshot.monthId === monthId ? snapshot.month : null;
  const named = month !== null;
  // For an employee a refused month is the answer, not a hiccup (see StocktakeList).
  const refused = named && snapshot.monthFailed && !canManage;

  const products = useMemo(
    () => (month === null ? [] : productsOfMonth<Product>(month, ingredients)),
    [month, ingredients],
  );
  const product = products.find(candidate => candidate.id === id);
  // «Not in this month» is only said once the month and the ingredients have both answered: a
  // closed month's frozen list is not the live one, and the live one is all there is until then.
  const settled = named && ingredientsLoaded && monthLoaded;
  const shown = month !== null && ingredientsLoaded && product !== undefined;

  const onLeaving = useCallback(() => { handBack.expect(productOpener(id)); }, [handBack, id]);
  const leave = useLeave(monthPath(monthId), onLeaving);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title. Only
  // when the screen first appears — picking another product beside it (the split) keeps the focus
  // on the row that was pressed, like picking a day does.
  useEffect(() => {
    if (shown && !refused && cameFromList(state)) title.current?.focus();
  }, [shown, refused]);

  if (refused) {
    return (
      <section className={styles.product} aria-labelledby={titleId}>
        <FormBar
          backLabel={t('ui.back')}
          onBack={leave}
          title={monthName(monthId, locale)}
          titleId={titleId}
          titleRef={title}
        />
        <div className={styles.body}>
          <p className={styles.unavailable}>{t('stock.staffMonthUnavailable')}</p>
        </div>
      </section>
    );
  }

  if (month === null || product === undefined || !ingredientsLoaded) {
    // The month and the ingredients have answered and the product is not among the month's: an old
    // address. The month's list is where that leads.
    if (settled) return <Navigate to={monthPath(monthId)} replace state={KEEP_FOCUS} />;
    return (
      <section className={styles.product} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }

  const closed = isClosed(month);
  const line = consumption(month, product.id);
  const label = productLabel(product) || t('stock.unnamedProduct');
  const byUnit = isPricedByUnit(product);
  // The month's boxes cannot be typed into while it is closed, or until it has answered once.
  const shut = closed || !monthLoaded;

  const parsed = parsePackSize(product.weight);
  const packNote = canManage ? packNoteText(t, { month, product, closed, money, locale }) : '';
  const packId = `${ids}-packKg`;

  return (
    <section className={styles.product} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={leave}
        title={label}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.sub}>{monthName(monthId, locale)}</p>}
      />

      <div className={styles.body}>
        <Answer month={month} product={product} closed={closed} money={canManage ? money : null} />

        <Field
          inputId={`${ids}-opening`}
          label={t('stock.openingCount')}
          hint={t('stock.openingHint')}
        >
          {describedBy => (
            <CountBox
              key={`${product.id}:opening`}
              id={product.id}
              map="opening"
              inputId={`${ids}-opening`}
              describedBy={describedBy}
              value={line.opening}
              disabled={shut}
            />
          )}
        </Field>

        <Field
          inputId={`${ids}-purchased`}
          label={t('stock.purchasedCount')}
          hint={t('stock.purchasedHint')}
        >
          {describedBy => (
            // ⚠️ Purchased is the one field whose absence means zero, so it is shown as an empty
            // box and not as a 0 nobody typed: the answer above already counts it as none, and the
            // hint says so.
            <CountBox
              key={`${product.id}:purchased`}
              id={product.id}
              map="purchased"
              inputId={`${ids}-purchased`}
              describedBy={describedBy}
              value={month.purchased[product.id] ?? null}
              disabled={shut}
            />
          )}
        </Field>

        <Field
          inputId={`${ids}-closing`}
          label={t('stock.closingCount')}
          hint={t('stock.closingHint')}
        >
          {describedBy => (
            <CountBox
              key={`${product.id}:closing`}
              id={product.id}
              map="closing"
              inputId={`${ids}-closing`}
              describedBy={describedBy}
              value={line.closing}
              disabled={shut}
            />
          )}
        </Field>

        {/* ⚠️ THE ONE FIELD THAT IS NOT A COUNT, and the only place the app can be told what a pack
            weighs. It travels with the month and is carried forward, so it is typed once ever. Left
            empty, the app reads the product's own pack text. A product priced by the piece or per
            case has no such box (its note stands alone); an employee has neither. */}
        {canManage && !byUnit ? (
          <Field inputId={packId} label={t('stock.packKgLabel')} hint={packNote}>
            {describedBy => (
              <CountBox
                key={`${product.id}:packKg`}
                id={product.id}
                map="packKg"
                inputId={packId}
                describedBy={describedBy}
                // No suggestion on a closed month: it would offer a weight the month will never use,
                // in a box that cannot be typed into.
                placeholder={closed || parsed === null ? undefined : boxText(parsed, locale)}
                value={month.packKg[product.id] ?? null}
                disabled={shut}
              />
            )}
          </Field>
        ) : null}
        {canManage && byUnit ? <p className={styles.hint}>{packNote}</p> : null}

        <p className={styles.note}>{t('stock.emptyIsNotZero')}</p>
      </div>
    </section>
  );
}

// A box with its label above it and its hint under it. The hint describes the box for a screen
// reader; the label is a real <label>, so a tap on it reaches the box.
function Field({ inputId, label, hint, children }: {
  inputId: string;
  label: string;
  hint: string;
  children: (describedBy: string) => ReactNode;
}) {
  const hintId = `${inputId}-hint`;
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={inputId}>{label}</label>
      {children(hintId)}
      <p id={hintId} className={styles.hint}>{hint}</p>
    </div>
  );
}

// What the month says about this product: the number it used, how that was worked out, what it cost
// (only when `money` is given: whoever runs the place) and a warning when it cannot be right.
//
// ⚠️ A NEGATIVE ANSWER IS SHOWN, NOT HIDDEN. More left than could possibly be there means a number
// is wrong somewhere, and that is worth saying on the screen where it can be corrected.
function Answer({ month, product, closed, money }: {
  month: InventoryMonth;
  product: Product;
  closed: boolean;
  money: Money | null;
}) {
  const { t, locale } = useT();
  const line = consumption(month, product.id);
  const unit = typeof product.unit === 'string' && product.unit !== '' ? product.unit : t('stock.packsShort');
  const state = line.used === null ? 'unknown' : line.used < 0 ? 'negative' : 'known';

  let value: { text: string; known: boolean } | null = null;
  if (money !== null && line.used !== null) {
    const { value: worth, blocker } = lineValue(month, product, line.used, closed);
    value = worth === null
      ? { text: blockerText(t, blocker), known: false }
      : { text: formatMoney(worth, money), known: true };
  }

  return (
    <div className={styles.answer} data-state={state}>
      <p className={styles.answerLabel}>{t('stock.usedThisMonth')}</p>
      <p className={styles.answerValue}>
        {line.used === null ? '—' : `${displayNumber(line.used, locale)} ${unit}`}
      </p>
      {line.used === null ? (
        <p className={styles.answerWhy}>{line.counted ? t('stock.answerNeedsOpening') : t('stock.answerNeedsCount')}</p>
      ) : (
        <>
          <p className={styles.answerBasis}>
            {t('stock.hadBoughtLeft', {
              had: displayNumber(line.opening, locale),
              bought: displayNumber(line.purchased, locale),
              left: displayNumber(line.closing, locale),
            })}
          </p>
          {value === null ? null : (
            // What that consumption cost when the app has both halves of the sum; a row it cannot
            // value says which of the two jobs would fix it, instead of a blank nobody can act on.
            <p className={value.known ? styles.answerMoney : styles.answerWhy}>{value.text}</p>
          )}
          {line.used < 0 ? <p className={styles.answerWarn}>{t('stock.moreThanPossible')}</p> : null}
        </>
      )}
    </div>
  );
}
