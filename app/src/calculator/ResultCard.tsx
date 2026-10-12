import { useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Maximize2, Send } from 'lucide-react';
import {
  crateCount, DIVISOR_MAX, divisorTotal, formatGrams, getCratePerBox, getDivisorProducts, isCrateEnabled,
  splitDough,
} from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe, TabProduct } from '@mise/shared/calculator-config';
import { buildRecipeText } from '@mise/shared/calculator-recipe-text';
import { useT } from '../i18n/useT';
import { useSendSheet } from '../ui/SendSheet';
import { problemSentence } from './calculatorMessages';
import type { TabResult } from './calculatorResult';
import { copyToClipboard } from './clipboard';
import { RecipeFullScreen } from './RecipeFullScreen';
import boxes from './Boxes.module.css';
import styles from './ResultCard.module.css';

type Props = {
  recipe: Recipe;
  // Never `none`: a tab with nothing to make shows no card.
  result: Exclude<TabResult, { kind: 'none' }>;
  config: CalculatorConfig;
  products: readonly TabProduct[];
  // The quantity typed for a (client, product) pair.
  qty: (qtyId: string) => number;
  // The divisor's number of crates, kept by the panel because Confirm saves it with the dough.
  divisorN: number;
  onDivisorN: (n: number) => void;
  // The heading takes the focus after a Confirm (RecipePanel): it is the recipe's own title.
  headingRef?: Ref<HTMLHeadingElement>;
};

// How long «Copied» (or «Copy failed») stays on the button.
const COPY_NOTE_MS = 2000;

// The scaled recipe of a tab: how much of each ingredient for the dough to make, the total, the split into
// crates and the crates the orders fill — and what can be done with it: full screen, copy, send.
//
// ⚠️ A TAB THAT CANNOT BE CALCULATED SHOWS NO NUMBER AT ALL, and says why: an answer that looks complete and is
// not is worse than none. «Still loading» and «gone» are different sentences.
export function ResultCard({ recipe, result, config, products, qty, divisorN, onDivisorN, headingRef }: Props) {
  const { t, locale } = useT();
  const titleId = useId();
  const grams = (n: number) => formatGrams(n, locale);
  const [fullScreen, setFullScreen] = useState(false);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [send, sendSheet] = useSendSheet();
  const opener = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = result.kind === 'ready' ? result : null;
  const problem = problemSentence(t, result);

  // The name the dough has in its text and its full-screen view: the catalogue's, when it is linked.
  const name = ready?.resolved.name || recipe.name;
  const text = ready ? buildRecipeText(name, ready.rows, ready.totalG) : '';

  // ⚠️ A CONFIGURATION THAT CHANGES UNDER THE FULL-SCREEN VIEW CLOSES IT: it is a copy of the old grams.
  // The config object changes only when the configuration itself does.
  useEffect(() => { setFullScreen(false); }, [config]);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  const openFullScreen = () => { setFullScreen(true); };
  const closeFullScreen = () => { setFullScreen(false); };

  // ⚠️ THE FOCUS GOES BACK ONLY ONCE THE DIALOG IS CLOSED. While a modal <dialog> is open everything outside it is
  // inert and focus() on the opener does nothing; the dialog closes itself first (RecipeFullScreen), and this
  // effect runs after it has been taken away. One road for ×, Escape and a configuration that changes under it.
  // The opener may have been replaced meanwhile: never focus a detached node.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !fullScreen && opener.current?.isConnected) opener.current.focus({ preventScroll: true });
    wasOpen.current = fullScreen;
  }, [fullScreen]);

  const doCopy = async () => {
    const ok = await copyToClipboard(text);
    setCopy(ok ? 'copied' : 'failed');
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => { timer.current = null; setCopy('idle'); }, COPY_NOTE_MS);
  };

  const copyText = copy === 'copied' ? t('calc.copied') : copy === 'failed' ? t('calc.copyFailed') : t('calc.copyRecipe');

  return (
    <section className={styles.card} aria-labelledby={titleId}>
      <header className={styles.head}>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className={styles.title}>{t('calc.doughTitle', { name: recipe.name })}</h2>
        {ready ? (
          <>
            <span className={styles.badge}>{t('calc.gramsRaw', { g: grams(Math.round(ready.target)) })}</span>
            <button
              ref={opener}
              type="button"
              className={styles.fullScreen}
              aria-label={t('calc.fullScreen')}
              title={t('calc.fullScreen')}
              onClick={openFullScreen}
            >
              <Maximize2 aria-hidden="true" />
            </button>
          </>
        ) : null}
      </header>

      {problem === null ? null : <p className={styles.problem}>{problem}</p>}

      {ready ? (
        <>
          {/* A tap on the list or on the total line opens the full-screen view too, as in the current app. The
              button in the header is the way in for a keyboard and a screen reader; Copy and Send sit outside
              both, so they never open it. */}
          <ul className={styles.rows} onClick={openFullScreen}>
            {ready.rows.map((row, index) => (
              <li key={index} className={styles.row}>
                <span className={styles.name}>{row.name}</span>
                <span className={styles.figure}>{`${grams(Math.round(row.grams))} g`}</span>
              </li>
            ))}
          </ul>
          <div className={styles.total} onClick={openFullScreen}>
            <span>{t('calc.totalDough')}</span>
            <span className={styles.figure}>{`${grams(ready.totalG)} g`}</span>
          </div>

          <div className={styles.share}>
            <button type="button" className={styles.copy} onClick={() => { void doCopy(); }}>{copyText}</button>
            <button
              type="button"
              className={styles.send}
              aria-label={t('calc.send')}
              title={t('calc.send')}
              onClick={() => { send({ subject: name, text }); }}
            >
              <Send aria-hidden="true" />
            </button>
          </div>

          <Divisor config={config} recipe={recipe} qty={qty} grams={grams} n={divisorN} onChange={onDivisorN} />
          <Crates products={products} qty={qty} />
        </>
      ) : null}

      {ready && fullScreen ? (
        <RecipeFullScreen name={name} rows={ready.rows} totalG={ready.totalG} onClose={closeFullScreen} />
      ) : null}
      {sendSheet}
    </section>
  );
}

