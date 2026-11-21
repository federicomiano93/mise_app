import { useCallback, useId, useMemo, useState } from 'react';
import { Plus, Scale, Search } from 'lucide-react';
import { useFoodcost } from '../foodcost/FoodcostContext';
import { NEW_OPENER, SETTINGS_OPENER, productOpener, useHandBack } from '../foodcost/handBack';
import { percentText, statusWord } from '../foodcost/productRowModel';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { useCakes } from './CakesContext';
import { cakeSubLine, costCakes, matchingCakes } from './cakesListModel';
import type { CakeRowData } from './cakesListModel';
import styles from './CakesList.module.css';

type Props = {
  // The cake whose screen is the one open beside the list (the split).
  openCakeId: string | null;
  onOpenCake: (id: string) => void;
  onOpenNew: () => void;
  onOpenReference: () => void;
};

// The left column: «New cake» over the cakes by name, and the reference grams at the foot.
//
// ⚠️ A ROW IS COSTED FROM FOOD COST'S TABLES (products, recipes, prices), so the list waits for all of them: a cake would read
// «incomplete» only because its numbers were still on their way.
export function CakesList({ openCakeId, onOpenCake, onOpenNew, onOpenReference }: Props) {
  const { t } = useT();
  const money = useMoney();
  const handBack = useHandBack();
  const headId = useId();
  const { cakes, cakesLoaded } = useCakes();
  const { productsLoaded, recipesLoaded, ingredientsLoaded, tables } = useFoodcost();
  const ready = cakesLoaded && productsLoaded && recipesLoaded && ingredientsLoaded;

  // The same object until the cakes or a price change: it costs every cake.
  const costed = useMemo(() => (ready ? costCakes(cakes, tables) : []), [ready, cakes, tables]);

  // ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: a controlled input in a part that stays mounted, and only the rows
  // below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard where the person left them.
  const [query, setQuery] = useState('');
  const found = useMemo(() => matchingCakes(costed, query), [costed, query]);

  const newRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);
  const referenceRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(SETTINGS_OPENER, node); }, [handBack]);

  return (
    <div className={styles.column}>
      <div className={styles.actions}>
        <Button ref={newRef} variant="primary" className={styles.add} onPress={onOpenNew}>
          <Plus aria-hidden="true" />
          {t('cakes.new')}
        </Button>
      </div>

      {ready && costed.length > 0 ? (
        <div className={styles.search}>
          <Search aria-hidden="true" />
          <input
            type="search"
            autoComplete="off"
            className={styles.input}
            aria-label={t('cakes.search')}
            placeholder={t('cakes.search')}
            value={query}
            onChange={event => { setQuery(event.target.value); }}
          />
        </div>
      ) : null}

      {!ready ? (
        <p className={styles.loading} aria-busy="true">{t('cakes.loading')}</p>
      ) : costed.length === 0 ? (
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t('cakes.empty.title')}</p>
          <p className={styles.emptySub}>{t('cakes.empty.sub')}</p>
          <Button onPress={onOpenNew}>{t('cakes.new')}</Button>
        </div>
      ) : found.length === 0 ? null : (
        <section aria-labelledby={headId}>
          <h2 id={headId} className={styles.group}>{t('cakes.group.listed', { n: found.length })}</h2>
          <ul className={styles.rows}>
            {found.map(row => (
              <CakeRow key={row.cake.id} row={row} isOpen={row.cake.id === openCakeId} onOpen={() => { onOpenCake(row.cake.id); }} money={money} />
            ))}
          </ul>
        </section>
      )}

      {/* A search that matches nothing stays a small line under the box. The region is drawn before it speaks, so the line is
          announced when it arrives. */}
      <div role="status">
        {ready && costed.length > 0 && found.length === 0
          ? <p className={styles.nothing}>{t('cakes.searchNone', { q: query.trim() })}</p>
          : null}
      </div>

      <Button ref={referenceRef} variant="secondary" className={styles.foot} onPress={onOpenReference}>
        <Scale aria-hidden="true" />
        {t('cakes.referenceLink')}
      </Button>
    </div>
  );
}

// One cake: its name, ONE line under it, and the food cost with the traffic light — the same light as Food cost's rows, with «?» while
// a card in the cake has no price yet (the figure would be too low).
//
// ⚠️ THE LIGHT IS A DOT AND A WORD, NEVER COLOUR ALONE (P18): the word is on screen under the figure (Food cost's own row says it too); the dot is hidden from a screen reader.
function CakeRow({ row, isOpen, onOpen, money }: { row: CakeRowData; isOpen: boolean; onOpen: () => void; money: ReturnType<typeof useMoney> }) {
  const { t } = useT();
  const handBack = useHandBack();
  const { cake, partial, status } = row;
  const opener = useCallback((node: HTMLButtonElement | null) => {
    handBack.register(productOpener(cake.id), node);
  }, [handBack, cake.id]);
  const known = !partial && row.pct !== null;
  const figure = partial ? '?' : row.pct === null ? '—' : percentText(row.pct, money);

  return (
    <li className={styles.item}>
      <button
        ref={opener}
        type="button"
        className={styles.row}
        aria-current={isOpen ? 'true' : undefined}
        data-open={isOpen}
        onClick={onOpen}
      >
        <span className={styles.main}>
          <span className={styles.name}>{cake.name === '' ? t('cakes.untitled') : cake.name}</span>
          <span className={styles.sub} data-todo={partial}>{cakeSubLine(t, cake, partial)}</span>
        </span>
        <span className={styles.figure}>
          <span className={styles.dot} data-status={known ? (status ?? 'none') : 'none'} aria-hidden="true" />
          <span className={styles.text}>
            <span className={styles.pct} data-costed={known}>{figure}</span>
            {known ? <span className={styles.word}>{statusWord(t, status)}</span> : <span className={styles.srOnly}>{t('cakes.row.unknownCost')}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}
