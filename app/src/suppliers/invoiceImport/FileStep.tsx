import { useId } from 'react';
import type { ReactNode, Ref } from 'react';
import type { SelectionItem } from '@mise/shared/invoice-zip/selection';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/useT';
import { codeKeys } from './importWords';
import type { ImportRun } from './importRun';
import styles from './InvoiceImportScreen.module.css';

// The groups that stay closed until opened (parity I86): [selection group, title, the tick-box that puts a product back].
const PRODUCT_GROUPS = [
  ['notImported', 'sup.imp.zip.group.notImported', 'sup.imp.zip.importAsIngredient'],
  ['skippedByYou', 'sup.imp.zip.group.skippedByYou', 'sup.imp.zip.importAgain'],
] as const satisfies readonly (readonly [string, MessageKey, MessageKey])[];

type Props = {
  headingRef: Ref<HTMLHeadingElement>;
  errorRef: Ref<HTMLParagraphElement>;
  resultRef: Ref<HTMLParagraphElement>;
  fileName: string;
  // A zip is being read: the picker is off.
  reading: boolean;
  // What is wrong, said in a red line (a refusal), or null.
  error: MessageKey | null;
  // What was read, or null.
  run: ImportRun | null;
  // Which groups the person has opened.
  open: Readonly<Record<string, boolean>>;
  onToggle: (group: string, open: boolean) => void;
  onFiles: (files: File[]) => void;
  // A product ticked / unticked; a remembered supplier ticked «import again».
  onTick: (productKey: string, on: boolean) => void;
  onSupplierTick: (supplierKey: string, on: boolean) => void;
};

// Step 1 of 3: choose the file. The explanation, the picker, and — once a zip is read — what the invoices held.
export function FileStep({
  headingRef, errorRef, resultRef, fileName, reading, error, run, open, onToggle, onFiles, onTick, onSupplierTick,
}: Props) {
  const { t } = useT();
  const inputId = useId();
  return (
    <>
      <h3 ref={headingRef} tabIndex={-1} className={styles.heading}>{t('sup.imp.step.file')}</h3>
      <p className={styles.note}>{t('sup.imp.file.explain')}</p>
      {/* ONE input for the life of the screen: it is never drawn again, so it never forgets the file it holds. The zip is the
          only file the screen speaks of (decision F6): a loose .xml or .p7m is read by the same reader, a .json is not offered. */}
      <div className={styles.file}>
        <input
          id={inputId}
          type="file"
          accept=".zip,.xml,.p7m"
          multiple
          className={`visually-hidden ${styles.fileInput ?? ''}`}
          // ⚠️ WHILE A ZIP IS BEING READ THE PICKER IS OFF: a second file chosen now would start a second read over the first
          // one's state. It comes back on every way out of the read.
          disabled={reading}
          aria-busy={reading ? true : undefined}
          onChange={event => { onFiles(Array.from(event.target.files ?? [])); }}
        />
        <label htmlFor={inputId} className={styles.fileButton} aria-disabled={reading ? true : undefined}>{t('sup.imp.file.label')}</label>
        {fileName ? <p className={styles.fileName}>{t('sup.imp.file.chosen', { name: fileName })}</p> : null}
      </div>
      {reading ? <p role="status" className={styles.note}>{t('sup.imp.file.reading')}</p> : null}
      {error ? <p ref={errorRef} role="alert" tabIndex={-1} className={`${styles.status} ${styles.error}`}>{t(error)}</p> : null}
      {run ? (
        <p ref={resultRef} role="status" tabIndex={-1} className={`${styles.status} ${styles.ok}`}>
          {`${t('sup.imp.zip.invoices', { n: run.selection.counts.invoices })} · ${t('sup.imp.file.found.suppliers', { n: run.file.suppliers.length })} · ${t('sup.imp.file.found.ingredients', { n: run.file.ingredients.length })}`}
        </p>
      ) : null}
      {run ? <Selection run={run} open={open} onToggle={onToggle} onTick={onTick} onSupplierTick={onSupplierTick} /> : null}
    </>
  );
}

