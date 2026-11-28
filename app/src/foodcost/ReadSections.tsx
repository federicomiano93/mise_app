import { isCakeProductId } from '@mise/shared/cake-model';
import { productCooking } from '@mise/shared/foodcost-model';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { fcMoney, fcNumber, fcWeight } from '@mise/shared/fc-number';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { lineMoney, lineName, lineNote, semiLineView } from './lineNotes';
import { MadeOfFoot } from './MadeOfFoot';
import type { Loaded } from './lineNotes';
import { piecesShown } from './productEditorModel';
import type { Working } from './productEditorModel';
import { amountText, gramsText, plainCount, positive } from './readText';
import styles from './ReadSections.module.css';

// The sections of a product's card as PLAIN TEXT (Federico, 7 Nov 2026: a product opens to READ, and only the pencil turns it
// into the form; current app read-sections.js after 18679a38, d491c7ca and f8770132). Every section has this second drawing,
// which shows the same facts with no box to type in.
//
// ⚠️ NOTHING HERE IS A CONTROL: a box sneaking into the read view would be a form that looks like text. A spec pins it.
// ⚠️ A MISSING VALUE IS «Not set», IN MUTED TEXT — never «0» and never «€0.00», which read as «free» (the same rule as the dash
// of the summary).
// ⚠️ EVERY FIGURE GOES THROUGH fc-number, two decimals in the venue's layout; a count the person typed (minutes, people) keeps its
// own figure.

const SOLD_TEXT = {
  piece: 'fc.byThePiece',
  weight: 'fc.byWeightPerKg',
  pack: 'fc.byThePack',
} as const satisfies Record<NonNullable<Product['sellingMode']>, MessageKey>;

type Row = {
  label: string;
  // null → «Not set».
  value: string | null;
  invalid?: boolean;
};

