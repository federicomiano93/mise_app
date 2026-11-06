import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useBlocker } from 'react-router';
import { FieldError, Input, Label, Text, TextField } from 'react-aria-components';
import { Trash2 } from 'lucide-react';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { FormDialog } from '../ui/FormDialog';
import { useConfirm } from '../ui/useConfirm';
import { TODO_TEXT_MAX } from './todosSource';
import type { TodoItem } from './todosSource';
import { useTodosStore } from './TodosContext';
import styles from './TodoForm.module.css';

const DAY_RE = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

// Where the focus goes when the form closes: the row's own button after an edit, «Add» otherwise.
export type FocusAfter = { readonly row: string } | 'add';

type Props = {
  // Null: a new item. Otherwise the one being edited.
  item: TodoItem | null;
  // Today, «YYYY-MM-DD»: the default day of a new item, and what «Today» / «Tomorrow» are counted from.
  today: string;
  tomorrow: string;
  onClose: (focusAfter: FocusAfter) => void;
};

// The add / edit form (docs/parity/home.md, H8), in a modal ABOVE the Home: it has no address of its own.
// Editing works on a copy; nothing is written until Save, and Save has no «Save?» question (a to-do must be quick).
//
// ⚠️ THE FORM CLOSES AT ONCE AND NEVER AWAITS THE WRITE (todosStore.ts): a refusal comes back as the status message.
// ⚠️ Typing marks the app busy (a self-started reload would throw it away) and blocks leaving the screen by any
// way (the router's blocker), exactly as the other editors do.
export function TodoForm({ item, today, tomorrow, onClose }: Props) {
  const { t } = useT();
  const store = useTodosStore();
  const [confirm, confirmDialog] = useConfirm();
  const dayId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(item?.text ?? '');
  const [day, setDay] = useState(item?.day ?? today);
  const [needsText, setNeedsText] = useState(false);

  const dirty = text !== (item?.text ?? '') || day !== (item?.day ?? today);
  const dirtyRef = useRef(dirty);
  const leaving = useRef(false);
  const asking = useRef(false);
  const mounted = useRef(true);
  const after: FocusAfter = item ? { row: item.id } : 'add';

  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const discardQuestion = useCallback(() => confirm({
    title: t('home.form.discard'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // A way out the form did not offer (the rail, the browser's Back) with typing in it asks the same question as Back.
  const blocker = useBlocker(useCallback(() => dirtyRef.current && !leaving.current, []));
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          leaving.current = true;
          current.proceed();
          onClose(after);
        } else {
          current.reset();
        }
      } catch (error) {
        asking.current = false;
        throw error;
      }
    })();
  });

  const back = async () => {
    if (dirty && !(await discardQuestion())) return;
    leaving.current = true;
    onClose(after);
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    // P20: block, jump to the empty field and say so.
    if (clean === '') {
      setNeedsText(true);
      inputRef.current?.focus();
      return;
    }
    leaving.current = true;
    if (item === null) store.add(clean, day);
    else if (clean !== item.text || day !== item.day) store.edit(item.id, clean, day);
    onClose(after);
  };

  const remove = async () => {
    if (item === null) return;
    const ok = await confirm({
      title: t('home.delete.title', { text: item.text }),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!ok) return;
    leaving.current = true;
    store.remove(item.id);
    onClose('add');
  };

  const title = item === null ? t('home.form.new') : t('home.form.edit');

  return (
    <>
      <FormDialog label={title}>
        <form noValidate onSubmit={save}>
          <FormBar
            backLabel={t('ui.back')}
            onBack={() => { void back(); }}
            title={title}
            action={<Button variant="primary" type="submit">{t('ui.save')}</Button>}
          />
          <div className={styles.body}>
            <TextField
              className={styles.field}
              value={text}
              onChange={value => { setText(value); setNeedsText(false); }}
              maxLength={TODO_TEXT_MAX}
              autoFocus={item === null}
              validationBehavior="aria"
              isInvalid={needsText}
            >
              <Label className={styles.label}>{t('home.form.text')}</Label>
              <Input ref={inputRef} className={styles.input} placeholder={t('home.form.placeholder')} />
              <Text slot="description" className={styles.counter}>
                {t('home.form.counter', { used: String(text.length), max: String(TODO_TEXT_MAX) })}
              </Text>
              <FieldError className={styles.error}>
                {needsText ? <span role="alert">{t('home.form.needText')}</span> : null}
              </FieldError>
            </TextField>

            <div className={styles.field}>
              <label htmlFor={dayId} className={styles.label}>{t('home.form.day')}</label>
              <div className={styles.quick}>
                <Button className={styles.quickButton} aria-pressed={day === today} onPress={() => { setDay(today); }}>
                  {t('day.today')}
                </Button>
                <Button className={styles.quickButton} aria-pressed={day === tomorrow} onPress={() => { setDay(tomorrow); }}>
                  {t('day.tomorrow')}
                </Button>
              </div>
              {/* A day typed by hand arrives whole («YYYY-MM-DD») or empty; an empty one keeps the day, and `max`
                  keeps the year at four digits, which is all the rules accept. */}
              <input
                id={dayId}
                type="date"
                className={styles.input}
                value={day}
                max="9999-12-31"
                onChange={event => { if (DAY_RE.test(event.target.value)) setDay(event.target.value); }}
              />
            </div>

            {item === null ? null : (
              <div className={styles.low}>
                <Button variant="bare" className={styles.trash} aria-label={t('ui.delete')} onPress={() => { void remove(); }}>
                  <Trash2 aria-hidden="true" />
                </Button>
              </div>
            )}
          </div>
        </form>
      </FormDialog>
      {confirmDialog}
    </>
  );
}