// What the invoices held that is NOT in this import, each product with a tick-box that puts it back (or, for a remembered
// choice, takes it out of the memory). Ticking changes the selection at once, in memory — nothing is saved before the import
// is confirmed.
function Selection({ run, open, onToggle, onTick, onSupplierTick }: {
  run: ImportRun;
  open: Props['open'];
  onToggle: Props['onToggle'];
  onTick: Props['onTick'];
  onSupplierTick: Props['onSupplierTick'];
}) {
  const { t } = useT();
  const { groups, counts } = run.selection;
  const facts = [
    counts.excludedDocuments > 0 ? t('sup.imp.zip.excluded', { n: counts.excludedDocuments }) : '',
    counts.salesSkipped > 0 ? t('sup.imp.zip.sales', { n: counts.salesSkipped }) : '',
    counts.p7m > 0 ? t('sup.imp.zip.signed', { n: counts.p7m }) : '',
  ].filter(Boolean);

  const group = (id: string, title: string, rows: ReactNode) => (
    <details key={id} className={styles.group} open={open[id] === true} onToggle={event => { onToggle(id, event.currentTarget.open); }}>
      <summary className={styles.groupTitle}>{title}</summary>
      <ul className={styles.rows}>{rows}</ul>
    </details>
  );

  return (
    <>
      {facts.length > 0 ? <p className={styles.note}>{facts.join(' · ')}</p> : null}
      <div className={styles.groups}>
        {PRODUCT_GROUPS.map(([id, titleKey, tickKey]) => {
          const list = groups[id];
          if (list.length === 0) return null;
          return group(id, t(titleKey, { n: list.length }), list.map(item => (
            <ProductRow key={item.key} item={item} tick={t(tickKey)} onTick={on => { onTick(item.key, on); }} />
          )));
        })}
        {groups.skippedSuppliers.length > 0
          ? group('skippedSuppliers', t('sup.imp.zip.group.skippedSuppliers', { n: groups.skippedSuppliers.length }),
            groups.skippedSuppliers.map(supplier => (
              <Row key={supplier.key} name={supplier.name || supplier.key} meta={t('sup.imp.zip.supplierProducts', { n: supplier.products })}>
                <Tick label={t('sup.imp.zip.importAgain')} checked={supplier.checked} onChange={on => { onSupplierTick(supplier.key, on); }} />
              </Row>
            )))
          : null}
        {groups.unreadable.length > 0
          ? group('unreadable', t('sup.imp.zip.group.unreadable', { n: groups.unreadable.length }),
            groups.unreadable.map(item => (
              <ProductRow key={item.key} item={item} tick={t('sup.imp.zip.importAsIngredient')} onTick={on => { onTick(item.key, on); }} />
            )))
          : null}
        {groups.skippedFiles.length > 0
          ? group('skippedFiles', t('sup.imp.zip.group.skippedFiles', { n: groups.skippedFiles.length }),
            groups.skippedFiles.map((file, index) => (
              <Row key={`${file.name}-${index}`} name={file.name} reason={codeKeys(file.reason).map(key => t(key)).join(' · ')} />
            )))
          : null}
      </div>
    </>
  );
}

type Item = SelectionItem;

function ProductRow({ item, tick, onTick }: { item: Item; tick: string; onTick: (on: boolean) => void }) {
  const { t } = useT();
  return (
    <Row name={item.name || item.key} meta={[item.supplierName, item.description].filter(Boolean).join(' · ')}
      reason={!item.canImport && item.reason ? codeKeys(item.reason).map(key => t(key)).join(' · ') : undefined}>
      {item.canImport ? <Tick label={tick} checked={item.checked} onChange={onTick} /> : null}
    </Row>
  );
}

// One row, named by its name (so its tick-box is found INSIDE it, whatever product it is).
function Row({ name, meta, reason, children }: { name: string; meta?: string; reason?: string; children?: ReactNode }) {
  const nameId = useId();
  return (
    <li className={styles.row} aria-labelledby={nameId}>
      <div className={styles.rowMain}>
        <span id={nameId} className={styles.name}>{name}</span>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      {reason ? <p className={styles.reason}>{reason}</p> : null}
      {children}
    </li>
  );
}

function Tick({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={styles.tick}>
      <input type="checkbox" checked={checked} onChange={event => { onChange(event.target.checked); }} />
      <span>{label}</span>
    </label>
  );
}