function ReadList({ rows }: { rows: Row[] }) {
  const { t } = useT();
  return (
    <dl className={styles.list}>
      {rows.map((row, index) => (
        <div key={index} className={styles.row}>
          <dt>{row.label}</dt>
          <dd className={row.invalid ? styles.invalid : undefined}>
            {row.value === null || row.value === '' ? <span className={styles.empty}>{t('fc.notSet')}</span> : row.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// One line of «Made of» or of the packaging, read: its name on top, the amount below it with the money at the right-hand end (step
// 3b, 11 Nov 2026 — the form's own layout), and the note under both.
type LineItem = {
  name: string;
  missing: boolean;
  // null → «Not set».
  amount: string | null;
  // The line's rate and what its amount costs (lineCost.ts); '' when there is nothing to say.
  cost: string;
  // What the person must act on (lineNotes.ts); '' when nothing.
  note: string;
};

function ReadLines({ items }: { items: LineItem[] }) {
  const { t } = useT();
  return (
    <dl className={styles.list}>
      {items.map((item, index) => (
        <div key={index} className={`${styles.row} ${styles.lineRow}`}>
          <dt className={item.missing ? styles.missing : undefined}>{item.name}</dt>
          <dd className={styles.amount}>
            {item.amount === null ? <span className={styles.empty}>{t('fc.notSet')}</span> : <span>{item.amount}</span>}
            {item.cost ? <span className={styles.money}>{item.cost}</span> : null}
          </dd>
          {item.note ? <dd className={styles.note}>{item.note}</dd> : null}
        </div>
      ))}
    </dl>
  );
}

function NothingYet() {
  const { t } = useT();
  return <p className={styles.empty}>{t('fc.read.nothingYet')}</p>;
}

// ── Product ───────────────────────────────────────────────────────────────────────────────────────
export function ReadProduct({ product, working, category }: { product: Product; working: Working; category: string }) {
  const { t } = useT();
  const money = useMoney();
  // Model 4: the kind; the category is its word in the Ricettario's list ('' reads as none), worked out by the caller.
  const rows: Row[] = [
    { label: t('fc.name'), value: product.name.trim() || null },
    { label: t('fc.kind.label'), value: t(product.kind === 'semi' ? 'fc.kind.semi' : 'fc.kind.finished') },
  ];
  // A cake's card has no category of its own (it sits in Food cost's «Cakes» group), so the row is not printed for it.
  if (!isCakeProductId(product.id)) rows.push({ label: t('fc.category.label'), value: category !== '' ? category : t('fc.cat.none') });
  // How it is sold is for a card that is sold.
  if (product.kind === 'semi') return <ReadList rows={rows} />;
  rows.push({ label: t('fc.sold'), value: product.sellingMode === null ? null : t(SOLD_TEXT[product.sellingMode]) });
  if (product.sellingMode === 'pack') {
    rows.push({
      label: t('fc.packHolds'),
      value: positive(product.packSize) && product.packUnit ? amountText(t, money, product.packSize, product.packUnit) : null,
    });
  }
  if (piecesShown(working)) {
    rows.push({ label: t('fc.piecesPerBatch'), value: positive(product.piecesPerBatch) ? fcNumber(product.piecesPerBatch, money) : null });
  }
  return <ReadList rows={rows} />;
}

type Lines = { product: Product; working: Working; tables: CostTables; loaded: Loaded };

// ── Made of ───────────────────────────────────────────────────────────────────────────────────────
export function ReadMadeOf({ product, working, tables, loaded }: Lines) {
  const { t } = useT();
  const money = useMoney();
  if (product.components.length === 0) return <NothingYet />;
  const items = product.components.map((line, index): LineItem => {
    // The working copy was made from the same product, line for line: it carries the name and the note the form would show.
    const shown = working.components[index];
    if (!shown) return { name: '', missing: false, amount: null, cost: '', note: '' };
    const name = lineName(t, shown, tables, loaded);
    // A semi-finished card inside: its tag and name, what a kilo of its materials costs and what this amount's materials cost, the labour apart.
    if (line.kind === 'semi' && shown.kind === 'semi') {
      const view = semiLineView(t, money, shown, tables, loaded);
      return {
        name: `${t('fc.semi.tag')}: ${name.text}`,
        missing: name.missing,
        amount: positive(line.qtyKg) ? fcWeight(line.qtyKg, money) : null,
        cost: view.cost === '' ? view.perKg : `${view.perKg} · ${view.cost}`,
        note: [view.labour, view.note].filter(Boolean).join(' '),
      };
    }
    const amount = line.kind === 'ingredient'
      ? (positive(line.qty) ? amountText(t, money, line.qty, line.unit) : null)
      : (positive(line.qtyKg) ? fcWeight(line.qtyKg, money) : null);
    return {
      name: name.text,
      missing: name.missing,
      amount,
      cost: lineMoney(t, money, shown, tables).text,
      note: lineNote(t, money, shown, tables, loaded),
    };
  });
  return (
    <div className={styles.block}>
      <ReadLines items={items} />
      <MadeOfFoot product={product} tables={tables} />
    </div>
  );
}

// ── Weight and oven loss ──────────────────────────────────────────────────────────────────────────
// What the PRODUCT weighs raw and cooked (model 3: the loss belongs to the product, not to its recipes), and the red warning of a
// cooked weight heavier than the raw one, which the person must see before a cost per kilo is trusted. `product` is current. The
// read view's «Cottura» card; the form has the boxes (CookingSection).
export function ReadCooking({ product, tables }: { product: Product; tables: CostTables }) {
  const { t } = useT();
  const money = useMoney();
  const cooking = productCooking(product, tables);
  if (cooking.cookedKg === null) return <p className={styles.line}>{t('fc.cooking.none')}</p>;
  const rows: Row[] = [
    { label: t('fc.rawDough'), value: gramsText(money, cooking.rawKg * 1000) },
    { label: t('fc.cookedDough'), value: gramsText(money, cooking.cookedKg * 1000), invalid: cooking.heavier },
  ];
  if (cooking.lossPct !== null) rows.push({ label: t('fc.cooking.lossLabel'), value: `${fcNumber(cooking.lossPct, money)}%` });
  return (
    <div className={styles.block}>
      <ReadList rows={rows} />
      {/* ⚠️ SPOKEN (code review, 11 Nov 2026; P18): a cooked weight can turn heavier than the raw one while the card is on screen (the
          recipe changed elsewhere). Present before it speaks: text added to a region already on the page is announced. */}
      <div className={styles.live} aria-live="polite">
        {cooking.heavier ? <p className={styles.warn}>{t('fc.cooking.heavier')}</p> : null}
      </div>
    </div>
  );
}

// ── Packaging ─────────────────────────────────────────────────────────────────────────────────────
export function ReadPackaging({ product, working, tables, loaded }: Lines) {
  const { t } = useT();
  const money = useMoney();
  if (product.packaging.length === 0) return <NothingYet />;
  return (
    <ReadLines
      items={product.packaging.map((line, index): LineItem => {
        const shown = working.packaging[index];
        if (!shown) return { name: '', missing: false, amount: null, cost: '', note: '' };
        const name = lineName(t, shown, tables, loaded);
        return {
          name: name.text,
          missing: name.missing,
          amount: positive(line.qtyPcs) ? amountText(t, money, line.qtyPcs, 'pcs') : null,
          cost: lineMoney(t, money, shown, tables).text,
          note: lineNote(t, money, shown, tables, loaded),
        };
      })}
    />
  );
}

// ── Work time ─────────────────────────────────────────────────────────────────────────────────────
// `note` is the labour-cost sentence the form decides (only for whoever may set the rate).
export function ReadLabour({ product, note, split = null }: { product: Product; note: string; split?: { own: number; semi: number } | null }) {
  const { t } = useT();
  const money = useMoney();
  const hasMinutes = positive(product.labourMinutes);
  return (
    <div className={styles.block}>
      <ReadList
        rows={[
          { label: t('fc.labourMinutes'), value: hasMinutes ? plainCount(product.labourMinutes as number, money) : null },
          // People left empty means one person, as the form's placeholder says — but with no minutes at all there is nothing
          // for them to work on, so it is «Not set» too.
          {
            label: t('fc.labourPeople'),
            value: positive(product.labourPeople) ? plainCount(product.labourPeople, money) : (hasMinutes ? '1' : null),
          },
        ]}
      />
      {note ? <p className={styles.note}>{note}</p> : null}
      {/* Model 4: the labour of the semi-finished cards inside, apart from the card's own work (said only when both exist). */}
      {split === null ? null : <p className={styles.note}>{t('fc.labourSplit', { semi: fcMoney(split.semi, money), own: fcMoney(split.own, money) })}</p>}
    </div>
  );
}

// ── Price ─────────────────────────────────────────────────────────────────────────────────────────
export function ReadPrice({ product }: { product: Product }) {
  const { t } = useT();
  const money = useMoney();
  return (
    <ReadList
      rows={[
        // A VAT of 0 is a real answer (shown «0,00%»); only «not stated» is «Not set».
        { label: t('fc.vatRate'), value: product.vatRate === null ? null : `${fcNumber(product.vatRate, money)}%` },
        { label: t('fc.foodCostTarget'), value: positive(product.foodCostTarget) ? `${fcNumber(product.foodCostTarget, money)}%` : null },
        { label: t('fc.sellingPriceVat', { currency: money.symbol }), value: positive(product.sellingPrice) ? fcMoney(product.sellingPrice, money) : null },
      ]}
    />
  );
}
