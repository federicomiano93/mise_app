import { useCallback, useId, useState } from 'react';
import { ChevronDown, Pencil, Share } from 'lucide-react';
import { isLegacyRecord, recordedName, sendSections } from '@mise/shared/archive';
import type { SendSection } from '@mise/shared/archive';
import { isNoSupplier } from '@mise/shared/no-supplier';
import { compareLabels } from '@mise/shared/order-text';
import { recordUnit } from '@mise/shared/order-unit';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { correctOpener, useHandBack } from './handBack';
import type { StoredDoc } from './ordersSource';
import styles from './HistoryScreen.module.css';

type Lookup = Readonly<Record<string, StoredDoc>>;

type Props = {
  record: StoredDoc;
  // The ingredients and the suppliers by id: names and units are read from them AT DRAW TIME, so a rename shows through.
  ingredientsById: Lookup;
  suppliersById: Lookup;
  // Marks the card as the first one an older day revealed: «Show older orders» hands the focus to it.
  firstOlder: boolean;
  onSendAgain: (record: StoredDoc) => void;
  onCorrect: (record: StoredDoc) => void;
};

const SECTION_KEY: Readonly<Record<SendSection['heading'], MessageKey>> = {
  first: 'ord.history.firstSend',
  later: 'ord.history.laterSend',
  edit: 'ord.history.editedSend',
  earlier: 'ord.history.earlierSends',
};

type Line = { readonly id: string; readonly name: string; readonly qty: string };

// One recorded order as a collapsible card (parity H2–H6): the supplier and the number of items on a button that opens the lines
// under it, collapsed at first. The sends of the day (several orders the same day are shown apart, each with its time), then the
// day's total, then «Send again» and «Correct».
//
// A record from the old weekly model (a whole week, every supplier in one document) is shown grouped by the supplier each line sits
// under TODAY, so nothing that was recorded is lost or reinterpreted.
export function HistoryCard({ record, ingredientsById, suppliersById, firstOlder, onSendAgain, onCorrect }: Props) {
  const { t, locale } = useT();
  const handBack = useHandBack();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const legacy = isLegacyRecord(record);
  const quantities = mapOf(record.quantities);
  const count = Object.keys(quantities).length;
  const deletedWord = t('ord.deletedIngredient');
  const correct = useCallback((node: HTMLButtonElement | null) => { handBack.register(correctOpener(record.id), node); }, [handBack, record.id]);

  const linesOf = (quantitiesOf: Record<string, unknown>, unitsOf: unknown): Line[] => Object.keys(quantitiesOf)
    .map(id => ({
      id,
      name: recordedName(id, ingredientsById, record.names, deletedWord),
      qty: `${String(quantitiesOf[id])} ${recordUnit({ units: unitsOf }, id, ingredientsById[id])}`.trim(),
    }))
    .sort((a, b) => compareLabels(a.name, b.name));

  const timeOf = (iso: string): string => {
    const at = iso ? new Date(iso) : null;
    if (at === null || Number.isNaN(at.getTime())) return '';
    return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(at);
  };
  const headingOf = (section: SendSection): string => {
    const time = timeOf(section.time);
    return time === '' || section.heading === 'earlier' ? t('ord.history.earlierSends') : t(SECTION_KEY[section.heading], { time });
  };

  const name = legacy ? t('ord.history.wholeWeek')
    : typeof record.supplierName === 'string' && record.supplierName !== '' ? record.supplierName : t('ord.unknownSupplier');

  let content;
  if (count === 0) {
    content = <p className={styles.empty}>{t('ord.history.noItems')}</p>;
  } else if (legacy) {
    // Grouped by the supplier each line sits under now. «No supplier» is a deliberate, named thing; an id that matches nothing is
    // not, and calling it «No supplier» too would hide a real problem.
    const groups = new Map<string, Line[]>();
    for (const id of Object.keys(quantities)) {
      const ingredient = ingredientsById[id];
      const supplierId = typeof ingredient?.supplierId === 'string' && ingredient.supplierId !== '' ? ingredient.supplierId : 'unknown';
      const unit = typeof ingredient?.unit === 'string' ? ingredient.unit : '';
      const line: Line = {
        id,
        name: recordedName(id, ingredientsById, record.names, deletedWord),
        qty: `${String(quantities[id])} ${unit}`.trim(),
      };
      groups.set(supplierId, [...(groups.get(supplierId) ?? []), line]);
    }
    content = [...groups.entries()].map(([supplierId, lines]) => (
      <div key={supplierId} className={styles.group}>
        <h4 className={styles.groupTitle}>
          {supplierLabel(suppliersById[supplierId]) || (isNoSupplier(supplierId) ? t('ord.noSupplier') : t('ord.unknownSupplier'))}
        </h4>
        <Lines lines={lines.slice().sort((a, b) => compareLabels(a.name, b.name))} />
      </div>
    ));
  } else {
    const { sections, total } = sendSections(record);
    content = (
      <>
        {sections.map((section, index) => (
          <div key={`${section.time}-${String(index)}`} className={styles.group}>
            <h4 className={styles.groupTitle}>{headingOf(section)}</h4>
            {/* A lone send is only a heading over the total; with several, each lists its own lines. */}
            {section.quantities ? <Lines lines={linesOf(section.quantities, section.units)} /> : null}
          </div>
        ))}
        <div className={styles.group}>
          {total ? <h4 className={styles.groupTitle}>{t('ord.history.dayTotal')}</h4> : null}
          <Lines lines={linesOf(quantities, record.units)} />
        </div>
      </>
    );
  }

  return (
    <div className={styles.card}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        aria-controls={bodyId}
        data-first-older={firstOlder ? '' : undefined}
        onClick={() => { setOpen(before => !before); }}
      >
        <span className={styles.headText}>
          <span className={styles.name}>{name}</span>
          <span className={styles.meta}>{t('ord.itemsCount', { n: count })}</span>
        </span>
        <ChevronDown aria-hidden="true" className={styles.chevron} />
      </button>
      <div id={bodyId} hidden={!open} className={styles.cardBody}>
        {content}
        <div className={styles.actions}>
          <Button variant="quiet" onPress={() => { onSendAgain(record); }}>
            <Share aria-hidden="true" />
            {t('ord.history.sendAgain')}
          </Button>
          <Button ref={correct} variant="quiet" onPress={() => { onCorrect(record); }}>
            <Pencil aria-hidden="true" />
            {t('ord.history.correct')}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Lines({ lines }: { lines: readonly Line[] }) {
  return (
    <ul className={styles.lines}>
      {lines.map(line => (
        <li key={line.id} className={styles.line}>
          <span className={styles.lineName}>{line.name}</span>
          <span className={styles.lineQty}>{line.qty}</span>
        </li>
      ))}
    </ul>
  );
}

const mapOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
