import { useEffect, useId, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { expiresIn } from '@mise/shared/join-code';
import type { JoinCodeKind } from '@mise/shared/join-code';
import { joinLinkFor } from '@mise/shared/join-link';
import { ROLE_CHOICES } from '@mise/shared/membership';
import type { ManagerTitle, Role, RoleChoice, RoleChoiceKey } from '@mise/shared/membership';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { copyToClipboard } from '../ui/clipboard';
import { useSendSheet } from '../ui/SendSheet';
import { useAlert } from '../ui/useAlert';
import { inviteRefusal } from './inviteRefusal';
import type { Invitation } from './settingsSource';
import { useSettingsSource } from './useSettingsSource';
import styles from './InviteCard.module.css';

// Each choice's word, and the sentence saying what it can do: the current app's (js/roles.js, js/staff/people.js ROLE_MEANS).
const LABEL: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'role.owner',
  'owner-sales': 'role.ownerSales',
  'owner-kitchen': 'role.ownerKitchen',
  manager: 'role.manager',
  'head-chef': 'role.headChef',
  staff: 'role.staff',
};

const MEANS: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'role.means.owner',
  'owner-sales': 'role.means.ownerSales',
  'owner-kitchen': 'role.means.ownerKitchen',
  manager: 'role.means.manager',
  'head-chef': 'role.means.headChef',
  staff: 'role.means.staff',
};

// ⚠️ THE FORM THAT GOES INSIDE A SENTENCE IS ASKED FOR, NEVER COMPUTED: lowercasing somebody else's language is the translator's
// business (js/roles.js personLabelInSentence).
const IN_SENTENCE: Readonly<Record<RoleChoiceKey, MessageKey>> = {
  owner: 'role.owner.inSentence',
  'owner-sales': 'role.ownerSales.inSentence',
  'owner-kitchen': 'role.ownerKitchen.inSentence',
  manager: 'role.manager.inSentence',
  'head-chef': 'role.headChef.inSentence',
  staff: 'role.staff.inSentence',
};

// The choice a role and title read as: the title matters on the manager level only.
function choiceKeyOf(role: Role, title: ManagerTitle | null): RoleChoiceKey {
  if (role === 'manager') return title === 'head-chef' ? 'head-chef' : 'manager';
  return role;
}

