import { useId } from 'react';
import type { ReactNode } from 'react';
import { AVERAGED_PRICE_JUMP_LIMIT, CHECK_REASONS } from '@mise/shared/invoice-import-model';
import { bucketOf, invoiceCount, needsConfirmation } from '@mise/shared/invoice-import-plan';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import { useT } from '../../i18n/useT';
import {
  ASK_NEW, ASK_NONE, ASK_SKIP, decisionOfQuestion, questionValue, sameValue,
} from './ingredientAnswers';
import type { IngredientDecision } from './ingredientAnswers';
import { STATUS, codeKeys, isIngredientStatus, reasonKey } from './importWords';
import styles from './InvoiceImportScreen.module.css';

const CREATE = 'create';
const FORGET = 'forget';
const HOLD = 'hold';
const USE = 'use';
const KEEP = 'keep';
const SAVE = 'save';

type Props = {
  entry: PlanEntry;
  // The supplier's name and the price as the row shows them (worked out by the step: they need the venue's suppliers, prices, money).
  supplierName: string;
  priceText: string;
  // What the person has answered so far on this row.
  decision: unknown;
  forgotten: boolean;
  confirmed: boolean;
  renameChosen: boolean;
  onDecision: (decision: IngredientDecision | null) => void;
  onForget: (forget: boolean) => void;
  onConfirm: (use: boolean) => void;
  onRename: (pair: { stored: string; file: string } | null) => void;
};

// 2026-09-12 → «12/09/2026», in the INTERFACE language, from the calendar date itself (never moved by the time zone).
function shortDate(iso: unknown, locale: string): string {
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return String(iso ?? '');
  return new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(y, m - 1, d)));
}

