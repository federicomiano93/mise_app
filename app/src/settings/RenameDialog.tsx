import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { useBlocker } from 'react-router';
import { FieldError, Input, Label, TextField } from 'react-aria-components';
import { cleanName, MAX_NAME_LENGTH, nameProblem } from '@mise/shared/credentials';
import type { NameProblemKey } from '@mise/shared/credentials';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { useConfirm } from '../ui/useConfirm';
import { nameForButtons } from './peopleModel';
import type { Member } from './settingsSource';
import styles from './RenameDialog.module.css';

// The checks of the shared name rule, said about SOMEBODY ELSE: the join form's «Enter your first name» is about the person typing.
const PROBLEM: Readonly<Record<NameProblemKey, MessageKey>> = {
  'help.enterYourFirstName': 'people.name.firstMissing',
  'help.enterYourSurname': 'people.name.lastMissing',
  'help.thatFirstNameNeeds': 'help.thatFirstNameNeeds',
  'help.thatSurnameNeedsLetters': 'help.thatSurnameNeedsLetters',
};

// «Rename» of one row of the people list (staff slice 4): first and last name, a port of js/staff/people.js renameRow(). A name is a
// label — it changes nothing a person may do (`setMemberName` writes the roster only, never users/{uid}).
//
// ⚠️ EDITED ON A COPY, NOTHING SAVED UNTIL SAVE. Both boxes are checked first (the shared name rule, as the current app does; the server
// refuses only both blank): the wrong one is outlined, the reason is under it, the cursor goes there, and nothing is sent.
// ⚠️ THE DIALOG STAYS UNTIL THE SERVER ANSWERS: a refusal is said inside it, with the typing kept. While the call is in the air the boxes
// are read-only and Cancel is off — leaving would not undo it.
// Enter in either box saves, as Save does.
// ⚠️ TYPING IS NEVER THROWN AWAY BY ITSELF (P20): Cancel, Escape and any way out of the screen (the browser's Back, the phone's back
// gesture) ask «Discard changes?» first, and the busy marker keeps an update from reloading the page under it.
export function RenameDialog({ person, saving, onSave, onClose }: {
  person: Member;
  // A change is with the server (this one, or another started before the dialog opened).
  saving: boolean;
  // Sends the new name. Resolves with the refusal to say ('' when nothing could be sent yet), or null once the server has it (the list
  // then closes the dialog).
  onSave: (firstName: string, lastName: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const { t } = useT();
  const formId = useId();
  const [confirm, confirmDialog] = useConfirm();
  const [first, setFirst] = useState(person.firstName);
  const [last, setLast] = useState(person.lastName);
  const [firstProblem, setFirstProblem] = useState<MessageKey | null>(null);
  const [lastProblem, setLastProblem] = useState<MessageKey | null>(null);
  const [refusal, setRefusal] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);
  const lastRef = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  const leaving = useRef(false);
  const asking = useRef(false);

  const dirty = cleanName(first) !== person.firstName || cleanName(last) !== person.lastName;
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const savingRef = useRef(saving);
  useEffect(() => { savingRef.current = saving; }, [saving]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const discardQuestion = useCallback(() => confirm({
    title: t('people.discard'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // A way out the dialog did not offer, with typing in it, asks the same question as Cancel. ⚠️ WHILE THE NAME IS WITH THE SERVER it is
  // refused without a question (code review): «Discard changes?» would offer to throw away a change that lands anyway, and a refusal
  // arriving after the screen had gone would be said to nobody. Cancel and Escape are off meanwhile for the same reason.
  const blocker = useBlocker(useCallback(() => (dirtyRef.current || savingRef.current) && !leaving.current, []));
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked') {
      asking.current = false;
      return;
    }
    if (savingRef.current) {
      blocker.reset();
      return;
    }
    if (asking.current) return;
    asking.current = true;
    void discardQuestion().then(discard => {
      const current = latestBlocker.current;
      if (!mounted.current || current.state !== 'blocked') return;
      if (discard) {
        leaving.current = true;
        current.proceed();
      } else {
        current.reset();
      }
    });
  });

  async function cancel(): Promise<void> {
    if (saving) return;
    if (dirty && !(await discardQuestion())) return;
    if (!mounted.current) return;
    leaving.current = true;
    onClose();
  }

  // ⚠️ ENTER IS HANDLED HERE, not left to the browser: Save sits in the dialog's button row, outside the <form>, and a browser's own
  // «Enter submits» is not something every engine does for a button tied to the form only by its `form` attribute.
  function enterSaves(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void save();
  }

  async function save(event?: FormEvent): Promise<void> {
    event?.preventDefault();
    if (saving) return;
    const firstKey = nameProblem(first, 'first');
    const lastKey = nameProblem(last, 'last');
    setFirstProblem(firstKey === null ? null : PROBLEM[firstKey]);
    setLastProblem(lastKey === null ? null : PROBLEM[lastKey]);
    if (firstKey !== null || lastKey !== null) {
      setRefusal('');
      (firstKey !== null ? firstRef : lastRef).current?.focus();
      return;
    }
    // Nothing changed: nothing to tell the server.
    if (!dirty) {
      leaving.current = true;
      onClose();
      return;
    }
    setRefusal('');
    const refused = await onSave(cleanName(first), cleanName(last));
    if (!mounted.current) return;
    if (refused === null) {
      leaving.current = true;
      return;
    }
    setRefusal(refused);
    firstRef.current?.focus();
  }

  return (
    <Dialog
      isOpen
      onClose={() => { void cancel(); }}
      title={t('people.renameOf', { name: nameForButtons(person) || t('people.noNameYet') })}
      actions={
        <>
          <Button isDisabled={saving} onPress={() => { void cancel(); }}>{t('common.cancel')}</Button>
          {/* Pending, not disabled: the button keeps the keyboard while the server answers (a disabled one drops it to the page). */}
          <Button variant="primary" type="submit" form={formId} isPending={saving}>{t('ui.save')}</Button>
        </>
      }
    >
      <form id={formId} noValidate className={styles.form} onSubmit={event => { void save(event); }}>
        <TextField
          className={styles.field}
          value={first}
          onChange={value => { setFirst(value); setFirstProblem(null); }}
          maxLength={MAX_NAME_LENGTH}
          isReadOnly={saving}
          autoFocus
          autoComplete="off"
          validationBehavior="aria"
          isInvalid={firstProblem !== null}
        >
          <Label className={styles.label}>{t('people.firstName')}</Label>
          <Input ref={firstRef} className={styles.input} onKeyDown={enterSaves} />
          <FieldError className={styles.error}>{firstProblem === null ? null : t(firstProblem)}</FieldError>
        </TextField>
        <TextField
          className={styles.field}
          value={last}
          onChange={value => { setLast(value); setLastProblem(null); }}
          maxLength={MAX_NAME_LENGTH}
          isReadOnly={saving}
          autoComplete="off"
          validationBehavior="aria"
          isInvalid={lastProblem !== null}
        >
          <Label className={styles.label}>{t('people.surname')}</Label>
          <Input ref={lastRef} className={styles.input} onKeyDown={enterSaves} />
          <FieldError className={styles.error}>{lastProblem === null ? null : t(lastProblem)}</FieldError>
        </TextField>
        {/* There from the start, so what it says is announced: the server's refusal, or «Saving…». */}
        <p role="alert" className={styles.refusal}>{refusal}</p>
        <p role="status" className={styles.status}>{saving ? t('people.saving') : ''}</p>
      </form>
      {confirmDialog}
    </Dialog>
  );
}