// The invite card of «Who can get in» (the full owner only — SettingsSection keeps everybody else out, and the Cloud Function refuses
// them too). A port of the role-first invitation of js/staff/people.js (#475).
//
// ⚠️ NO ROLE IS CHOSEN AT THE START, AND NONE AFTER DONE. A role kept from the last invitation made the kitchen porter invited after a
// co-owner an owner too. Nothing is sent until a role is chosen: the buttons say what is missing and point at the list instead.
//
// ⚠️ THE ROLES ARE A LIST, NOT A DROP-DOWN (decision D2 of docs/parity/staff-plan.md): a stray arrow key on a closed drop-down, or the
// iPhone's picker, could pick Owner by itself (fix ff7046a8). Every choice is on screen with what it can do, so the owner reads what a
// role grants BEFORE sending, and the chosen one is told by its tint and its weight as well as by the radio.
//
// ⚠️ SIX DIGITS ONLY FOR AN EMPLOYEE (security audit, 7 Oct 2026): a guessed manager or owner code is a stranger running the venue, and
// a link cannot be guessed. The server refuses it as well; hiding the button only spares the owner the refusal.
//
// ⚠️ THE RESULT IS SHOWN ONCE AND NEVER STORED. The server keeps only a fingerprint, so this screen is the only place the code exists in
// readable form: it lives in this component's state and nowhere else (no storage, no console, no usage line). While it is on screen,
// and while the server makes it, the card holds markBusy(): a reload by an update would throw away a code half read out.
export function InviteCard() {
  const { t } = useT();
  const { name: venueName } = useSession();
  const source = useSettingsSource();
  const [alert, alertDialog] = useAlert();
  const [send, sendSheet] = useSendSheet();
  const ids = useId();
  const [chosen, setChosen] = useState<RoleChoice | null>(null);
  const [missing, setMissing] = useState(false);
  const [making, setMaking] = useState<JoinCodeKind | null>(null);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  // ⚠️ ONE CALL PER TAP, read at once (the state is only read on the next render): a double tap must not mint two keys.
  const inFlight = useRef(false);
  const alive = useRef(true);
  const roleGroup = useRef<HTMLDivElement>(null);
  const resultStart = useRef<HTMLParagraphElement>(null);
  const buttons = useRef(new Map<JoinCodeKind, HTMLButtonElement>());
  // The clock the time left is read against: set when a result appears, moved on every minute while it is on screen and when the
  // device comes back to the foreground, so a result nobody closed comes to say «expired» rather than «24 hours left» for ever.
  const [now, setNow] = useState(() => Date.now());
  // Where the keyboard goes after the next render: the result's first line, the list of roles (after Done), or the button that was
  // pressed (after a refusal has been read).
  const [focusNext, setFocusNext] = useState<'result' | 'roles' | JoinCodeKind | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const expired = invitation !== null && now >= invitation.expiresAt;

  // ⚠️ A HOLD MUST END (session/busy.ts): a result nobody closed on the lab tablet would otherwise keep it off every update for good.
  // The code is unrepeatable only while it can still be used, so the hold ends when it expires, as well as at Done and on leaving.
  const held = making !== null || (invitation !== null && !expired);
  useEffect(() => (held ? markBusy() : undefined), [held]);

  useEffect(() => {
    if (invitation === null) return undefined;
    const tick = () => { setNow(Date.now()); };
    tick();
    const minute = setInterval(tick, 60_000);
    // One timer to the very moment it dies, so the hold ends then and not up to a minute later. Capped: a browser runs a delay
    // longer than about 24.8 days at once.
    const end = setTimeout(tick, Math.min(Math.max(invitation.expiresAt - Date.now(), 0) + 50, 2_000_000_000));
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(minute);
      clearTimeout(end);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [invitation]);

  useEffect(() => {
    if (focusNext === null || making !== null) return;
    if (focusNext === 'result') resultStart.current?.focus();
    else if (focusNext === 'roles') roleGroup.current?.focus();
    else buttons.current.get(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext, making]);

  // An employee, or no role yet: both buttons show, so the owner sees both ways; tapping either with no role says what is missing.
  const digitsOffered = chosen === null || chosen.role === 'staff';

  async function make(kind: JoinCodeKind): Promise<void> {
    if (inFlight.current) return;
    if (chosen === null) {
      // FOCUS FIRST, then the new text: the list is read with its description as it takes the focus, and the live note then speaks
      // the change once rather than the same words twice (the current app's order). ⚠️ THE LIST, NOT ITS FIRST RADIO: a radio chooses
      // on an arrow key, and the first one is Owner — one stray key from there would choose a role nobody meant (fix ff7046a8).
      roleGroup.current?.focus();
      setMissing(true);
      return;
    }
    inFlight.current = true;
    setMaking(kind);
    try {
      // ⚠️ THE ROLE AND THE SHAPE SHOWN ARE THE SERVER'S ANSWER, never what was asked (settingsSource.ts Invitation).
      const made = await source.createInvitation(chosen.role, chosen.title, kind);
      if (!alive.current) return;
      announceAction('join-code-made');
      setInvitation(made);
      setFocusNext('result');
      setMaking(null);
    } catch (err) {
      if (!alive.current) return;
      // The error's code only: the request carried no code, but a report needs no more than that to tell a refusal from no signal.
      console.error('Making an invitation failed:', (err as { code?: unknown } | null)?.code ?? 'no code');
      // ⚠️ MAKING ENDS BEFORE THE ALERT, so the live region does not keep saying «Making the invitation…» under the refusal.
      setMaking(null);
      await alert({ message: t(inviteRefusal(err)), okLabel: t('common.ok') });
      if (alive.current) setFocusNext(kind);
    } finally {
      inFlight.current = false;
    }
  }

  function choose(choice: RoleChoice): void {
    setChosen(choice);
    setMissing(false);
  }

  function done(): void {
    setInvitation(null);
    setChosen(null);
    setMissing(false);
    setFocusNext('roles');
  }

  async function copy(link: string): Promise<void> {
    const copied = await copyToClipboard(link);
    if (!alive.current) return;
    // ⚠️ THE LINK STAYS ON SCREEN AS TEXT WHATEVER THE CLIPBOARD DID, and when it refused the notice repeats it to copy by hand.
    await alert(copied
      ? { message: t('people.link.copied'), okLabel: t('common.ok') }
      : { message: [t('people.link.manual'), link], okLabel: t('common.ok') });
  }

  if (invitation !== null) {
    const role = t(IN_SENTENCE[choiceKeyOf(invitation.role, invitation.title)]);
    const left = expiresIn(invitation, now);
    const expires = t(`join.expires.${left.unit}`, { n: left.n });

    if (invitation.kind === 'digits') {
      return (
        <div className={styles.result}>
          <p ref={resultStart} tabIndex={-1} className={styles.lead}>{t('people.readOut')}</p>
          <p className={styles.digits}>{invitation.code}</p>
          <p className={styles.note}>{t('people.joinsAs', { role, expires, button: t('auth.iHaveACode') })}</p>
          <div className={styles.actions}>
            <Button onPress={done}>{t('people.done')}</Button>
          </div>
          {alertDialog}
        </div>
      );
    }

    const link = joinLinkFor(invitation.code);
    return (
      <div className={styles.result}>
        <p ref={resultStart} tabIndex={-1} className={styles.lead}>{t('people.link.intro')}</p>
        <p className={styles.link}>{link}</p>
        <p className={styles.note}>{t('people.link.joinsAs', { role, expires })}</p>
        <div className={styles.actions}>
          {/* ⚠️ THE MESSAGE NAMES THE VENUE: «open this link» and nothing else is what every scam sent over WhatsApp looks like. */}
          <Button variant="primary" onPress={() => { send({ subject: venueName, text: t('people.link.message', { venue: venueName, link }) }); }}>
            <Send aria-hidden="true" className={styles.icon} />
            <span>{t('ui.send')}</span>
          </Button>
          <Button onPress={() => { void copy(link); }}>{t('people.link.copy')}</Button>
          <Button onPress={done}>{t('people.done')}</Button>
        </div>
        {sendSheet}
        {alertDialog}
      </div>
    );
  }

  const groupLabel = `${ids}-roles`;
  const noteId = `${ids}-note`;
  let note = '';
  if (missing) note = t('people.role.missing');
  else if (chosen === null) note = t('people.role.choosePrompt');

  return (
    <div className={styles.card}>
      <p className={styles.intro}>{t('people.invite.intro')}</p>
      <p id={groupLabel} className={styles.legend}>{t('people.roleGroup')}</p>
      <div
        ref={roleGroup}
        role="radiogroup"
        // Focusable by the code only (after Done, or when a role is missing), never a Tab stop of its own.
        tabIndex={-1}
        aria-labelledby={groupLabel}
        aria-describedby={noteId}
        aria-required="true"
        aria-invalid={missing || undefined}
        className={styles.roles}
        data-invalid={missing || undefined}
      >
        {ROLE_CHOICES.map(choice => {
          const checked = chosen?.key === choice.key;
          const nameId = `${ids}-${choice.key}-name`;
          const meansId = `${ids}-${choice.key}-means`;
          return (
            <label key={choice.key} className={styles.role} data-checked={checked}>
              <input
                type="radio"
                name={`${ids}-role`}
                value={choice.key}
                checked={checked}
                disabled={making !== null}
                // Named by the role's word alone, described by what it can do: «Employee, radio button, 1 of 6», then the sentence.
                aria-labelledby={nameId}
                aria-describedby={meansId}
                className={styles.radio}
                onChange={() => { choose(choice); }}
              />
              <span className={styles.roleText}>
                <span id={nameId} className={styles.roleName}>{t(LABEL[choice.key])}</span>
                <span id={meansId} className={styles.means}>{t(MEANS[choice.key])}</span>
              </span>
            </label>
          );
        })}
      </div>
      {/* There from the start, so what it says is announced. */}
      <p id={noteId} aria-live="polite" className={missing ? styles.error : styles.note}>{note}</p>

      <div className={styles.actions}>
        <Button
          ref={node => { if (node) buttons.current.set('link', node); else buttons.current.delete('link'); }}
          variant="primary"
          isDisabled={making !== null}
          onPress={() => { void make('link'); }}
        >
          {t('people.add.link')}
        </Button>
        {digitsOffered ? (
          <Button
            ref={node => { if (node) buttons.current.set('digits', node); else buttons.current.delete('digits'); }}
            isDisabled={making !== null}
            onPress={() => { void make('digits'); }}
          >
            {t('people.add.digits')}
          </Button>
        ) : null}
      </div>
      {/* Why the code button has just gone, heard as well as seen. */}
      <p aria-live="polite" className={styles.note}>{digitsOffered ? '' : t('people.add.digitsStaffOnly')}</p>
      <p role="status" className={styles.status}>{making !== null ? t('people.making') : ''}</p>
      {alertDialog}
    </div>
  );
}
