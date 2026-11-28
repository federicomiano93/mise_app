import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import {
  RECIPE_CATEGORIES_MAX, RECIPE_CATEGORY_MAX, addCategory, countInCategory, renameCategory, sortedCategories,
} from '@mise/shared/recipe-shelf';
import type { CategoryRefusal } from '@mise/shared/recipe-shelf';
import { mayOpenFoodCost } from '@mise/shared/recipe-link';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useOnline } from '../shell/useOnline';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { RenameNotFinished } from './recipesStore';
import { renameFoodcostCategory } from './renameFoodcostCategory';
import styles from './RecipeCategoriesDialog.module.css';

type Props = {
  // Closed by «Done» or Escape.
  onClose: () => void;
};

// The one line under the list when a write did not go through.
const FAILED_TEXT = {
  'put-back': 'cat.shelf.categoriesNotSaved',
  unfinished: 'cat.dlg.renameNotFinished',
  offline: 'cat.dlg.needsConnection',
} as const;

// What the row being typed in is: a new word (`word` null), or an existing one renamed.
type Editing = { word: string | null; text: string };

// Where the focus goes when the editor closes or a row goes: a word's rename button, or «+ New category».
const ADD = '__add__';

// The Ricettario's categories (the one place they are made, 28 Nov 2026): rename, remove, add, each written at once and
// local-first (recipesStore), so there is no Save to press. A word is trimmed and never the same as another (capitals and
// accents not counting); the order is alphabetical in the interface language, with no way to move one.
//
// ⚠️ REMOVING A WORD DELETES NO RECIPE AND REWRITES NONE (P20: asked first, and the question says how many move): the word only
// leaves the list and the recipes read «No category», until the word is put back.
// ⚠️ RENAMING REWRITES EVERY RECIPE HOLDING THE WORD (recipesStore.renameRecipeCategory), and, for somebody who may write Food cost's
// categories, the Food cost category with that name, so its cards stay together.
export function RecipeCategoriesDialog({ onClose }: Props) {
  const { t, locale } = useT();
  const store = useRecipesStore();
  const services = useDataServices();
  const { locationId, location, canManage, role } = useSession();
  const { categories, recipes, renaming: saving } = useRecipes();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState<{ kind: CategoryRefusal; name: string } | null>(null);
  const [failed, setFailed] = useState<'put-back' | 'unfinished' | 'offline' | null>(null);
  const [foodCostRetry, setFoodCostRetry] = useState<{ from: string; to: string } | null>(null);
  const say = useStatusMessage();
  const online = useOnline();
  const inputId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const list = useMemo(() => sortedCategories(categories, locale), [categories, locale]);
  const mayWriteFoodCost = mayOpenFoodCost(location, canManage, role);

  // A name half typed is an unsaved edit: a reload the app starts by itself waits (session/busy.ts).
  const typing = editing !== null;
  useEffect(() => (typing ? markBusy() : undefined), [typing]);
  // The box takes the focus when it opens (to rename, or to name a new one).
  useEffect(() => { if (typing) input.current?.focus(); }, [typing, editing?.word]);

  // The focus goes back to a button the person can see, once the editor is closed and the rows are drawn (after the confirm's own
  // focus restore, which runs on the next frame: the last word is ours).
  useEffect(() => {
    if (focusTarget === null || editing !== null) return;
    const frame = requestAnimationFrame(() => {
      (focusTarget === ADD ? addButton.current : renameButtons.current.get(focusTarget))?.focus();
      setFocusTarget(null);
    });
    return () => { cancelAnimationFrame(frame); };
  }, [focusTarget, editing, list]);

  const problemText = (found: { kind: CategoryRefusal; name: string }): string => {
    if (found.kind === 'tooLong') return t('cat.shelf.refusal.tooLong', { n: RECIPE_CATEGORY_MAX });
    if (found.kind === 'taken') return t('cat.shelf.refusal.taken', { name: found.name });
    if (found.kind === 'full') return t('cat.shelf.refusal.full', { n: RECIPE_CATEGORIES_MAX });
    return t('cat.shelf.refusal.empty');
  };

  // A refused write puts the list back (the store does) and says so in one line; a rename only partly accepted says so instead.
  const said = (write: Promise<void>): void => {
    setFailed(null);
    write.catch((err: unknown) => { setFailed(err instanceof RenameNotFinished ? 'unfinished' : 'put-back'); });
  };

  // Food cost's own documents follow the recipes' rename. A failure stays in the dialog with «Retry», which asks again for this pair.
  const runFoodCost = async (from: string, to: string): Promise<void> => {
    if (!mayWriteFoodCost || locationId === null) return;
    const outcome = await renameFoodcostCategory(services.foodcost(locationId), from, to);
    setFoodCostRetry(outcome === 'failed' ? { from, to } : null);
  };

  // ⚠️ THE APP DOES NOT RELOAD BY ITSELF while a rename is in the air, Food cost's half included: its later steps live in this page's
  // memory. The mark is held here, not in an effect, so closing the dialog does not let it go.
  const startRename = (from: string, to: string): void => {
    setFailed(null);
    setFoodCostRetry(null);
    const release = markBusy();
    const written = store.renameRecipeCategory(from, to);
    written.catch((err: unknown) => {
      if (err instanceof RenameNotFinished) say(t('cat.dlg.renameNotFinished'));
      setFailed(err instanceof RenameNotFinished ? 'unfinished' : 'put-back');
    });
    void written.then(() => runFoodCost(from, to)).catch(() => undefined).finally(release);
  };

  const retryFoodCost = (pair: { from: string; to: string }): void => {
    setFoodCostRetry(null);
    const release = markBusy();
    void runFoodCost(pair.from, pair.to).catch(() => undefined).finally(release);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const typed = editing.text.trim().replace(/\s+/g, ' ');
    // Block, say why, and stay on the box.
    const refuse = (kind: CategoryRefusal) => {
      setProblem({ kind, name: typed });
      input.current?.focus();
    };
    if (editing.word === null) {
      const added = addCategory(categories, editing.text);
      if ('refusal' in added) { refuse(added.refusal); return; }
      const word = added.list[added.list.length - 1] ?? typed;
      said(store.addRecipeCategory(word));
      setFocusTarget(word);
    } else {
      const renamed = renameCategory(categories, editing.word, editing.text);
      if ('refusal' in renamed) { refuse(renamed.refusal); return; }
      if (renamed.word !== editing.word) {
        // ⚠️ A RENAME NEEDS THE SERVER: its steps wait for each other and live in this page's memory, so offline nothing is sent and
        // the box keeps what was typed.
        if (!online) { setFailed('offline'); input.current?.focus(); return; }
        startRename(editing.word, renamed.word);
      }
      setFocusTarget(renamed.word);
    }
    setEditing(null);
    setProblem(null);
  };

  const cancel = () => {
    setFocusTarget(editing?.word ?? ADD);
    setEditing(null);
    setProblem(null);
  };

  // ⚠️ «Done» WITH A NAME STILL BEING TYPED never throws it away in silence (P20): it asks. A box that is empty, or a rename left as it
  // was, has nothing to lose.
  async function done() {
    const typed = editing === null ? '' : editing.text.trim();
    if (typed === '' || typed === (editing?.word ?? '')) { onClose(); return; }
    const discard = await confirm({
      title: t('cat.dlg.discardTitle'),
      message: t('cat.dlg.discardQ', { name: typed }),
      okLabel: t('cat.dlg.discardOk'),
      cancelLabel: t('cat.dlg.keepEditing'),
      danger: true,
    });
    if (discard) onClose(); else input.current?.focus();
  }

  async function remove(word: string) {
    const n = countInCategory(recipes, word, categories);
    const yes = await confirm({
      title: t('cat.dlg.removeTitle'),
      message: n === 0 ? t('cat.dlg.removeQEmpty', { name: word }) : t('cat.dlg.removeQ', { name: word, n }),
      okLabel: t('cat.dlg.removeOk'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!yes) return;
    // The focus moves to the next row's rename button, or to «+ New category» when it was the last.
    setFocusTarget(list[list.indexOf(word) + 1] ?? ADD);
    said(store.removeRecipeCategory(word));
  }

  const editor = (
    <form className={styles.editor} onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="visually-hidden">{t('cat.dlg.nameLabel')}</label>
      <input
        id={inputId}
        ref={input}
        type="text"
        autoComplete="off"
        className={styles.input}
        maxLength={RECIPE_CATEGORY_MAX}
        placeholder={t('cat.dlg.nameLabel')}
        value={editing?.text ?? ''}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : errorId}
        onChange={event => {
          setEditing(current => (current === null ? null : { ...current, text: event.target.value }));
          setProblem(null);
        }}
        onKeyDown={event => { if (event.key === 'Escape' && typing) { event.stopPropagation(); cancel(); } }}
      />
      <Button type="submit" variant="primary" className={styles.icon} aria-label={t('cat.dlg.save')}>
        <Check aria-hidden="true" />
      </Button>
      <Button className={styles.icon} aria-label={t('common.cancel')} onPress={cancel}>
        <X aria-hidden="true" />
      </Button>
      <p id={errorId} className={styles.error} role="alert">{problem === null ? '' : problemText(problem)}</p>
    </form>
  );

  return (
    <>
      <Dialog
        isOpen
        onClose={() => { if (!typing) onClose(); else cancel(); }}
        title={t('cat.dlg.title')}
        actions={<Button variant="primary" onPress={() => { void done(); }}>{t('cat.dlg.done')}</Button>}
      >
        {list.length === 0 && editing === null ? <p className={styles.empty}>{t('cat.shelf.settingsEmpty')}</p> : (
          <ul className={styles.rows}>
            {list.map(word => (
              <li key={word} className={styles.row}>
                {editing !== null && editing.word === word ? editor : (
                  <>
                    <span className={styles.name}>{word}</span>
                    <span className={styles.count}>{t('cat.dlg.recipes', { n: countInCategory(recipes, word, categories) })}</span>
                    <Button
                      ref={node => { if (node) renameButtons.current.set(word, node); else renameButtons.current.delete(word); }}
                      className={styles.icon}
                      aria-label={t('cat.dlg.rename', { name: word })}
                      isDisabled={saving} onPress={() => { setEditing({ word, text: word }); setProblem(null); }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    {/* Delete is small and low-key (P20): a bare icon, in danger only on hover and focus. */}
                    <Button
                      variant="bare"
                      className={styles.remove}
                      aria-label={t('cat.dlg.remove', { name: word })}
                      isDisabled={saving} onPress={() => { void remove(word); }}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </>
                )}
              </li>
            ))}
            {editing !== null && editing.word === null ? <li className={styles.row}>{editor}</li> : null}
          </ul>
        )}
        {editing === null ? (
          <Button ref={addButton} className={styles.add} isDisabled={saving} onPress={() => { setEditing({ word: null, text: '' }); setProblem(null); }}>
            {t('cat.dlg.new')}
          </Button>
        ) : null}
        <p className={styles.status} role="status">{saving ? t('cat.dlg.saving') : ''}</p>
        <p className={styles.error} role="alert">{failed === null ? '' : t(FAILED_TEXT[failed])}</p>
        {foodCostRetry === null ? null : (
          <div className={styles.retry}>
            <span role="alert">{t('cat.dlg.foodCostNotUpdated')}</span>
            <Button onPress={() => { retryFoodCost(foodCostRetry); }}>{t('cat.dlg.retry')}</Button>
          </div>
        )}
      </Dialog>
      {confirmDialog}
    </>
  );
}
