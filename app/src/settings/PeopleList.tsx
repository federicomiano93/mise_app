import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { UserMinus } from 'lucide-react';
import type { RoleChoice } from '@mise/shared/membership';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { memberRefusal } from './inviteRefusal';
import type { MemberAction } from './inviteRefusal';
import { fullName, nameForButtons, sortMembers } from './peopleModel';
import { createPeopleStore } from './peopleStore';
import { RenameDialog } from './RenameDialog';
import { RolePicker } from './RolePicker';
import { ROLE_CONFIRM, ROLE_IN_SENTENCE, ROLE_LABEL, ROLE_MEANS, choiceKeyOf } from './roleWords';
import type { Member } from './settingsSource';
import { useSettingsSource } from './useSettingsSource';
import styles from './PeopleList.module.css';

type Control = 'role' | 'rename' | 'remove';
const controlKey = (uid: string, control: Control) => `${uid}|${control}`;

// The error's code only: a console line reaches the owner's error reports, and a roster holds emails and surnames.
function codeOf(error: unknown): string {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : 'no code';
}

// The people list of «Who can get in» (staff slice 4), under the invite card: everybody in the venue, most power first, then by name.
// A port of the roster of js/staff/people.js. The full owner only — SettingsSection keeps everybody else off the screen, and the Cloud
// Functions behind every button refuse them too (P2: the server is the lock, this screen is the courtesy).
//
// ⚠️ NO BUTTONS ON YOUR OWN ROW. Demoting yourself is the one change here that the person who made it cannot undo; the server refuses
// the last owner as well, but a screen that offers a tap and then explains why not is worse than one that does not offer it.
// ⚠️ EVERY CHANGE ASKS FIRST AND WAITS FOR THE SERVER: nothing on screen changes until the roster itself does (the live listener hears
// the server's own write), so the list never shows a role or a name the server has not agreed to. A refusal is said in the app's words
// (inviteRefusal.ts memberRefusal) and the keyboard goes back to the button pressed.
// ⚠️ ONE CALL PER TAP, AND ONE CHANGE AT A TIME (a ref, read at once): a double tap must not send two changes, and two changes in the air
// to the same venue's roster could cross. While one is with the server the screen holds markBusy() and says «Saving…».
export function PeopleList() {
  const { t, lang } = useT();
  const { user } = useSession();
  const myUid = user?.uid ?? null;
  const source = useSettingsSource();
  const [store] = useState(() => createPeopleStore(source));
  useEffect(() => {
    store.start();
    return () => { store.stop(); };
  }, [store]);
  const { status, members } = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const collator = useMemo(() => new Intl.Collator(lang, { sensitivity: 'base', numeric: true }), [lang]);
  const sorted = useMemo(() => sortMembers(members, collator.compare), [members, collator]);

  const headingId = useId();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const [picking, setPicking] = useState<Member | null>(null);
  const [renaming, setRenaming] = useState<Member | null>(null);
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  const controls = useRef(new Map<string, HTMLButtonElement>());
  // Where the keyboard goes after the next render: a row's button, or the list's heading (its row gone).
  const [focusNext, setFocusNext] = useState<string | 'heading' | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => (saving ? markBusy() : undefined), [saving]);

  useEffect(() => {
    if (focusNext === null) return;
    const target = focusNext === 'heading' ? null : controls.current.get(focusNext);
    (target ?? heading.current)?.focus();
    setFocusNext(null);
  }, [focusNext, sorted]);

  // The name a question or a button uses: the person's, else their email, else «(no name yet)».
  const nameOf = (person: Member) => nameForButtons(person) || t('people.noNameYet');

  // Sends one change: 'saved' once the server has it, 'busy' when another change is still in the air (nothing sent), or the refusal to say.
  async function send(action: MemberAction, call: () => Promise<void>, done: string): Promise<'saved' | 'busy' | { refused: string }> {
    if (inFlight.current) return 'busy';
    inFlight.current = true;
    setSaving(true);
    try {
      await call();
      // Counted by name only: never who, never what.
      announceAction(done);
      return 'saved';
    } catch (err) {
      console.error('A change in the people list failed:', codeOf(err));
      return { refused: t(memberRefusal(err, action)) };
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  }

  function openPicker(person: Member): void {
    if (inFlight.current) return;
    setPicking(person);
  }

  async function pick(person: Member, choice: RoleChoice): Promise<void> {
    setPicking(null);
    const back = controlKey(person.uid, 'role');
    const current = person.role === null ? null : choiceKeyOf(person.role, person.title);
    if (choice.key === current || inFlight.current) {
      setFocusNext(back);
      return;
    }
    // ⚠️ THE QUESTION SAYS WHAT THE ROLE DOES, not only its name: the sentence is the whole decision (js/staff/people.js change()).
    const ok = await confirm({
      title: t(ROLE_CONFIRM[choice.key], { name: nameOf(person) }),
      message: t(ROLE_MEANS[choice.key]),
      okLabel: t('people.make', { role: t(ROLE_IN_SENTENCE[choice.key]) }),
      cancelLabel: t('common.cancel'),
      // Taking power away is the direction that surprises somebody mid-shift.
      danger: choice.role === 'staff',
    });
    if (!alive.current) return;
    if (!ok) {
      setFocusNext(back);
      return;
    }
    const sent = await send('role', () => source.setMemberRole(person.uid, choice.role, choice.title), 'member-role-changed');
    if (!alive.current) return;
    if (typeof sent === 'object') await alert({ message: sent.refused, okLabel: t('common.ok') });
    if (alive.current) setFocusNext(back);
  }

  function openRename(person: Member): void {
    if (inFlight.current) return;
    setRenaming(person);
  }

  async function rename(person: Member, firstName: string, lastName: string): Promise<string | null> {
    const sent = await send('name', () => source.setMemberName(person.uid, firstName, lastName), 'member-renamed');
    if (typeof sent === 'object') return sent.refused;
    // Another change still in the air: nothing was sent, and the form stays with its typing (its Save is off meanwhile).
    if (sent === 'busy') return '';
    if (alive.current) {
      setRenaming(null);
      setFocusNext(controlKey(person.uid, 'rename'));
    }
    return null;
  }

  async function remove(person: Member): Promise<void> {
    if (inFlight.current) return;
    const ok = await confirm({
      title: t('people.remove.title'),
      message: t('people.remove.message', { name: fullName(person) || t('people.noNameYet'), email: person.email || t('people.noEmail') }),
      okLabel: t('people.remove'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (!alive.current) return;
    const back = controlKey(person.uid, 'remove');
    if (!ok) {
      setFocusNext(back);
      return;
    }
    const sent = await send('remove', () => source.setMemberRole(person.uid, null, null), 'member-removed');
    if (!alive.current) return;
    if (sent === 'saved') {
      // The row goes with the roster's answer: the keyboard goes to the list's heading, never to the top of the page.
      setFocusNext('heading');
      return;
    }
    if (typeof sent === 'object') await alert({ message: sent.refused, okLabel: t('common.ok') });
    if (alive.current) setFocusNext(back);
  }

  const bind = (uid: string, control: Control) => (node: HTMLButtonElement | null) => {
    if (node) controls.current.set(controlKey(uid, control), node);
    else controls.current.delete(controlKey(uid, control));
  };

  const others = sorted.filter(person => person.uid !== myUid);

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      <h3 id={headingId} ref={heading} tabIndex={-1} className={styles.heading}>
        {status === 'ready' && members.length > 0
          ? t('people.section.members', { n: members.length })
          : t('people.section.membersPlain')}
      </h3>
      {/* There from the start, so what they say is announced. */}
      <p role="alert" className={styles.error}>{status === 'error' ? t('people.err.read') : ''}</p>
      <p role="status" className={styles.status}>{saving ? t('people.saving') : ''}</p>

      {sorted.length > 0 ? (
        <ul className={styles.list}>
          {sorted.map(person => {
            const isMe = person.uid === myUid;
            const name = nameOf(person);
            const roleWord = t(ROLE_LABEL[person.role === null ? 'staff' : choiceKeyOf(person.role, person.title)]);
            return (
              <li key={person.uid} className={styles.row}>
                <div className={styles.who}>
                  <span className={styles.name}>{(fullName(person) || t('people.noNameYet')) + (isMe ? t('people.you') : '')}</span>
                  <span className={styles.role}>{roleWord}</span>
                  <span className={styles.email}>{person.email || t('people.noEmailParen')}</span>
                </div>
                {isMe ? null : (
                  <div className={styles.actions}>
                    <Button
                      ref={bind(person.uid, 'role')}
                      className={styles.action}
                      aria-label={t('people.changeRoleOf', { name })}
                      onPress={() => { openPicker(person); }}
                    >
                      {t('people.changeRole')}
                    </Button>
                    <Button
                      ref={bind(person.uid, 'rename')}
                      className={styles.action}
                      aria-label={t('people.renameOf', { name })}
                      onPress={() => { openRename(person); }}
                    >
                      {t('people.rename')}
                    </Button>
                    {/* ⚠️ SMALL AND LOW-KEY (P20): an icon at the end of the row, never a red button competing with the others. */}
                    <Button
                      ref={bind(person.uid, 'remove')}
                      variant="bare"
                      className={styles.remove}
                      aria-label={t('people.removeOf', { name })}
                      onPress={() => { void remove(person); }}
                    >
                      <UserMinus aria-hidden="true" className={styles.icon} />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
      {status === 'ready' && others.length === 0 ? <p className={styles.empty}>{t('people.empty')}</p> : null}

      {picking === null ? null : (
        <RolePicker
          name={nameOf(picking)}
          current={picking.role === null ? null : choiceKeyOf(picking.role, picking.title)}
          onPick={choice => { void pick(picking, choice); }}
          onClose={() => {
            const back = controlKey(picking.uid, 'role');
            setPicking(null);
            setFocusNext(back);
          }}
        />
      )}
      {renaming === null ? null : (
        <RenameDialog
          person={renaming}
          saving={saving}
          onSave={(firstName, lastName) => rename(renaming, firstName, lastName)}
          onClose={() => {
            const back = controlKey(renaming.uid, 'rename');
            setRenaming(null);
            setFocusNext(back);
          }}
        />
      )}
      {confirmDialog}
      {alertDialog}
    </section>
  );
}
