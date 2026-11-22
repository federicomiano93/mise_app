import { useCallback, useId, useMemo, useState } from 'react';
import { PencilLine, Plus, Scale, Search } from 'lucide-react';
import { useFoodcost } from '../foodcost/FoodcostContext';
import { NEW_OPENER, productOpener, useHandBack } from '../foodcost/handBack';
import { percentText, statusWord } from '../foodcost/productRowModel';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useConfirm } from '../ui/useConfirm';
import { dropParked, useParkedCakes } from './cakeParking';
import type { ParkedCake } from './cakeParking';
import { useCakes } from './CakesContext';
import { cakeSubLine, costCakes, matchingCakes } from './cakesListModel';
import type { CakeRowData } from './cakesListModel';
import type { CakeStart } from './cakesPath';
import styles from './CakesList.module.css';

type Props = {
  onOpenCake: (id: string) => void;
  // The question «How do you want to start?» is answered here, so the editor opens already knowing.
  onOpenNew: (start: CakeStart) => void;
  // «Resume» on an unsaved cake set aside by «Open in Recipes»: opens its editor, which takes the copy back.
  onResume: (copy: ParkedCake) => void;
};

// The list page: «New cake» over the cakes by name (the reference grams' Settings are the gear beside the title, CakesSection). A cake, a new cake or Settings
// opens as a full page one level down.
//
// ⚠️ A ROW IS COSTED FROM FOOD COST'S TABLES (products, recipes, prices), so the list waits for all of them: a cake would read
// «incomplete» only because its numbers were still on their way.
export function CakesList({ onOpenCake, onOpenNew, onResume }: Props) {
  const { t } = useT();
  const money = useMoney();
  const handBack = useHandBack();
  const parkedCakes = useParkedCakes();
  const [confirm, confirmDialog] = useConfirm();
  const headId = useId();
  const { cakes, cakesLoaded } = useCakes();
  const { productsLoaded, recipesLoaded, ingredientsLoaded, tables } = useFoodcost();
  const ready = cakesLoaded && productsLoaded && recipesLoaded && ingredientsLoaded;

  // The same object until the cakes or a price change: it costs every cake.
  const costed = useMemo(() => (ready ? costCakes(cakes, tables) : []), [ready, cakes, tables]);

  // ⚠️ THE SEARCH BOX IS NEVER REMOUNTED BY A DATA SNAPSHOT: a controlled input in a part that stays mounted, and only the rows
  // below it are redrawn, so a snapshot landing mid-keystroke finds the text and the keyboard where the person left them.
  const [query, setQuery] = useState('');
  const [starting, setStarting] = useState(false);
  const found = useMemo(() => matchingCakes(costed, query), [costed, query]);

  const newRef = useCallback((node: HTMLButtonElement | null) => { handBack.register(NEW_OPENER, node); }, [handBack]);

  // ⚠️ P20: A COPY SET ASIDE IS NEVER DROPPED WITHOUT ASKING.
  // The cake's own name; a cake with none yet is «new cake» (the line says «Unsaved new cake» for it).
  const nameOf = (copy: ParkedCake): string => copy.working.name.trim();
  const discard = async (copy: ParkedCake) => {
    const ok = await confirm({
      title: t('cakes.parked.discardQ'),
      message: t('cakes.parked.discardBody', { name: nameOf(copy) === '' ? t('cakes.parked.blankName') : nameOf(copy) }),
      okLabel: t('cakes.parked.discard'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (ok) dropParked(copy.key);
  };

  return (
    <div className={styles.column}>
      {parkedCakes.map(copy => {
        const name = nameOf(copy);
        const line = name === '' ? t('cakes.parked.lineBlank') : t('cakes.parked.lineNamed', { name });
        const who = name === '' ? t('cakes.parked.blankName') : name;
        return (
          <div key={copy.key} className={styles.parked} role="group" aria-label={line}>
            <p>{line}</p>
            <Button variant="primary" aria-label={t('cakes.parked.resumeAria', { name: who })} onPress={() => { onResume(copy); }}>{t('cakes.parked.resume')}</Button>
            <Button variant="quiet" aria-label={t('cakes.parked.discardAria', { name: who })} onPress={() => { void discard(copy); }}>{t('cakes.parked.discard')}</Button>
          </div>
        );
      })}
      <div className={styles.actions}>
        <Button ref={newRef} variant="primary" className={styles.add} onPress={() => { setStarting(true); }}>
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
        // Only the words: «New cake» is the one blue bar above (his ask, 21 Nov 2026).
        <p className={styles.empty}>{t('cakes.empty.title')}</p>
      ) : found.length === 0 ? null : (
        <section aria-labelledby={headId}>
          <h2 id={headId} className={styles.group}>{t('cakes.group.listed', { n: found.length })}</h2>
          <ul className={styles.rows}>
            {found.map(row => (
              <CakeRow key={row.cake.id} row={row} onOpen={() => { onOpenCake(row.cake.id); }} money={money} />
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

      {confirmDialog}

      {/* ⚠️ ONLY A NEW CAKE ASKS: a saved cake opens straight on its steps. Cancelling (or Escape) stays on the list. */}
      <Dialog
        isOpen={starting}
        onClose={() => { setStarting(false); }}
        title={t('cakes.start.title')}
        actions={<Button onPress={() => { setStarting(false); }}>{t('common.cancel')}</Button>}
      >
        <div className={styles.choices}>
          <button type="button" className={styles.choice} onClick={() => { setStarting(false); onOpenNew('standard'); }}>
            <Scale aria-hidden="true" />
            <span className={styles.choiceText}>
              <b>{t('cakes.start.standard')}</b>
              <span>{t('cakes.start.standardSub')}</span>
            </span>
          </button>
          <button type="button" className={styles.choice} onClick={() => { setStarting(false); onOpenNew('zero'); }}>
            <PencilLine aria-hidden="true" />
            <span className={styles.choiceText}>
              <b>{t('cakes.start.zero')}</b>
              <span>{t('cakes.start.zeroSub')}</span>
            </span>
          </button>
        </div>
      </Dialog>
    </div>
  );
}

// One cake: its name, ONE line under it, and the food cost with the traffic light — the same light as Food cost's rows, with «?» while
// a card in the cake has no price yet (the figure would be too low).
//
// ⚠️ THE LIGHT IS A DOT AND A WORD, NEVER COLOUR ALONE (P18): the word is on screen under the figure (Food cost's own row says it too); the dot is hidden from a screen reader.
function CakeRow({ row, onOpen, money }: { row: CakeRowData; onOpen: () => void; money: ReturnType<typeof useMoney> }) {
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
