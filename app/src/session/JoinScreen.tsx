import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';
import { nameProblem } from '@mise/shared/credentials';
import type { NameProblemKey } from '@mise/shared/credentials';
import { normalizeTyped } from '@mise/shared/join-code';
import { kindOfTyped } from '@mise/shared/join-link';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/useConfirm';
import { markBusy } from './busy';
import { GateScreen } from './GateScreen';
import { joinRefusal } from './joinErrors';
import type { JoinRefusal } from './joinErrors';
import { useJoinFlowStore } from './JoinFlowContext';
import { useSession, useSessionStore } from './SessionContext';
import { SignOutButton } from './SignOutButton';
import styles from './JoinScreen.module.css';

type Field = 'first' | 'last' | 'code';
type Problem = { field: Field; key: NameProblemKey | 'join.shapeHint' };
// The server's answer, kept as a key so it is worded in the language on screen when it is drawn. `id` makes two identical
// refusals in a row two announcements, not one.
type Notice = { id: number; refusal: JoinRefusal } | { id: number; busy: 'join.checking' | 'join.opening' };

// The join form of an account that is ALREADY SIGNED IN (staff slice 1, docs/parity/staff-plan.md): a port of joinScreen in
// js/auth-gate.js with `needsAccount: false`. Reached from «No venue yet» («I have a join code»), by opening an invitation
// link (the code is filled in), and — for somebody already in a venue — after «Add it» (InviteQuestion.tsx). The form for a
// NEW account (email and password twice) is slice 2.
//
// ⚠️⚠️ IT STAYS ON SCREEN UNTIL THE SERVER ANSWERS (current-app fix 9e0a2dac). Joining is ONE call that can take seconds on a
// cold function. While it runs: «Join» is pending, the fields are read-only, Back is off (a way out mid-check would leave the
// answer landing nowhere), the session's self-started reloads and a new release wait (markBusy), and the gate keeps this very
// screen through whatever the session does meanwhile (joinFlow `sending` + SessionGate's keepJoinForm). A refusal is then said
// HERE, in the app's own words (joinErrors.ts), and the form is ready for another try with everything still in its boxes.
//
// ⚠️⚠️ THE CODE IS A KEY TO A VENUE. It goes to the function and nowhere else: this file never logs it, never reports it,
// and the usage line names this screen `join` and nothing more. The invitation is forgotten after joining and on Back.
export function JoinScreen() {
  const { t } = useT();
  const session = useSession();
  const store = useSessionStore();
  const flowStore = useJoinFlowStore();
  // The invitation this form was opened for, read ONCE: the form is keyed on the flow's formKey, so a new invitation
  // builds a new form rather than rewriting this one under somebody's fingers.
  const [prefill] = useState(() => flowStore.getSnapshot().invited);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [code, setCode] = useState(prefill);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const refs = {
    first: useRef<HTMLInputElement>(null),
    last: useRef<HTMLInputElement>(null),
    code: useRef<HTMLInputElement>(null),
  };
  const noticeCount = useRef(0);
  // ⚠️ A SECOND TAP MUST NOT BE A SECOND CALL: every call spends one of this account's five tries an hour. Read at once, unlike
  // the state, which a second event in the same moment would still see as «not sending».
  const inFlight = useRef(false);
  const mounted = useRef(true);
  // Set again on every mount: React's StrictMode (the dev server) mounts, unmounts and mounts again.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ⚠️ WHICH ACCOUNT THE CODE WILL JOIN, SAID BEFORE IT IS SPENT (current-app fix 1a3567b9, his note of 3 Nov 2026). The code
  // is redeemed for whoever is signed in on this device — on a shared kitchen phone that may be a former employee, or the
  // newcomer's own account from a first try — and it is single use: a wrong account costs a new code.
  const account = session.user?.email || session.user?.uid || '';

  const say = (next: { refusal: JoinRefusal } | { busy: 'join.checking' | 'join.opening' }) => {
    noticeCount.current += 1;
    setNotice({ id: noticeCount.current, ...next });
  };

  const fieldProps = (field: Field) => ({
    isInvalid: problem?.field === field,
    isReadOnly: sending,
    validationBehavior: 'aria' as const,
  });
  const fieldError = (field: Field) => (
    <FieldError className={styles.error}>
      {problem?.field === field ? <span role="alert">{t(problem.key)}</span> : null}
    </FieldError>
  );

  // Say what is wrong and put the cursor in the box it is about. null when the form is worth sending.
  //
  // ⚠️ EVERY CHECK RUNS BEFORE THE NETWORK, and the reason is not tidiness: each call — even a malformed one — spends one of
  // this account's five join attempts an hour. A blank surname must not cost somebody one of five real tries.
  function check(): Problem | null {
    const first = nameProblem(firstName, 'first');
    if (first) return { field: 'first', key: first };
    const last = nameProblem(lastName, 'last');
    if (last) return { field: 'last', key: last };
    // Two shapes reach this box: six digits read down a phone, or the 32-character token of a link.
    if (!kindOfTyped(code)) return { field: 'code', key: 'join.shapeHint' };
    return null;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const wrong = check();
    if (wrong) {
      setNotice(null);
      setProblem(wrong);
      refs[wrong.field].current?.focus();
      return;
    }
    // The kind decides how the code is normalised as well as what it is called: case is folded for digits and KEPT for a
    // link, where folding destroys it.
    const kind = kindOfTyped(code) ?? 'digits';
    // Who sends it, and for which invitation: both are compared when the answer comes back.
    const sender = session.user?.uid ?? '';
    const invitation = flowStore.getSnapshot().invited;
    const typed = normalizeTyped(code, kind);
    setProblem(null);
    inFlight.current = true;
    setSending(true);
    say({ busy: 'join.checking' });
    // ⚠️ MARKED BEFORE THE CALL: from here until the answer, the gate keeps this form (js/join-hold.js) and nothing reloads.
    flowStore.sending();
    const release = markBusy();
    let locationId: string;
    try {
      locationId = await store.redeemJoinCode(typed, kind, firstName, lastName);
    } catch (error) {
      const refusal = joinRefusal(error);
      // ⚠️ «ALREADY IN THIS BUSINESS» CANNOT BE CHANGED BY TRYING AGAIN, so the invitation is dropped (the current app does the
      // same): left in place it would be offered again for the life of the window. The code itself is untouched on the server.
      if (refusal.key === 'join.alreadyMember') flowStore.forget(invitation);
      flowStore.answered();
      inFlight.current = false;
      release();
      if (mounted.current) {
        setSending(false);
        say({ refusal });
      }
      return;
    }
    // ⚠️ FORGOTTEN THE MOMENT IT HAS BEEN USED, before anything else can fail: it is single use, and a secret with no reason
    // to still be around should not be.
    flowStore.forget(invitation);
    if (mounted.current) say({ busy: 'join.opening' });
    try {
      await store.openJoinedVenue(locationId, sender);
      flowStore.finish();
    } catch {
      // ⚠️ THE JOIN SUCCEEDED; only opening the venue on this page did not. Saying «could not check the code» now would be
      // false, and a retry would only be told «already in this business». A fresh page opens the venue the session finds.
      flowStore.finish();
      window.location.reload();
    } finally {
      release();
    }
  }

  // ⚠️ BACK ASKS BEFORE THROWING TYPING AWAY (P20). A code filled in by a link was not typed, so it alone asks nothing.
  async function back() {
    if (sending) return;
    const typed = firstName.trim() !== '' || lastName.trim() !== '' || code !== prefill;
    if (typed && !(await confirm({
      title: t('join.discard.title'), okLabel: t('ui.discard'), cancelLabel: t('common.cancel'), danger: true,
    }))) return;
    // Cancel forgets the invitation (docs/parity/staff-plan.md, «Security»).
    flowStore.cancel();
  }

  return (
    <GateScreen
      title={t(prefill ? 'join.title.invited' : 'join.title.have')}
      subtitle={t(prefill ? 'join.sub.prefill' : 'join.sub.have')}
    >
      {account ? (
        <div className={styles.account}>
          <p id="join-for-account">{t('join.forAccount')}</p>
          <p id="join-for-address" className={styles.address}>{account}</p>
        </div>
      ) : null}
      <SignOutButton variant="quiet" label={t('auth.otherAccount')} isDisabled={sending} />

      <form
        className={styles.form}
        noValidate
        // Focus lands straight in «Your first name», past the sentence above: tied to the form, a screen reader still says
        // which account the code is for.
        aria-describedby={account ? 'join-for-account join-for-address' : undefined}
        onSubmit={event => { void submit(event); }}
      >
        <TextField
          className={styles.field}
          name="given-name"
          autoComplete="given-name"
          autoFocus
          value={firstName}
          onChange={value => { setFirstName(value); if (problem?.field === 'first') setProblem(null); }}
          {...fieldProps('first')}
        >
          <Label className={styles.label}>{t('join.firstName')}</Label>
          <Input ref={refs.first} className={styles.input} autoCapitalize="words" />
          {fieldError('first')}
        </TextField>

        <TextField
          className={styles.field}
          name="family-name"
          autoComplete="family-name"
          value={lastName}
          onChange={value => { setLastName(value); if (problem?.field === 'last') setProblem(null); }}
          {...fieldProps('last')}
        >
          <Label className={styles.label}>{t('join.lastName')}</Label>
          <Input ref={refs.last} className={styles.input} autoCapitalize="words" />
          {fieldError('last')}
        </TextField>

        <TextField
          className={styles.field}
          name="one-time-code"
          autoComplete="one-time-code"
          // A numeric keypad for six digits; arrived by link, the box already holds 32 characters nobody types.
          inputMode={prefill ? 'text' : 'numeric'}
          value={code}
          onChange={value => { setCode(value); if (problem?.field === 'code') setProblem(null); }}
          {...fieldProps('code')}
        >
          <Label className={styles.label}>{t('join.code')}</Label>
          <Input ref={refs.code} className={`${styles.input} ${styles.code}`} autoCapitalize="off" spellCheck={false} />
          {fieldError('code')}
        </TextField>

        {/* The wait is said in a live region that is there before it speaks (a region inserted already filled is not
            announced reliably); the refusal is an alert, a new one per answer. */}
        <p className={styles.wait} data-filled={notice !== null && 'busy' in notice ? 'true' : undefined} role="status">
          {notice !== null && 'busy' in notice ? t(notice.busy) : null}
        </p>
        {notice !== null && 'refusal' in notice ? (
          <p key={notice.id} className={styles.notice} data-kind="error" role="alert">
            {notice.refusal.key === 'join.tooManyMinutes'
              ? t(notice.refusal.key, { n: notice.refusal.n })
              : t(notice.refusal.key)}
          </p>
        ) : null}

        <Button type="submit" variant="primary" block isPending={sending}>{t('join.join')}</Button>
      </form>

      <div className={styles.ways}>
        <Button variant="quiet" isDisabled={sending} onPress={() => { void back(); }}>{t('auth.back')}</Button>
      </div>
      {confirmDialog}
    </GateScreen>
  );
}
