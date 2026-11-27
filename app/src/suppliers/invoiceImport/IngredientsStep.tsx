import { useMemo } from 'react';
import type { ReactNode, Ref } from 'react';
import type { FileIngredient } from '@mise/shared/invoice-import-model';
import { bucketOf, entriesFor, filterCounts } from '@mise/shared/invoice-import-plan';
import type { PlanEntry } from '@mise/shared/invoice-import-plan';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/useT';
import { useMoney } from '../../session/useMoney';
import { Button } from '../../ui/Button';
import type { StoredDoc } from '../suppliersSource';
import { IngredientRow } from './IngredientRow';
import { PRICE_CONFIRMED, filterKey } from './importWords';
import { isPriceConfirmed, replacedPrice } from './priceConfirmed';
import type { ImportFile } from './importRun';
import type { IngredientDecision } from './ingredientAnswers';
import type { IngredientAnswers, IngredientPlan } from './ingredientsRun';
import { pricePerUnitText } from '../priceText';
import styles from './InvoiceImportScreen.module.css';

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  // The file being imported (its ingredients and suppliers, for the names and the units) and the venue's suppliers as the
  // section shows them now.
  file: ImportFile;
  suppliers: readonly StoredDoc[];
  // The id of the supplier each file supplier stands for (see InvoiceImportScreen).
  supplierIdByKey: Readonly<Record<string, string>>;
  // «Checking what is already in Mise…» is running.
  checking: boolean;
  // The check could not be made: said in a red line (the primary button is then «Try again»).
  error: MessageKey | null;
  // The plan (what the venue holds, the rows planned) and the rows with the answers applied.
  plan: IngredientPlan | null;
  entries: readonly PlanEntry[];
  answers: IngredientAnswers;
  filter: string;
  // Which groups the person has opened.
  open: Readonly<Record<string, boolean>>;
  // How many rows still wait for an answer (they block the primary button) and the id of the sentence that says so.
  waiting: number;
  hintId: string;
  // Nothing is left to write: the hint says so, and rows already in Mise may still have price changes to record.
  nothingToWrite: boolean;
  canRecordChanges: boolean;
  onFilter: (filter: string) => void;
  onToggle: (group: string, open: boolean) => void;
  onDecision: (key: string, decision: IngredientDecision | null) => void;
  onForget: (key: string, forget: boolean) => void;
  onConfirm: (key: string, use: boolean) => void;
  onRename: (key: string, pair: { stored: string; file: string } | null) => void;
  onRecordChanges: () => void;
};

// The groups that stay closed in «All»: [bucket, title].
const GROUPS = [
  ['unchanged', 'sup.imp.ing.group.unchanged'],
  ['check', 'sup.imp.ing.group.check'],
  ['error', 'sup.imp.ing.group.errors'],
] as const satisfies readonly (readonly [string, MessageKey])[];

// The chips in order: the model's FILTERS, with «Price confirmed» (a screen-only chip) next to «New price».
const CHIP_ORDER = ['all', 'new', 'update-price', PRICE_CONFIRMED, 'history-only', 'unchanged', 'check', 'decide', 'error'];

// Step 3 of 3: the ingredients of the file. Chips to filter; the rows that need a decision or will be written; the ones already
// in Mise, the ones to check and the errors in closed groups. All the data is handed in: this step reads nothing itself.
export function IngredientsStep(props: Props) {
  const { t } = useT();
  const { headingRef, checking, error } = props;
  const heading = <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>{t('sup.imp.step.ingredients')}</h3>;
  if (checking) {
    return (
      <>
        {heading}
        <p className={styles.note}>{t('sup.imp.ing.checking')}</p>
      </>
    );
  }
  if (error) {
    return (
      <>
        {heading}
        <p role="alert" className={`${styles.status} ${styles.error}`}>{t(error)}</p>
      </>
    );
  }
  return <Rows {...props} heading={heading} />;
}

