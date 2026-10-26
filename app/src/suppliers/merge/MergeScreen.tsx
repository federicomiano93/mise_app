import { useEffect, useId, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { useBlocker } from 'react-router';
import { ChevronRight, Search } from 'lucide-react';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { mergeCandidates } from '@mise/shared/ingredient-merge';
import type { UsageFound } from '@mise/shared/ingredient-merge';
import { useDataServices } from '../../data/DataContext';
import { localeOf } from '../../i18n/i18n';
import { useT } from '../../i18n/useT';
import { markBusy } from '../../session/busy';
import { useSession } from '../../session/SessionContext';
import { useMoney } from '../../session/useMoney';
import { KEEP_FOCUS } from '../../shell/Page';
import { FormBar } from '../../ui/FormBar';
import { useStatusMessage } from '../../ui/StatusMessage';
import { useAlert } from '../../ui/useAlert';
import { useConfirm } from '../../ui/useConfirm';
import { useCopyWait } from '../copyWait';
import { pricePerUnitText } from '../priceText';
import { useSuppliers } from '../SuppliersContext';
import { cameFromCard, tabOfState, useLeave } from '../suppliersNav';
import { ingredientPath } from '../suppliersPath';
import type { StoredDoc } from '../suppliersSource';
import type { MergePreview } from './mergeSource';
import styles from './MergeScreen.module.css';

// «Merge another pack…»: two ingredients that are really ONE product bought in two packs become one. A is the ingredient that
// STAYS (the card this was opened from); B, the one tapped here, has its price history and invoice codes moved onto A and is
// deleted. A port of js/orders/ingredient-merge-screen.js (parity I118–I129); the planning is @mise/shared/ingredient-merge and
// the database half is mergeSource.ts.
//
// ⚠️ NOTHING IS WRITTEN UNTIL THE CONFIRMATION IS ANSWERED «YES»: check where B is used → preview from the server → ask → write.
// ⚠️ WHILE THE MERGE WRITES nothing may leave: the rows and Back are off, the router's blocker refuses every other way out
// (the rail, the browser's Back), and `markBusy` keeps a self-started reload away. A level closed mid-write would hide the
// «stopped half way» words.
// ⚠️ THE FAILURE WORDS ARE HONEST (I126): «nothing was changed» is said only when no batch landed.
// ⚠️ THE LANGUAGE IS READ INSIDE THE RENDER and the handlers, never at module level.

// What a failure of the source carries (a MergeError; read by its shape so this file stays free of the Firestore half).
function failureOf(error: unknown): { code: string; committed: boolean; used: readonly UsageFound[] } {
  const found = typeof error === 'object' && error !== null ? error as { code?: unknown; committed?: unknown; used?: unknown } : {};
  return {
    code: typeof found.code === 'string' ? found.code : 'unknown',
    committed: found.committed === true,
    used: Array.isArray(found.used) ? found.used as UsageFound[] : [],
  };
}

// The blocker that holds the screen while the merge writes. A component of its own so the hook is called every render.
function HoldWhileMerging({ active }: { active: MutableRefObject<boolean> }) {
  const blocker = useBlocker(() => active.current);
  useEffect(() => {
    if (blocker.state === 'blocked') blocker.reset();
  });
  return null;
}

export function MergeScreen({ id }: { id: string }) {
  const { t, lang } = useT();
  const { locationId } = useSession();
  if (!locationId) throw new Error('Merge needs an open venue.');
  const services = useDataServices();
  // Made ONCE when the screen opens: the source belongs to this visit.
  const [source] = useState(() => services.merge(locationId));
  const snapshot = useSuppliers();
  const money = useMoney();
  const say = useStatusMessage();
  const navigate = useNavigate();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);

  const [query, setQuery] = useState('');
  const [working, setWorking] = useState(false);
  const holding = useRef(false);
  // A tap is being handled (checking, asking or writing): a second one is ignored.
  const flowing = useRef(false);

  const a = snapshot.ingredients.find(candidate => candidate.id === id) ?? null;
  const waited = useCopyWait(snapshot.ingredientsFromServer || snapshot.ingredientsBroken);
  const missing = a === null && snapshot.ingredientsLoaded && waited;

  const leave = useLeave(ingredientPath(id), () => undefined, cameFromCard);

  useEffect(() => (working ? markBusy() : undefined), [working]);

  // Opened from the card the page does not move the focus: it goes to this title (not on a POP).
  useEffect(() => {
    if (cameFromCard(state) && navigationType !== 'POP') title.current?.focus();
  }, []);

  if (a === null) {
    if (!missing) {
      return (
        <section className={styles.screen} aria-busy="true">
          <p className={styles.loading}>{t('session.loading')}</p>
        </section>
      );
    }
    return (
      <section className={styles.screen} aria-labelledby={titleId}>
        <FormBar backLabel={t('ui.back')} onBack={leave} title={t('sup.merge.title')} titleId={titleId} titleRef={title} />
        <p className={styles.gone}>{t('sup.ingredientGone')}</p>
      </section>
    );
  }

  const keep = ingredientDisplayName(a);
  const found = mergeCandidates(a, snapshot.ingredients, query);

  const monthWords = (month: string): string => {
    const [y, m] = month.split('-').map(Number);
    if (!y || !m) return month;
    return new Intl.DateTimeFormat(localeOf(lang), { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  };
  const usageWords = (use: UsageFound): string => {
    if (use.kind === 'product') return t('sup.merge.usedProduct', { name: use.name ?? '' });
    if (use.kind === 'recipe') return t('sup.merge.usedRecipe', { name: use.name ?? '' });
    if (use.kind === 'inventory') return t('sup.merge.usedInventory', { month: monthWords(use.month ?? '') });
    if (use.kind === 'request') return t('sup.merge.usedRequest');
    return t('sup.merge.usedDraft');
  };
  const usedMessage = (name: string, used: readonly UsageFound[]): string =>
    t('sup.merge.used', { name, where: used.map(usageWords).join(', '), keep });
  // ⚠️ «Nothing was changed» only when no batch landed; after the first commit the words say it stopped half way.
  const failureWords = (error: unknown): string => {
    const { code, committed } = failureOf(error);
    if (code === 'gone') return t('sup.merge.gone');
    if (committed) return t('sup.merge.interrupted');
    return t(code === 'offline' ? 'sup.merge.offline' : 'sup.merge.failed');
  };
  const okWords = () => ({ okLabel: t('common.ok') });

  const confirmLines = (b: StoredDoc, preview: MergePreview): string[] => {
    const name = ingredientDisplayName(b);
    const counts = preview.counts;
    const lines = [t('sup.merge.confirmMessage', {
      prices: t('sup.merge.countPrices', { n: counts.prices }),
      codes: t('sup.merge.countCodes', { n: counts.codes }),
      name,
      keep,
    })];
    if (counts.droppedCodes > 0) lines.push(t('sup.merge.droppedCodes', { n: counts.droppedCodes }));
    const price = preview.bPrice === null ? '' : pricePerUnitText(preview.bPrice, money, t);
    if (preview.takeover) lines.push(t('sup.merge.lineTakeover', { keep, name, price }));
    else if (preview.bLostPrice === 'history') lines.push(t('sup.merge.lineKept', { name, price }));
    else if (preview.bLostPrice === 'lost') lines.push(t('sup.merge.lineLost', { name, price }));
    if (preview.hasChanges) lines.push(t('sup.merge.lineChanges', { name }));
    return lines;
  };

  const release = () => {
    holding.current = false;
    setWorking(false);
  };

  // The flow after a tap on B (the original's runMergeFlow).
  const run = async (b: StoredDoc) => {
    if (flowing.current) return;
    flowing.current = true;
    const bName = ingredientDisplayName(b);
    try {
      let used: UsageFound[];
      try {
        used = await source.checkUsage(b.id);
      } catch (error) {
        console.error('The merge could not check where an ingredient is used:', failureOf(error).code);
        await alert({ message: t(failureOf(error).code === 'offline' ? 'sup.merge.offline' : 'sup.merge.checkFailed'), ...okWords() });
        return;
      }
      if (used.length > 0) {
        await alert({ message: usedMessage(bName, used), ...okWords() });
        return;
      }

      let preview: MergePreview;
      try {
        preview = await source.previewMerge(a.id, b.id);
      } catch (error) {
        console.error('The merge could not read what it would move:', failureOf(error).code);
        await alert({ message: failureWords(error), ...okWords() });
        return;
      }
      const yes = await confirm({
        title: t('sup.merge.confirmTitle', { name: bName, keep }),
        message: confirmLines(b, preview),
        okLabel: t('sup.merge.confirmOk'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!yes) return;

      holding.current = true;
      setWorking(true);
      try {
        await source.mergeIngredients(a.id, b.id);
      } catch (error) {
        release();
        const failure = failureOf(error);
        console.error('The merge stopped (nothing is lost; a second try finishes it):', failure.code);
        await alert({ message: failure.code === 'used' ? usedMessage(bName, failure.used) : failureWords(error), ...okWords() });
        return;
      }
      release();
      // A's card again, in the chooser's place, on the merged history. The Suppliers store's listeners drop B and update A by
      // themselves. The card's state keeps only the list tab: Back from it must not step back into the chooser's entry.
      const tab = tabOfState(state);
      void navigate(ingredientPath(a.id), { replace: true, state: tab === null ? KEEP_FOCUS : { ...KEEP_FOCUS, tab } });
      say(t('sup.merge.done'));
    } finally {
      flowing.current = false;
    }
  };

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={leave} backDisabled={working} title={t('sup.merge.title')} titleId={titleId} titleRef={title} />
      <div className={styles.body}>
        {/* ⚠️ Rendered empty and filled when the merge starts: a live region announces a CHANGE, never text it was born with. */}
        <p role="status" aria-live="polite" className={styles.status}>{working ? t('sup.merge.working') : ''}</p>
        <p className={styles.hint}>{t('sup.merge.hint', { name: keep })}</p>
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
            type="search"
            autoComplete="off"
            className={styles.input}
            aria-label={t('sup.merge.search')}
            placeholder={t('sup.merge.search')}
            value={query}
            onChange={event => { setQuery(event.target.value); }}
          />
        </div>
        {found.length === 0 ? (
          <p className={styles.empty}>{t(query.trim() === '' ? 'sup.merge.none' : 'sup.merge.noMatch')}</p>
        ) : (
          <ul className={styles.rows}>
            {found.map(({ ingredient, label }) => {
              const meta = [
                typeof ingredient.weight === 'string' ? ingredient.weight : '',
                pricePerUnitText(ingredient, money, t),
                ingredient.active === false ? t('sup.switchedOff') : '',
              ].filter(part => part !== '').join(' · ');
              return (
                <li key={ingredient.id} className={styles.item}>
                  <button
                    type="button"
                    className={styles.row}
                    data-off={ingredient.active === false}
                    disabled={working}
                    onClick={() => { void run(ingredient); }}
                  >
                    <span className={styles.main}>
                      <span className={styles.name}>{label}</span>
                      {meta !== '' ? <span className={styles.meta}>{meta}</span> : null}
                    </span>
                    <ChevronRight aria-hidden="true" className={styles.chevron} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <HoldWhileMerging active={holding} />
      {confirmDialog}
      {alertDialog}
    </section>
  );
}
