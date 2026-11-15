import { useId } from 'react';
import type { Ref } from 'react';
import type { SupplierPlanEntry } from '@mise/shared/invoice-import-model';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/useT';
import type { StoredDoc } from '../suppliersSource';
import { SUPPLIER_STATUS, isSupplierStatus, supplierReasonKey } from './importWords';
import {
  CHOICE_NEW, CHOICE_NONE, CHOICE_SKIP, choiceOf, decisionOf, linkChoice,
} from './supplierStep';
import type { SupplierDecision } from './supplierStep';
import styles from './InvoiceImportScreen.module.css';

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  // The model's plan: one entry per supplier of the file.
  plan: readonly SupplierPlanEntry[];
  // The venue's suppliers as the section shows them now (for «is {name}»).
  suppliers: readonly StoredDoc[];
  // The answers to the «maybe» rows, and the suppliers the person chose not to import anything from.
  answers: Readonly<Record<string, SupplierDecision>>;
  skips: ReadonlySet<string>;
  // The red line a refused or changed write leaves, or null.
  error: MessageKey | null;
  // How many «maybe» rows have no answer yet (they block the primary button), and the id of the sentence that says so.
  blocked: number;
  hintId: string;
  // The suppliers are being written: nothing can be changed now.
  busy: boolean;
  onAnswer: (key: string, decision: SupplierDecision | null) => void;
  onForget: (key: string, forget: boolean) => void;
};

const FORGET = 'forget';
const IMPORT = 'import';

// Step 2 of 3: the suppliers of the file. One row each: who it is, what Mise makes of it (a WORD in a pill), and — when Mise is
// not sure — what should happen.
export function SuppliersStep({ headingRef, plan, suppliers, answers, skips, error, blocked, hintId, busy, onAnswer, onForget }: Props) {
  const { t } = useT();
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>{t('sup.imp.step.suppliers')}</h3>
      {error ? <p role="alert" className={`${styles.status} ${styles.error}`}>{t(error)}</p> : null}
      {busy ? <p className={styles.note}>{t('sup.imp.suppliers.saving')}</p> : null}
      {/* The sentence the primary button points to (aria-describedby): why it waits. Empty (and absent) when nothing blocks. */}
      {blocked > 0 ? <p id={hintId} className={styles.hint}>{t('sup.imp.suppliers.decideFirst', { n: blocked })}</p> : null}
      {plan.length === 0 ? <p className={styles.empty}>{t('sup.imp.suppliers.none')}</p> : (
        <ul className={`${styles.rows} ${styles.group} ${styles.suppliers}`}>
          {plan.map(entry => (
            <SupplierRow key={entry.key} entry={entry} suppliers={suppliers} answer={answers[entry.key]} forgotten={skips.has(entry.key)} busy={busy}
              onAnswer={decision => { onAnswer(entry.key, decision); }} onForget={forget => { onForget(entry.key, forget); }} />
          ))}
        </ul>
      )}
    </>
  );
}

function SupplierRow({ entry, suppliers, answer, forgotten, busy, onAnswer, onForget }: {
  entry: SupplierPlanEntry;
  suppliers: readonly StoredDoc[];
  answer: SupplierDecision | undefined;
  forgotten: boolean;
  busy: boolean;
  onAnswer: (decision: SupplierDecision | null) => void;
  onForget: (forget: boolean) => void;
}) {
  const { t } = useT();
  const nameId = useId();
  const answerId = useId();
  const forgetId = useId();
  const existing = entry.supplierId ? suppliers.find(supplier => supplier.id === entry.supplierId) : undefined;
  const meta = [
    entry.vatNumber ? t('sup.imp.vat', { vat: entry.vatNumber }) : t('sup.imp.vat.none'),
    existing ? t('sup.imp.suppliers.is', { name: supplierLabel(existing) }) : '',
  ].filter(Boolean).join(' · ');
  const status = isSupplierStatus(entry.status) ? SUPPLIER_STATUS[entry.status] : null;

  return (
    <li className={styles.row} aria-labelledby={nameId}>
      <div className={styles.rowTop}>
        <div className={styles.rowMain}>
          <span id={nameId} className={styles.name}>{entry.name || entry.key}</span>
          <span className={styles.meta}>{meta}</span>
        </div>
        {status ? <span className={styles.pill} data-tone={status.tone}>{t(status.key)}</span> : null}
      </div>
      {entry.reason ? <p className={styles.reason}>{t(supplierReasonKey(entry.reason))}</p> : null}
      {entry.status === 'maybe' ? (
        <div className={styles.choice}>
          <label htmlFor={answerId} className={styles.choiceLabel}>{t('sup.imp.choose')}</label>
          <select id={answerId} className={styles.select} value={choiceOf(answer)} disabled={busy} onChange={event => { onAnswer(decisionOf(event.target.value)); }}>
            <option value={CHOICE_NONE}>{t('sup.imp.choosePlaceholder')}</option>
            {(entry.candidates ?? []).map(candidate => (
              <option key={candidate.id} value={linkChoice(candidate.id)}>{t('sup.imp.sameAs', { name: candidate.label })}</option>
            ))}
            <option value={CHOICE_NEW}>{t('sup.imp.suppliers.createNew')}</option>
            <option value={CHOICE_SKIP}>{t('sup.imp.skip')}</option>
          </select>
        </div>
      ) : null}
      {/* A supplier that is not in Mise yet may be one that sells nothing to import (a honey producer, a cleaning firm): «do not
          import anything from this supplier» drops it and every product of it, now and in the next imports. */}
      {entry.status === 'new' ? (
        <div className={styles.choice}>
          <label htmlFor={forgetId} className={styles.choiceLabel}>{t('sup.imp.choose')}</label>
          <select id={forgetId} className={styles.select} value={forgotten ? FORGET : IMPORT} disabled={busy} onChange={event => { onForget(event.target.value === FORGET); }}>
            <option value={IMPORT}>{t('sup.imp.suppliers.import')}</option>
            <option value={FORGET}>{t('sup.imp.suppliers.forget')}</option>
          </select>
        </div>
      ) : null}
    </li>
  );
}
