import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Checkbox } from 'react-aria-components';
import { addDays, parseISODate, toISODate } from '@mise/shared/day';
import { Check, Plus } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { FoldedGroup, useFoldedOpen } from '../ui/FoldedGroup';
import { groupTodos } from './todoModel';
import type { TodoGroup } from './todoModel';
import { shortDayText, dayHeading } from './todoWords';
import { TodoForm } from './TodoForm';
import type { FocusAfter } from './TodoForm';
import { useTodayKey } from './useTodayKey';
import { useTodos, useTodosStore } from './TodosContext';
import type { TodoItem } from './todosSource';
import styles from './TodoCard.module.css';

type FormState = { readonly item: TodoItem | null } | null;

// The «Da fare» card (docs/parity/home.md): the venue's list, grouped by day, ticked in one tap.
export function TodoCard() {
  const { t } = useT();
  const store = useTodosStore();
  const { status, items } = useTodos();
  const today = useTodayKey();
  const tomorrow = useMemo(() => toISODate(addDays(parseISODate(today), 1)), [today]);
  const [form, setForm] = useState<FormState>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const pendingFocus = useRef<FocusAfter | null>(null);

  const groups = useMemo(() => groupTodos(items, today, Date.now()), [items, today]);

  // ⚠️ THE FOCUS GOES BACK AFTER THE FORM IS GONE: the form's modal hands the focus back to what opened it by itself, a
  // frame later, and that may be a row that has since moved to another day or a button that is no longer there.
  useEffect(() => {
    if (form !== null || pendingFocus.current === null) return undefined;
    const target = pendingFocus.current;
    pendingFocus.current = null;
    const element = () => (target === 'add' ? addRef.current : rowButtons.current.get(target.row) ?? addRef.current);
    element()?.focus();
    const frame = requestAnimationFrame(() => { element()?.focus(); });
    return () => { cancelAnimationFrame(frame); };
  }, [form]);

  const close = (focusAfter: FocusAfter) => {
    pendingFocus.current = focusAfter;
    setForm(null);
  };

  const row = (item: TodoItem, tag: string | null) => (
    <li key={item.id} className={styles.row}>
      <Checkbox
        className={styles.check}
        isSelected={item.done}
        onChange={selected => { store.setDone(item.id, selected); }}
        aria-label={item.text}
      >
        <span className={styles.box} aria-hidden="true"><Check /></span>
      </Checkbox>
      <Button
        variant="bare"
        className={item.done ? `${styles.text} ${styles.ticked}` : styles.text}
        ref={element => {
          if (element) rowButtons.current.set(item.id, element);
          else rowButtons.current.delete(item.id);
        }}
        onPress={() => { setForm({ item }); }}
      >
        <span className={styles.words}>{item.text}</span>
        {tag === null ? null : <span className={styles.tag}>{tag}</span>}
      </Button>
    </li>
  );

  const list = (group: TodoGroup) => (
    <ul className={styles.rows}>
      {group.items.map(item => {
        if (group.kind === 'overdue') return row(item, t('home.overdueDay', { day: shortDayText(item.day, t) }));
        if (group.kind === 'later' || group.kind === 'done') return row(item, shortDayText(item.day, t));
        return row(item, null);
      })}
    </ul>
  );

  return (
    <section className={styles.card} aria-labelledby="home-todo-title">
      <div className={styles.head}>
        <h2 id="home-todo-title" className={styles.title}>{t('home.title')}</h2>
        <Button ref={addRef} variant="primary" onPress={() => { setForm({ item: null }); }}>
          <Plus aria-hidden="true" />
          {t('home.add')}
        </Button>
      </div>

      {/* Present from the start and filled only when the stream fails, so the sentence is announced. */}
      <div role="status" className={styles.notice}>
        {status === 'error' ? <p>{t('home.err.load')}</p> : null}
      </div>

      {status === 'loading' ? <p className={styles.quiet}>{t('session.loading')}</p> : null}
      {status === 'ready' && groups.length === 0 ? <p className={styles.quiet}>{t('home.empty')}</p> : null}

      {groups.map(group => {
        if (group.kind === 'later') {
          return <Folded key="later" title={t('home.later', { n: group.items.length })}>{list(group)}</Folded>;
        }
        if (group.kind === 'done') {
          return <Folded key="done" title={t('home.done', { n: group.items.length })}>{list(group)}</Folded>;
        }
        const heading = group.kind === 'overdue' ? t('home.overdue') : dayHeading(group, t);
        return (
          <div key={group.kind === 'day' ? group.day : 'overdue'} className={styles.group}>
            <h3 className={group.kind === 'overdue' ? `${styles.groupTitle} ${styles.late}` : styles.groupTitle}>{heading}</h3>
            {list(group)}
          </div>
        );
      })}

      {form === null ? null : (
        <TodoForm key={form.item?.id ?? 'new'} item={form.item} today={today} tomorrow={tomorrow} onClose={close} />
      )}
    </section>
  );
}

// A folded group, closed until opened; its open state lives here, so a new snapshot never closes it.
function Folded({ title, children }: { title: string; children: ReactNode }) {
  const { open, onToggle } = useFoldedOpen(false);
  return <FoldedGroup title={title} open={open} onToggle={onToggle}>{children}</FoldedGroup>;
}