// One ingredient of the file, as step 3 shows it: who it is, what Mise makes of it (a WORD in a pill), why, and what the person
// may answer — in THIS order: the new-row choice, the question, «This price?», the invoice name.
export function IngredientRow({
  entry, supplierName, priceText, decision, forgotten, confirmed, renameChosen, onDecision, onForget, onConfirm, onRename,
}: Props) {
  const { t, locale } = useT();
  const nameId = useId();
  const { planned, row } = entry;
  const invoices = invoiceCount(planned);
  const meta = [supplierName, priceText, invoices > 0 ? t('sup.imp.invoices', { n: invoices }) : ''].filter(Boolean).join(' · ');

  // A wanted ingredient with no price of its own is told apart by a pill of its own. (A «do not import» answer on such a row
  // keeps the Skipped pill it always had: review 11.)
  const needsCheck = bucketOf(entry) === 'check'
    && (['new', 'unchanged'].includes(row.status) || row.held === true || needsConfirmation(row) || Boolean(row.invoiceRename));
  const status = needsCheck ? STATUS.check : (isIngredientStatus(row.status) ? STATUS[row.status] : null);

  // Why a price waits for a look (the model's checkOf): one sentence, the date in the person's format.
  const checkText = (): string => {
    if (row.checkReason === CHECK_REASONS.WEIGHT_UNREADABLE) return t('sup.imp.check.weightUnreadable');
    if (row.checkReason === CHECK_REASONS.WEIGHT_RESCALED) {
      return t('sup.imp.check.weightRescaled', { stored: row.checkStored ?? '', file: row.checkFile ?? '' });
    }
    if (row.checkReason === CHECK_REASONS.PRICE_JUMP) {
      return t('sup.imp.check.priceJump', { limit: Math.round(AVERAGED_PRICE_JUMP_LIMIT * 100) });
    }
    if (row.checkReason === CHECK_REASONS.OLDER_INVOICE) {
      // ⚠️ THE ROW'S CURRENT STATUS DECIDES (review R7): a NEW row answered «do not import» is no longer created.
      return t(row.status === 'new' ? 'sup.imp.check.olderInvoiceNew' : 'sup.imp.check.olderInvoice', { date: shortDate(row.checkDate, locale) });
    }
    return '';
  };

  const why = row.reason || planned.reason;
  const asks = planned.status === 'maybe-duplicate' || planned.status === 'choose';
  const pair = row.invoiceRename;

  return (
    <li className={styles.row} aria-labelledby={nameId}>
      <div className={styles.rowTop}>
        <div className={styles.rowMain}>
          <span id={nameId} className={styles.name}>{planned.name || planned.key}</span>
          <span className={styles.meta}>{meta}</span>
        </div>
        {status ? <span className={styles.pill} data-tone={status.tone}>{t(status.key)}</span> : null}
      </div>
      {why ? <p className={styles.reason}>{t(reasonKey(why))}</p> : null}
      {planned.priceCheck ? <p className={styles.reason}>{codeKeys(planned.priceCheck).map(key => t(key)).join(' · ')}</p> : null}
      {row.checkReason ? <p className={styles.reason}>{checkText()}</p> : null}
      {row.codesFull ? <p className={styles.reason}>{t(reasonKey('codes-full'))}</p> : null}
      {/* A NEW ingredient from the invoices: create it (the default, never blocking the button) or leave it out and remember that,
          so the next import does not offer it again. */}
      {planned.status === 'new' ? (
        <Choice label={t('sup.imp.choose')} value={forgotten ? FORGET : CREATE} onChange={value => { onForget(value === FORGET); }}>
          <option value={CREATE}>{t('sup.imp.ing.create')}</option>
          <option value={FORGET}>{t('sup.imp.ing.forget')}</option>
        </Choice>
      ) : null}
      {asks ? (
        <Choice label={t('sup.imp.choose')} value={questionValue(decision)} onChange={value => { onDecision(decisionOfQuestion(value)); }}>
          <option value={ASK_NONE}>{t('sup.imp.choosePlaceholder')}</option>
          {(planned.candidates ?? []).map(candidate => (
            <option key={candidate.id} value={sameValue(candidate.id)}>{t('sup.imp.sameAs', { name: candidate.label })}</option>
          ))}
          {/* An «unisci con …» row named the ingredient it belongs to: a new one is not on offer. */}
          {planned.mergeWith ? null : <option value={ASK_NEW}>{t('sup.imp.ing.createNew')}</option>}
          <option value={ASK_SKIP}>{t('sup.imp.skip')}</option>
        </Choice>
      ) : null}
      {/* A matched row whose price needs a look writes nothing until the person says «Use this price». It comes AFTER the question
          (a question answered «Same as X» can get a reason too). */}
      {row.checkReason && (row.held || needsConfirmation(row)) ? (
        <Choice label={t('sup.imp.ing.confirm.label')} value={confirmed ? USE : HOLD} onChange={value => { onConfirm(value === USE); }}>
          <option value={HOLD}>{t('sup.imp.ing.confirm.hold')}</option>
          <option value={USE}>{t('sup.imp.ing.confirm.use')}</option>
        </Choice>
      ) : null}
      {/* ⚠️ THE SUPPLIER RENAMED THE PRODUCT (same main article code): said in its own sentence, whatever else the row says, and
          saved only if the person picks it. A price confirmation above never saves a name. */}
      {pair ? (
        <>
          <p className={styles.reason}>{t('sup.imp.check.invoiceNameChanged', { old: pair.stored, new: pair.file })}</p>
          <Choice label={t('sup.imp.ing.rename.label')} value={renameChosen ? SAVE : KEEP}
            onChange={value => { onRename(value === SAVE ? { stored: pair.stored, file: pair.file } : null); }}>
            <option value={KEEP}>{t('sup.imp.ing.rename.keep')}</option>
            <option value={SAVE}>{t('sup.imp.ing.rename.save')}</option>
          </Choice>
        </>
      ) : null}
    </li>
  );
}

// A select with its visible label.
function Choice({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className={styles.choice}>
      <label htmlFor={id} className={styles.choiceLabel}>{label}</label>
      <select id={id} className={styles.select} value={value} onChange={event => { onChange(event.target.value); }}>{children}</select>
    </div>
  );
}