function Rows({
  heading, file, suppliers, supplierIdByKey, plan, entries, answers, filter, open, waiting, hintId, nothingToWrite, canRecordChanges,
  onFilter, onToggle, onDecision, onForget, onConfirm, onRename, onRecordChanges,
}: Props & { heading: ReactNode }) {
  const { t } = useT();
  const money = useMoney();
  const fileByKey = useMemo(() => new Map(file.ingredients.map(ingredient => [ingredient.key, ingredient])), [file]);

  // The supplier of a row: the one in Mise (by its id) as the section names it, else the file's own name for it.
  const supplierNameOf = (fileIngredient: FileIngredient | undefined): string => {
    if (!fileIngredient) return '';
    const id = supplierIdByKey[fileIngredient.supplierKey];
    const known = id ? suppliers.find(supplier => supplier.id === id) : undefined;
    if (known) return supplierLabel(known);
    return file.suppliers.find(supplier => supplier.key === fileIngredient.supplierKey)?.name ?? '';
  };

  // The price on a row. A row that replaces the price in force says what it replaces and by how much: «2,10 € / kg → 2,31 € / kg
  // (+10%)» — only when both prices are in the same unit.
  const priceTextOf = ({ planned, row }: PlanEntry): string => {
    const fileIngredient = fileByKey.get(planned.key);
    // ⚠️ THE PRICE SHOWN IS THE ONE THE ANSWERED ROW WOULD WRITE (review S3): a question answered «Same as X» is planned again on
    // X, and a row held back for a look keeps that row as `heldRow`. The planned row's own points are only the fallback.
    const effective = (row.heldRow as PlanEntry['row'] | undefined) ?? row;
    const points = effective.allPoints.length > 0 ? effective.allPoints : planned.allPoints;
    const last = points[points.length - 1];
    if (!fileIngredient || !last) return '';
    const unit = fileIngredient.priceUnit;
    const now = pricePerUnitText({ pricePerUnit: last.pricePerUnit, priceUnit: unit }, money, t);
    const replaced = plan ? replacedPrice(effective, plan.ctx.pricesById, unit) : null;
    if (replaced) {
      const sign = replaced.percent === 0 ? '=' : `${replaced.percent > 0 ? '+' : '-'}${Math.abs(replaced.percent)}%`;
      return t('sup.imp.ing.priceChange', {
        from: pricePerUnitText(replaced.stored, money, t),
        to: pricePerUnitText({ pricePerUnit: replaced.next.pricePerUnit, priceUnit: unit }, money, t),
        change: sign,
      });
    }
    return now;
  };

  // «Price confirmed»: the row's price is the one in force («(=)» above), only the invoice is newer.
  const confirmedOf = ({ planned, row }: PlanEntry): boolean => {
    const fileIngredient = fileByKey.get(planned.key);
    return Boolean(plan && fileIngredient && isPriceConfirmed(row, plan.ctx.pricesById, fileIngredient.priceUnit));
  };
  const confirmedKeys = new Set(entries.filter(confirmedOf).map(entry => entry.planned.key));
  const isConfirmed = (entry: PlanEntry): boolean => confirmedKeys.has(entry.planned.key);

  // The chips: a same-price row is counted under «Price confirmed», not «New price» (the rows themselves are the same).
  const counts = filterCounts(entries);
  counts['update-price'] = (counts['update-price'] ?? 0) - entries.filter(entry => isConfirmed(entry) && bucketOf(entry) === 'update-price').length;
  counts[PRICE_CONFIRMED] = entries.filter(entry => isConfirmed(entry) && bucketOf(entry) === 'update-price').length;
  // Same rule as the model's visibleFilters («All», the one that is on, every other with something under it).
  const chips = CHIP_ORDER.filter(name => name === 'all' || name === filter || (counts[name] ?? 0) > 0);
  const rowsFor = (name: string): PlanEntry[] => {
    if (name === PRICE_CONFIRMED) return entries.filter(entry => isConfirmed(entry) && bucketOf(entry) === 'update-price');
    if (name === 'update-price') return entriesFor(entries, name).filter(entry => !isConfirmed(entry));
    return entriesFor(entries, name);
  };

  const rowOf = (entry: PlanEntry) => {
    const key = entry.planned.key;
    const pair = entry.row.invoiceRename;
    const chosen = answers.renames.get(key);
    return (
      <IngredientRow
        key={key}
        entry={entry}
        supplierName={supplierNameOf(fileByKey.get(key))}
        priceText={priceTextOf(entry)}
        priceConfirmed={isConfirmed(entry)}
        decision={answers.decisions[key]}
        forgotten={answers.forgetKeys.has(key)}
        confirmed={answers.confirmKeys.has(key)}
        renameChosen={Boolean(pair && chosen && chosen.stored === pair.stored && chosen.file === pair.file)}
        onDecision={decision => { onDecision(key, decision); }}
        onForget={forget => { onForget(key, forget); }}
        onConfirm={use => { onConfirm(key, use); }}
        onRename={choice => { onRename(key, choice); }}
      />
    );
  };

  const list = (rows: readonly PlanEntry[]) => <ul className={`${styles.rows} ${styles.group} ${styles.list}`}>{rows.map(rowOf)}</ul>;
  const active = entries.filter(entry => !['unchanged', 'check', 'error'].includes(bucketOf(entry)));

  return (
    <>
      {heading}
      <p className={styles.note}>{t('sup.imp.ing.note')}</p>
      <div role="group" aria-label={t('sup.imp.filter.label')} className={styles.chips}>
        {chips.map(name => (
          <button key={name} type="button" className={styles.chip} aria-pressed={filter === name} onClick={() => { onFilter(name); }}>
            {`${t(filterKey(name))} (${counts[name] ?? 0})`}
          </button>
        ))}
      </div>
      {/* The sentence the primary button points to (aria-describedby): why it waits. */}
      {waiting > 0 ? <p id={hintId} className={styles.hint}>{t('sup.imp.ing.decideFirst', { n: waiting })}</p> : null}
      {nothingToWrite && waiting === 0 ? (
        <div className={styles.nothing}>
          <p className={styles.hint}>{t('sup.imp.ing.nothing')}</p>
          <p className={styles.note}>{t('sup.imp.log.doneMarks')}</p>
          {canRecordChanges ? <Button variant="secondary" onPress={onRecordChanges}>{t('sup.imp.ing.recordChanges')}</Button> : null}
        </div>
      ) : null}
      {filter === 'all' ? (
        <>
          {active.length > 0 ? list(active) : null}
          <div className={styles.groups}>
            {GROUPS.map(([bucket, titleKey]) => {
              const rows = entriesFor(entries, bucket);
              if (rows.length === 0) return null;
              return (
                <details key={bucket} className={styles.group} open={open[bucket] === true}
                  onToggle={event => { onToggle(bucket, event.currentTarget.open); }}>
                  <summary className={styles.groupTitle}>{t(titleKey, { n: rows.length })}</summary>
                  <ul className={styles.rows}>{rows.map(rowOf)}</ul>
                </details>
              );
            })}
          </div>
        </>
      ) : (() => {
        const rows = rowsFor(filter);
        return rows.length === 0 ? <p className={styles.empty}>{t('sup.imp.ing.emptyFilter')}</p> : list(rows);
      })()}
    </>
  );
}
