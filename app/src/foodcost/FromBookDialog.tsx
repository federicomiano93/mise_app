import { useEffect, useId, useRef, useState } from 'react';
import { fcNumber } from '@mise/shared/fc-number';
import { recipeProductId, recipesWithoutProducts } from '@mise/shared/from-recipes';
import type { MaybeProduct, MissingProduct } from '@mise/shared/from-recipes';
import { useT } from '../i18n/useT';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import type { StoredDoc } from './foodcostSource';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import styles from './FromBookDialog.module.css';

type Item = MissingProduct<StoredDoc> | MaybeProduct<StoredDoc>;

// A tick belongs to the PRODUCT the recipe would make (its id is the recipe's, never empty for a listed recipe).
const keyOf = (item: Item): string => recipeProductId(item.recipe.id);

type Props = {
  // Closed by Back or Escape (`made` false), or after products were made (`made` true).
  onClose: (made: boolean) => void;
};

// «Which recipes should become Food cost products», opened from the box at the top of the list (current app b5cf999e + f8d54f35,
// 28 Oct 2026). Federico: the recipes with no product are listed, he unticks what he does not want, a confirm, then they are
// written.
// ⚠️ NOTHING IS WRITTEN BEFORE THE CONFIRM, and Back / Escape only close: a tick is not saved data (so no busy marker for the ticks).
// ⚠️ THE LISTS ARE A SNAPSHOT taken when the screen opens (the dialog is mounted only while open): products arriving while he ticks
// do not move the rows under his thumb.
//
// «To create» are ticked to begin with; «Maybe already in Food cost» (a hand-made product uses the recipe or bears its name — a name
// is never a link) are NOT, his call.
export function FromBookDialog({ onClose }: Props) {
  const { t } = useT();
  const money = useMoney();
  const store = useFoodcostStore();
  const say = useStatusMessage();
  const { recipes, products } = useFoodcost();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();

  const [lists] = useState(() => recipesWithoutProducts<StoredDoc>(recipes, products));
  const { create, maybe } = lists;
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(create.map(keyOf)));
  const [busy, setBusy] = useState(false);
  const createRef = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);
  const createId = useId();
  const maybeId = useId();

  const chosen = [...create, ...maybe].filter(item => ticked.has(keyOf(item)));
  const allOn = create.every(item => ticked.has(keyOf(item)));

  const toggle = (item: Item, on: boolean) => {
    setTicked(before => {
      const next = new Set(before);
      if (on) next.add(keyOf(item)); else next.delete(keyOf(item));
      return next;
    });
  };
  const toggleAll = () => {
    setTicked(before => {
      const next = new Set(before);
      for (const item of create) {
        if (allOn) next.delete(keyOf(item)); else next.add(keyOf(item));
      }
      return next;
    });
  };

  const meta = (item: Item): string => {
    if ('reason' in item) {
      return item.reason === 'used' ? t('fc.fromBook.usedIn', { name: item.productName }) : t('fc.fromBook.sameName');
    }
    return item.kg > 0 ? t('fc.fromBook.wholeRecipe', { kg: fcNumber(item.kg, money) }) : t('fc.fromBook.noWeight');
  };

  const row = (item: Item) => (
    <li key={keyOf(item)} className={styles.item}>
      <label className={styles.tick}>
        <input
          type="checkbox"
          checked={ticked.has(keyOf(item))}
          disabled={busy}
          onChange={event => { toggle(item, event.target.checked); }}
        />
        <span className={styles.text}>
          <span className={styles.name}>{String(item.recipe['name'] ?? '').trim()}</span>
          {/* A space between the two, so the tick's name reads «Brioche Whole recipe…» (a flex item adds none of its own). */}
          {' '}
          <span className={styles.meta}>{meta(item)}</span>
        </span>
      </label>
    </li>
  );

  const createChosen = async () => {
    const picked = chosen;
    if (picked.length === 0 || busy) return;
    const yes = await confirm({
      title: t('fc.fromBook.confirmTitle', { n: picked.length }),
      message: t('fc.fromBook.confirmMsg'),
      okLabel: t('fc.fromBook.confirmOk'),
      cancelLabel: t('common.cancel'),
    });
    if (!yes) return;
    // ⚠️ Created on the SERVER, one by one (foodcostStore.createProductsFromRecipes says why), so it takes a moment and can fail
    // offline. While it runs the screen holds still; if nothing could be created it stays open with the ticks as they were, for
    // another try online.
    setBusy(true);
    let result = { made: 0, skipped: 0, failed: picked.length };
    try {
      result = await store.createProductsFromRecipes(picked.map(item => item.recipe));
    } catch {
      // The store counts a refusal itself; anything else reads as «none created», never as a silent close.
    }
    if (result.made > 0) say(t('fc.fromBook.done', { n: result.made }));
    else if (result.failed === 0 && result.skipped > 0) say(t('fc.fromBook.already'));
    // Offline, or refused: say so, and how many — the rest were created.
    if (result.failed > 0) await alert({ message: t('fc.fromBook.failed', { n: result.failed }), okLabel: t('common.ok') });
    // The dialog stays open after a failure, and its focused button was disabled while the server answered: the browser may have
    // dropped the focus on <body>. It is put back on Create explicitly, once busy has ended and the button is enabled again.
    const stays = result.failed > 0 && result.made === 0;
    if (stays) refocus.current = true;
    setBusy(false);
    if (stays) return;
    onClose(result.made > 0);
  };

  useEffect(() => {
    if (busy || !refocus.current) return;
    refocus.current = false;
    // After the alert's own focus restore, which runs on the next frame: the last word is ours.
    const frame = requestAnimationFrame(() => { createRef.current?.focus(); });
    return () => { cancelAnimationFrame(frame); };
  }, [busy]);

  return (
    <>
      <Dialog
        isOpen
        // ⚠️ An Escape the confirm has already taken is not ours: the confirm sits above and answers «no» alone, so this dialog and
        // the ticks on it stay. While the products are being made nothing closes it.
        onClose={() => { if (!busy) onClose(false); }}
        title={t('fc.fromBook.title')}
        message={t('fc.fromBook.intro')}
        actions={
          <>
            <Button isDisabled={busy} onPress={() => { onClose(false); }}>{t('ui.back')}</Button>
            <Button ref={createRef} variant="primary" isDisabled={busy || chosen.length === 0} onPress={() => { void createChosen(); }}>
              {busy ? t('fc.fromBook.creating') : chosen.length === 0 ? t('fc.fromBook.none') : t('fc.fromBook.create', { n: chosen.length })}
            </Button>
          </>
        }
      >
        <div className={styles.body}>
          {create.length === 0 ? null : (
            <section className={styles.group} aria-labelledby={createId}>
              <div className={styles.head}>
                <h3 id={createId} className={styles.heading}>{t('fc.fromBook.toCreate', { n: create.length })}</h3>
                <Button variant="quiet" className={styles.all} isDisabled={busy} onPress={toggleAll}>
                  {allOn ? t('fc.fromBook.untickAll') : t('fc.fromBook.tickAll')}
                </Button>
              </div>
              <ul className={styles.rows}>{create.map(row)}</ul>
            </section>
          )}
          {maybe.length === 0 ? null : (
            <section className={styles.group} aria-labelledby={maybeId}>
              <h3 id={maybeId} className={styles.heading}>{t('fc.fromBook.maybe', { n: maybe.length })}</h3>
              <ul className={styles.rows}>{maybe.map(row)}</ul>
            </section>
          )}
        </div>
      </Dialog>
      {confirmDialog}
      {alertDialog}
    </>
  );
}