// The divisor box (display only, never touches the recipe or the log): the dough of the products ticked in
// Settings, split into 0…4 crates. Hidden when nothing ticked has a quantity.
//
// ⚠️ NEVER LOCKED. Confirming a dough locks the quantities so they cannot drift from the log that was saved;
// the divisor is not a quantity, it is a split that touches neither the recipe nor the log — and it is
// useful exactly after the dough is made.
function Divisor({ config, recipe, qty, grams, n, onChange }: {
  config: CalculatorConfig;
  recipe: Recipe;
  qty: (qtyId: string) => number;
  grams: (n: number) => string;
  n: number;
  onChange: (n: number) => void;
}) {
  const { t } = useT();
  const active = getDivisorProducts(config, recipe.id).filter(product => qty(product.qtyId) > 0);
  if (active.length === 0) return null;

  const names = [...new Set(active.map(product => product.name))];
  const total = divisorTotal(config, recipe.id, qty);
  return (
    <div className={styles.divisor}>
      <p className={styles.divisorNames}>{names.join(', ')}</p>
      <div className={styles.divisorRow}>
        <span>{`${grams(Math.round(total))} g`}</span>
        <span aria-hidden="true">÷</span>
        <select
          className={boxes.select}
          aria-label={t('calc.numberOfCrates')}
          value={n}
          onChange={event => { onChange(Number(event.target.value)); }}
        >
          {Array.from({ length: DIVISOR_MAX + 1 }, (_, i) => <option key={i} value={i}>{i}</option>)}
        </select>
        <span aria-hidden="true">=</span>
        <span className={styles.divisorResult}>{`${grams(Math.round(splitDough(total, n)))} g`}</span>
      </div>
    </div>
  );
}

// The crate boxes (display only): per product that opted in and has a quantity, how many crates the order
// fills and what each holds.
function Crates({ products, qty }: { products: readonly TabProduct[]; qty: (qtyId: string) => number }) {
  const { t, locale } = useT();
  const shown = products.filter(product => isCrateEnabled(product) && qty(product.qtyId) > 0);
  if (shown.length === 0) return null;
  const oneDecimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });

  return (
    <ul className={styles.crates}>
      {shown.map(product => {
        const perBox = getCratePerBox(product);
        const count = crateCount(qty(product.qtyId), perBox);
        return (
          <li key={product.qtyId} className={styles.crate}>
            <span className={styles.crateName}>{product.name}</span>
            <span className={styles.crateCount}>
              {`${oneDecimal.format(Math.round(count * 10) / 10)} ${t('calc.crateUnit', { n: count })}`}
            </span>
            <span className={styles.crateSub}>{t('calc.gramsEachBox', { g: formatGrams(perBox * product.weight, locale) })}</span>
          </li>
        );
      })}
    </ul>
  );
}
