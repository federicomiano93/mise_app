import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Pencil, Trash2, X } from 'lucide-react';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useConfirm } from '../ui/useConfirm';
import { MAX_CATEGORY_NAME, cardCounts, categoryNameProblem } from './categoriesModel';
import type { CategoryNameProblem } from './categoriesModel';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import styles from './CategoriesDialog.module.css';

type Props = {
  // Closed by «Done» or Escape.
  onClose: () => void;
};

// What the row being typed in is: a new category, or an existing one renamed.
type Editing = { id: string | null; text: string };

// Where the focus goes when the editor closes or a row goes: a category's rename button, or «+ New category».
const ADD = '__add__';

// The categories the list groups cards by (model 4, 20 Nov 2026), in the order of the list: rename, remove, add. Everything is
// written at once and local-first (foodcostStore.saveCategory): there is no Save to press, the way the products' own list has none
// for its search. A name is trimmed, 1 to 60 characters, and never the same as another's (capitals and accents not counting).
//
// ⚠️ REMOVING A CATEGORY DELETES NO CARD (P20: asked first, and the question says how many cards move): only its document goes, and a
// card holding its id reads as «no category».
export function CategoriesDialog({ onClose }: Props) {
  const { t } = useT();
  const store = useFoodcostStore();
  const { categories, products } = useFoodcost();
  // ⚠️ REMOVING IS THE MANAGERS' ONLY, as deleting a card is (the rules refuse anybody else): the control is not drawn for the rest.
  const { canManage } = useSession();
  const [confirm, confirmDialog] = useConfirm();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [problem, setProblem] = useState<CategoryNameProblem | null>(null);
  const inputId = useId();
  const errorId = useId();
  const input = useRef<HTMLInputElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const counts = useMemo(() => cardCounts(products, categories), [products, categories]);

  // A name half typed is an unsaved edit: a reload the app starts by itself waits (session/busy.ts).
  const typing = editing !== null;
  useEffect(() => (typing ? markBusy() : undefined), [typing]);
  // The box takes the focus when it opens (to rename, or to name a new one).
  useEffect(() => { if (typing) input.current?.focus(); }, [typing, editing?.id]);

  // The focus goes back to a button the person can see, once the editor is closed and the rows are drawn (after the confirm's own
  // focus restore, which runs on the next frame: the last word is ours).
  useEffect(() => {
    if (focusTarget === null || editing !== null) return;
    const frame = requestAnimationFrame(() => {
      (focusTarget === ADD ? addButton.current : renameButtons.current.get(focusTarget))?.focus();
      setFocusTarget(null);
    });
    return () => { cancelAnimationFrame(frame); };
  }, [focusTarget, editing, categories]);

  const problemText = (kind: CategoryNameProblem): string => {
    if (kind === 'empty') return t('fc.cat.problem.empty');
    if (kind === 'too-long') return t('fc.cat.problem.tooLong', { max: MAX_CATEGORY_NAME });
    return t('fc.cat.problem.duplicate', { name: editing?.text.trim() ?? '' });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const found = categoryNameProblem(editing.text, categories, editing.id);
    if (found !== null) {
      // Block, say why, and stay on the box.
      setProblem(found);
      input.current?.focus();
      return;
    }
    const savedId = store.saveCategory(editing.text, editing.id ?? undefined);
    setEditing(null);
    setProblem(null);
    setFocusTarget(savedId);
  };

  const cancel = () => {
    setFocusTarget(editing?.id ?? ADD);
    setEditing(null);
    setProblem(null);
  };

  // ⚠️ «Done» WITH A NAME STILL BEING TYPED never throws it away in silence (P20): it asks. A box that is empty, or a rename left as it
  // was, has nothing to lose.
  async function done() {
    const typed = editing === null ? '' : editing.text.trim();
    const original = editing?.id == null ? '' : (categories.find(category => category.id === editing.id)?.name ?? '');
    if (typed === '' || typed === original) { onClose(); return; }
    const discard = await confirm({
      title: t('fc.cat.discardTitle'),
      message: t('fc.cat.discardQ', { name: typed }),
      okLabel: t('fc.cat.discardOk'),
      cancelLabel: t('fc.cat.keepEditing'),
      danger: true,
    });
    if (discard) onClose(); else input.current?.focus();
  }

  async function remove(id: string, name: string) {
    const n = counts.get(id) ?? 0;
    const yes = await confirm({
      title: t('fc.cat.removeTitle'),
      message: n === 0 ? t('fc.cat.removeQEmpty', { name }) : t('fc.cat.removeQ', { name, n }),
      okLabel: t('fc.cat.removeOk'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!yes) return;
    // The focus moves to the next row's rename button, or to «+ New category» when it was the last.
    const at = categories.findIndex(category => category.id === id);
    setFocusTarget(categories[at + 1]?.id ?? ADD);
    store.deleteCategory(id);
  }

  const editor = (
    <form className={styles.editor} onSubmit={submit} noValidate>
      <label htmlFor={inputId} className="visually-hidden">{t('fc.cat.nameLabel')}</label>
      <input
        id={inputId}
        ref={input}
        type="text"
        autoComplete="off"
        className={styles.input}
        placeholder={t('fc.cat.nameLabel')}
        value={editing?.text ?? ''}
        aria-invalid={problem !== null}
        aria-describedby={problem === null ? undefined : errorId}
        onChange={event => {
          setEditing(current => (current === null ? null : { ...current, text: event.target.value }));
          setProblem(null);
        }}
        onKeyDown={event => { if (event.key === 'Escape' && typing) { event.stopPropagation(); cancel(); } }}
      />
      <Button type="submit" variant="primary" className={styles.icon} aria-label={t('fc.cat.save')}>
        <Check aria-hidden="true" />
      </Button>
      <Button className={styles.icon} aria-label={t('fc.cat.cancel')} onPress={cancel}>
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
        title={t('fc.cat.title')}
        actions={<Button variant="primary" onPress={() => { void done(); }}>{t('fc.cat.done')}</Button>}
      >
        {categories.length === 0 && editing === null ? <p className={styles.empty}>{t('fc.cat.empty')}</p> : (
          <ul className={styles.rows}>
            {categories.map(category => (
              <li key={category.id} className={styles.row}>
                {editing !== null && editing.id === category.id ? editor : (
                  <>
                    <span className={styles.name}>{category.name}</span>
                    <span className={styles.count}>{t('fc.cat.cards', { n: counts.get(category.id) ?? 0 })}</span>
                    <Button
                      ref={node => { if (node) renameButtons.current.set(category.id, node); else renameButtons.current.delete(category.id); }}
                      className={styles.icon}
                      aria-label={t('fc.cat.rename', { name: category.name })}
                      onPress={() => { setEditing({ id: category.id, text: category.name }); setProblem(null); }}
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    {/* Delete is small and low-key (P20): a bare icon, in danger only on hover and focus. */}
                    {canManage ? (
                      <Button
                        variant="bare"
                        className={styles.remove}
                        aria-label={t('fc.cat.remove', { name: category.name })}
                        onPress={() => { void remove(category.id, category.name); }}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    ) : null}
                  </>
                )}
              </li>
            ))}
            {editing !== null && editing.id === null ? <li className={styles.row}>{editor}</li> : null}
          </ul>
        )}
        {editing === null ? (
          <Button ref={addButton} className={styles.add} onPress={() => { setEditing({ id: null, text: '' }); setProblem(null); }}>
            {t('fc.cat.new')}
          </Button>
        ) : null}
        <p className={styles.hint}>{t('fc.cat.hint')}</p>
      </Dialog>
      {confirmDialog}
    </>
  );
}
