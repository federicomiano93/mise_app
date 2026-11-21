import { useMemo, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Tab, TabList, TabPanel, Tabs } from 'react-aria-components';
import { cakeNeeds, cakeProduct } from '@mise/shared/cake-model';
import type { Cake } from '@mise/shared/cake-model';
import { titleFileName } from '@mise/shared/recipe-export';
import { useFoodcost } from '../foodcost/FoodcostContext';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useExportSheet } from '../ui/ExportSheet';
import { MAX_CAKES, MIN_CAKES, ingredientTable, needExportModel, needTitle, notOpenedText, semiTable } from './needModel';
import type { NeedTab } from './needModel';
import { NeedPrintSheet } from './NeedPrintSheet';
import type { NeedSheetWords } from './NeedPrintSheet';
import { printNeeds } from './needPrintHost';
import { useStepFocus } from './useStepFocus';
import styles from './NeedDialog.module.css';

type Props = {
  // ⚠️ THE WORKING COPY, not the saved cake: an edit not yet saved counts, and a cake not yet saved works too.
  cake: Cake;
  onClose: () => void;
};

// «What you need» to make `count` of this cake: per semi-finished card (ready, and what to prepare before the oven's loss, summed over
// every tier) or down to the ingredients (one row each, summed over every part). It prints for the lab, and the PDF is the tab on
// screen. The sums are cakeNeeds'; the words are needModel's; this file lays them out.
export function NeedDialog({ cake, onClose }: Props) {
  const { t } = useT();
  const money = useMoney();
  const { tables } = useFoodcost();
  const [openExport, exportSheet] = useExportSheet();
  const [tab, setTab] = useState<NeedTab>('semi');
  const [count, setCount] = useState(MIN_CAKES);
  const countFocus = useStepFocus(count <= MIN_CAKES, count >= MAX_CAKES);

  const needs = useMemo(() => cakeNeeds(cakeProduct(cake), tables, count), [cake, tables, count]);
  const semi = useMemo(() => semiTable(needs, money), [needs, money]);
  const ingredients = useMemo(() => ingredientTable(needs, t, money), [needs, t, money]);
  const title = needTitle(t, cake.name, count);
  const notOpened = tab === 'ingredients' ? notOpenedText(needs, t) : null;
  const empty = needs.semis.length === 0;
  const foot = t(tab === 'semi' ? 'cakes.need.footSemi' : 'cakes.need.footIngredients');
  const allTiers = cake.tiers > 1 ? t('cakes.need.allTiers') : null;

  const words = (): NeedSheetWords => ({
    title,
    colSemi: t('cakes.need.colSemi'),
    colReady: t('cakes.need.colReady'),
    colLoss: t('cakes.need.colLoss'),
    colPrepare: t('cakes.need.colPrepare'),
    colIngredient: t('cakes.need.colIngredient'),
    colAmount: t('cakes.need.colAmount'),
    total: t('cat.total'),
    foot,
    allTiers,
    notOpened,
  });

  const print = () => { printNeeds(<NeedPrintSheet tab={tab} semi={semi} ingredients={ingredients} words={words()} />); };
  const download = () => {
    const model = needExportModel(tab, needs, t, money, cake.name, count);
    openExport({
      model,
      totalLabel: t('cat.total'),
      fileName: (ext, fallback) => titleFileName(model.name, ext, fallback),
    });
  };

  const table = (kind: NeedTab) => (
    <>
      {empty ? <p className={styles.empty}>{t('cakes.need.empty')}</p> : kind === 'semi' ? (
        <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('cakes.need.colSemi')}</th>
              <th scope="col" className={styles.r}>{t('cakes.need.colReady')}</th>
              <th scope="col" className={styles.r}>{t('cakes.need.colLoss')}</th>
              <th scope="col" className={styles.r}>{t('cakes.need.colPrepare')}</th>
            </tr>
          </thead>
          <tbody>
            {semi.rows.map(row => (
              <tr key={row.key}>
                <th scope="row" className={styles.name}>{row.name}</th>
                <td className={styles.r}>{row.ready}</td>
                <td className={styles.r}>{row.loss}</td>
                <td className={styles.r}><b>{row.prepare}</b></td>
              </tr>
            ))}
            <tr className={styles.total}>
              <th scope="row">{t('cat.total')}</th>
              <td className={styles.r}>{semi.totalReady}</td>
              <td />
              <td className={styles.r}>{semi.totalPrepare}</td>
            </tr>
          </tbody>
        </table>
        </div>
      ) : (
        <div className={styles.scroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('cakes.need.colIngredient')}</th>
              <th scope="col" className={styles.r}>{t('cakes.need.colAmount')}</th>
            </tr>
          </thead>
          <tbody>
            {ingredients.map(row => (
              <tr key={row.key}>
                <th scope="row" className={styles.name}>
                  {row.name}
                  <small>{row.from}</small>
                </th>
                <td className={styles.r}><b>{row.amount}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}
      {allTiers === null || empty ? null : <p className={styles.caption}>{allTiers}</p>}
      {notOpened === null ? null : <p className={styles.warn} role="note">{notOpened}</p>}
      {empty ? null : <p className={styles.caption}>{foot}</p>}
    </>
  );

  return (
    <>
      <Dialog
        isOpen
        wide
        dismissable
        title={title}
        onClose={onClose}
        actions={(
          <>
            <Button onPress={print} isDisabled={empty}>
              <Printer aria-hidden="true" />
              {t('cakes.need.print')}
            </Button>
            <Button variant="primary" onPress={download} isDisabled={empty}>
              <Download aria-hidden="true" />
              {t('cakes.need.pdf')}
            </Button>
            <Button onPress={onClose}>{t('export.close')}</Button>
          </>
        )}
      >
        <Tabs selectedKey={tab} onSelectionChange={key => { setTab(key === 'ingredients' ? 'ingredients' : 'semi'); }} className={styles.tabs}>
          <div className={styles.bar}>
            <TabList aria-label={t('cakes.need.tabsLabel')} className={styles.seg}>
              <Tab id="semi" className={styles.segb}>{t('cakes.need.tabSemi')}</Tab>
              <Tab id="ingredients" className={styles.segb}>{t('cakes.need.tabIngredients')}</Tab>
            </TabList>
            <div className={styles.step} role="group" aria-label={t('cakes.need.count')}>
              <span className={styles.stepLabel} aria-hidden="true">{t('cakes.need.count')}</span>
              <Button
                ref={countFocus.less}
                variant="bare"
                className={styles.stepButton}
                aria-label={t('cakes.need.countLess')}
                isDisabled={count <= MIN_CAKES}
                onPress={() => { setCount(current => Math.max(MIN_CAKES, current - 1)); }}
              >
                −
              </Button>
              <output className={styles.value}>{count}</output>
              <Button
                ref={countFocus.more}
                variant="bare"
                className={styles.stepButton}
                aria-label={t('cakes.need.countMore')}
                isDisabled={count >= MAX_CAKES}
                onPress={() => { setCount(current => Math.min(MAX_CAKES, current + 1)); }}
              >
                +
              </Button>
            </div>
          </div>
          <TabPanel id="semi" className={styles.panel}>{table('semi')}</TabPanel>
          <TabPanel id="ingredients" className={styles.panel}>{table('ingredients')}</TabPanel>
        </Tabs>
      </Dialog>
      {exportSheet}
    </>
  );
}
