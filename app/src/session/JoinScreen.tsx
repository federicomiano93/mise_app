import { useEffect, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';
import {
  confirmProblem, emailConfirmProblem, MIN_PASSWORD_LENGTH, nameProblem, passwordProblem,
} from '@mise/shared/credentials';
import { normalizeTyped } from '@mise/shared/join-code';
import { kindOfTyped } from '@mise/shared/join-link';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/useConfirm';
import { authCodeOf, signInErrorKey } from './authErrors';
import type { SessionUser } from './backend';
import { markBusy } from './busy';
import { GateScreen } from './GateScreen';
import { InstallGuideLink } from './InstallGuideLink';
import { joinRefusal } from './joinErrors';
import type { JoinRefusal } from './joinErrors';
import { useJoinFlowStore } from './JoinFlowContext';
import { useSession, useSessionStore } from './SessionContext';
import { SignOutButton } from './SignOutButton';
import styles from './JoinScreen.module.css';

type Field = 'first' | 'last' | 'email' | 'email2' | 'password' | 'password2' | 'code';
type Problem = { field: Field; key: MessageKey };
type Busy = 'join.checking' | 'join.creating' | 'join.checkingCode' | 'join.opening';
// The answer, kept as a key so it is worded in the language on screen when it is drawn. Each answer is a new state (`id`),
// and the wait in between empties the alert, so two identical refusals in a row are spoken twice. `auth` is a sign-up that
// failed for a reason that is about no one field (no connection, too many tries).
type Notice =
  | { id: number; refusal: JoinRefusal }
  | { id: number; auth: MessageKey }
  | { id: number; busy: Busy };

// The join form: a port of joinScreen in js/auth-gate.js, both of its kinds.
//
//  · For an account ALREADY SIGNED IN (staff slice 1, `needsAccount: false`): name and code. Reached from «No venue yet» («I have
//    a join code»), by opening an invitation link (the code is filled in), and — for somebody already in a venue — after «Add
//    it» (InviteQuestion.tsx).
//  · For a NEW account (staff slice 2, `needsAccount: true`): name, email twice, password twice, code. Reached SIGNED OUT, from
//    the sign-in screen's «I have a join code», or by opening an invitation link with nobody signed in.
//
// ⚠️⚠️ IT STAYS ON SCREEN UNTIL THE SERVER ANSWERS (current-app fix 9e0a2dac). Joining can take seconds on a cold function, and
// for a new account it is TWO steps — create the account (which signs it in and moves the session by itself), then redeem the
// code. While they run: «Join» is pending, the fields are read-only, Back is off, the session's self-started reloads wait
// (markBusy), the session holds the new account's sign-in still (session.ts signUpHeld), and the gate keeps this very screen
// (joinFlow `sending` + SessionGate's keepJoinForm). A refusal is then said HERE, in the app's own words.
//
// ⚠️⚠️ THE ACCOUNT WAS CREATED AND ONLY THE CODE FAILED: the form comes back FOR THAT ACCOUNT (current-app fix 9e0a2dac). It cannot
// be sent again as it was — its email and password would ask Firebase for a SECOND account with the same address. So the email
// and password boxes go, the account is named («The code will be used for this account:»), the name and the code stay in their
// boxes, the refusal is said, and the cursor goes to the code.
//
// ⚠️⚠️ THE CODE IS A KEY TO A VENUE, AND THE PASSWORD IS A PASSWORD. Both go to their one call and nowhere else: this file never
// logs, reports or keeps them, the passwords are dropped from memory the moment the account exists, and the usage line names
// this screen `join` and nothing more.
export function JoinScreen() {
  const { t } = useT();
  const session = useSession();
  const store = useSessionStore();
  const flowStore = useJoinFlowStore();
  // The invitation this form was opened for, read ONCE: the form is keyed on the flow's formKey, so a new invitation
  // builds a new form rather than rewriting this one under somebody's fingers.
  const [prefill] = useState(() => flowStore.getSnapshot().invited);
  // Which kind of form, decided ONCE, when it opens: signed out, there is no account yet. The session moves while it is sent
  // (signed-out → loading), and the form must not change kind under the person because of it.
  const [needsAccount] = useState(() => session.status === 'signed-out');
  // The account this form created, once the code was then refused: the form is now for it.
  const [created, setCreated] = useState<SessionUser | null>(null);
  const newAccount = needsAccount && created === null;
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [email2, setEmail2] = useState('');
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const [code, setCode] = useState(prefill);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [sending, setSending] = useState(false);
  // The address Firebase said already has an account: «Sign in with that email» appears, the one way forward from there.
  const [takenEmail, setTakenEmail] = useState<string | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const refs: Record<Field, RefObject<HTMLInputElement | null>> = {
    first: useRef<HTMLInputElement>(null),
    last: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    email2: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
    password2: useRef<HTMLInputElement>(null),
    code: useRef<HTMLInputElement>(null),
  };
  const noticeCount = useRef(0);
  // ⚠️ A SECOND TAP MUST NOT BE A SECOND CALL: every call spends one of this account's five tries an hour (and a second
  // sign-up would be refused as «already has an account»). Read at once, unlike the state.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  // Set again on every mount: React's StrictMode (the dev server) mounts, unmounts and mounts again.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ⚠️ SOMEBODY ELSE SIGNED IN (another tab) while the form for a new account is up: a sign-up now would REPLACE that person's
  // session in every tab (code review, 13 Nov 2026). The form is opened again as the form for the account now signed in — the
  // invitation, if any, still filled in. Not while this form's own sign-up runs (inFlight), nor once it made its account.
  const someoneSignedIn = session.user !== null && session.status !== 'loading' && session.status !== 'signed-out';
  useEffect(() => {
    if (newAccount && someoneSignedIn && !inFlight.current) flowStore.openForm();
  }, [newAccount, someoneSignedIn, flowStore]);

  // ⚠️ THE FORM IS GONE (Back, «Sign in with a different account», a new invitation): an account it created and is holding still
  // is resolved now, as any sign-in is (session.ts releaseSignUp; nothing happens when nothing is held).
  useEffect(() => () => { store.releaseSignUp(); }, [store]);

  // The account was created and the code refused: the cursor goes where the answer is typed, and the refusal under «Join» is
  // brought into sight (on a 6.1" phone it sat just below the bottom edge in the current app, measured at 296 × 668).
  useEffect(() => {
    if (created === null) return;
    refs.code.current?.focus({ preventScroll: true });
    document.getElementById('join-refusal')?.scrollIntoView?.({ block: 'nearest' });
    // Only when the form changes kind (the refs are stable).
  }, [created]);

  // ⚠️ WHICH ACCOUNT THE CODE WILL JOIN, SAID BEFORE IT IS SPENT (current-app fix 1a3567b9, his note of 3 Nov 2026). The code
  // is redeemed for whoever is signed in on this device — on a shared kitchen phone that may be a former employee, or the
  // newcomer's own account from a first try — and it is single use: a wrong account costs a new code. A form that has just
  // created its account names that one (the session may not have caught up with it).
  const account = newAccount ? '' : (created?.email || created?.uid || session.user?.email || session.user?.uid || '');

  const say = (next: { refusal: JoinRefusal } | { auth: MessageKey } | { busy: Busy }) => {
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
      {problem?.field === field ? <span role="alert">{t(problem.key, { n: MIN_PASSWORD_LENGTH })}</span> : null}
    </FieldError>
  );
  const clearProblem = (field: Field) => { if (problem?.field === field) setProblem(null); };

  // Say what is wrong and put the cursor in the box it is about. null when the form is worth sending.
  //
  // ⚠️ EVERY CHECK RUNS BEFORE THE NETWORK, and the reason is not tidiness: each call — even a malformed one — spends one of
  // this account's five join attempts an hour. A blank surname must not cost somebody one of five real tries.
  // ⚠️ AND CREATING THE ACCOUNT COMES LAST, AFTER EVERYTHING IS VALID: a sign-up cannot be undone from here, so a form that
  // created the account and THEN complained about the surname would leave somebody holding an account on a screen that had just
  // refused them.
  function check(): Problem | null {
    const first = nameProblem(firstName, 'first');
    if (first) return { field: 'first', key: first };
    const last = nameProblem(lastName, 'last');
    if (last) return { field: 'last', key: last };
    if (newAccount) {
      if (!email.trim()) return { field: 'email', key: 'auth.enterEmail' };
      const sameEmail = emailConfirmProblem(email, email2);
      if (sameEmail) return { field: 'email2', key: sameEmail };
      const pass = passwordProblem(password, email);
      if (pass) return { field: 'password', key: pass };
      const again = confirmProblem(password, password2);
      if (again) return { field: 'password2', key: again };
    }
    // Two shapes reach this box: six digits read down a phone, or the 32-character token of a link.
    if (!kindOfTyped(code)) return { field: 'code', key: 'join.shapeHint' };
    return null;
  }

  function showProblem(wrong: Problem) {
    setNotice(null);
    setProblem(wrong);
    refs[wrong.field].current?.focus();
  }

  // Firebase refused to create the account, so none exists: the form stays as it is, the reason on the box it is about.
  function signUpRefused(error: unknown) {
    const reason = authCodeOf(error);
    const key = signInErrorKey(error);
    if (reason === 'auth/email-already-in-use') {
      // ⚠️ THE ONE REFUSAL WITH A WAY FORWARD, so it gets one: retyping cannot create an account that already exists.
      setTakenEmail(email.trim());
      showProblem({ field: 'email', key });
    } else if (reason === 'auth/invalid-email') {
      showProblem({ field: 'email', key });
    } else if (reason === 'auth/weak-password') {
      showProblem({ field: 'password', key });
    } else {
      say({ auth: key });
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const wrong = check();
    if (wrong) {
      showProblem(wrong);
      return;
    }
    // The kind decides how the code is normalised as well as what it is called: case is folded for digits and KEPT for a
    // link, where folding destroys it.
    const kind = kindOfTyped(code) ?? 'digits';
    const invitation = flowStore.getSnapshot().invited;
    const typed = normalizeTyped(code, kind);
    setProblem(null);
    setTakenEmail(null);
    inFlight.current = true;
    setSending(true);
    // ⚠️ MARKED BEFORE THE FIRST CALL: from here until the answer, the gate keeps this form (js/join-hold.js) and nothing reloads.
    flowStore.sending();
    const release = markBusy();
    const done = () => {
      flowStore.answered();
      inFlight.current = false;
      release();
      if (mounted.current) setSending(false);
    };

    // Who sends it: compared when the answer comes back. For a new account, the account is made first; for the account this
    // form made, that one (the session may not have caught up with it).
    let sender = created?.uid ?? session.user?.uid ?? '';
    let madeNow: SessionUser | null = null;
    if (newAccount) {
      say({ busy: 'join.creating' });
      try {
        madeNow = await store.signUp(email, password);
      } catch (error) {
        done();
        if (mounted.current) signUpRefused(error);
        return;
      }
      sender = madeNow.uid;
      // ⚠️ THE PASSWORDS ARE NOT NEEDED ANY MORE: dropped from memory now, whatever the code's answer.
      setPassword('');
      setPassword2('');
      if (mounted.current) say({ busy: 'join.checkingCode' });
    } else {
      say({ busy: 'join.checking' });
    }

    let locationId: string;
    try {
      locationId = await store.redeemJoinCode(typed, kind, firstName, lastName);
    } catch (error) {
      const refusal = joinRefusal(error);
      // ⚠️ «ALREADY IN THIS BUSINESS» CANNOT BE CHANGED BY TRYING AGAIN, so the invitation is dropped (the current app does the
      // same): left in place it would be offered again for the life of the window. The code itself is untouched on the server.
      if (refusal.key === 'join.alreadyMember') flowStore.forget(invitation);
      done();
      if (mounted.current) {
        // The account exists now: the form becomes the form for it (see the header).
        if (madeNow) setCreated(madeNow);
        say({ refusal });
      }
      return;
    }
    // ⚠️ FORGOTTEN THE MOMENT IT HAS BEEN USED, before anything else can fail: it is single use, and a secret with no reason
    // to still be around should not be.
    flowStore.forget(invitation);
    if (mounted.current) say({ busy: 'join.opening' });
    try {
      // For an account this form created, the session finishes the held sign-in and starts the page again on the venue.
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
    const typed = [firstName, lastName, email, email2].some(value => value.trim() !== '')
      || password !== '' || password2 !== '' || code !== prefill;
    if (typed && !(await confirm({
      title: t('join.discard.title'), okLabel: t('ui.discard'), cancelLabel: t('common.cancel'), danger: true,
    }))) return;
    // ⚠️ SIGNED OUT WITH AN INVITATION, BACK IS THE WAY TO SIGN IN, and the invitation goes along (the current app's way): the
    // person who already has an account must not lose the link on the way to the form that lets them use it. After the sign-in
    // it is offered as for anybody signed in (slice 1). Everywhere else, Back is Cancel and forgets it («Security»).
    if (newAccount && prefill) flowStore.signInInstead();
    else flowStore.cancel();
  }

  const titleKey: MessageKey = prefill ? 'join.title.invited' : newAccount ? 'join.title.new' : 'join.title.have';
  const subKey: MessageKey = prefill
    ? (newAccount ? 'join.sub.prefillNew' : 'join.sub.prefill')
    : (newAccount ? 'join.sub.new' : 'join.sub.have');
  const refusalShown = notice !== null && ('refusal' in notice || 'auth' in notice);

  return (
    <GateScreen title={t(titleKey)} subtitle={t(subKey)}>
      {account ? (
        <div className={styles.account}>
          <p id="join-for-account">{t('join.forAccount')}</p>
          <p id="join-for-address" className={styles.address}>{account}</p>
        </div>
      ) : null}
      {newAccount ? null : <SignOutButton variant="quiet" label={t('auth.otherAccount')} isDisabled={sending} />}

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
          onChange={value => { setFirstName(value); clearProblem('first'); }}
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
          onChange={value => { setLastName(value); clearProblem('last'); }}
          {...fieldProps('last')}
        >
          <Label className={styles.label}>{t('join.lastName')}</Label>
          <Input ref={refs.last} className={styles.input} autoCapitalize="words" />
          {fieldError('last')}
        </TextField>

        {newAccount ? (
          <>
            <TextField
              className={styles.field}
              type="email"
              name="email"
              autoComplete="username"
              inputMode="email"
              value={email}
              onChange={value => { setEmail(value); clearProblem('email'); setTakenEmail(null); }}
              {...fieldProps('email')}
            >
              <Label className={styles.label}>{t('join.email')}</Label>
              <Input ref={refs.email} className={styles.input} autoCapitalize="none" spellCheck={false} />
              {fieldError('email')}
            </TextField>

            {/* The email typed twice (decision D6). Autofill off on the second box, so it is really typed, not copied. */}
            <TextField
              className={styles.field}
              type="email"
              name="email-again"
              autoComplete="off"
              inputMode="email"
              value={email2}
              onChange={value => { setEmail2(value); clearProblem('email2'); }}
              {...fieldProps('email2')}
            >
              <Label className={styles.label}>{t('join.repeatEmail')}</Label>
              <Input ref={refs.email2} className={styles.input} autoCapitalize="none" spellCheck={false} />
              {fieldError('email2')}
            </TextField>

            <TextField
              className={styles.field}
              type="password"
              name="new-password"
              autoComplete="new-password"
              value={password}
              onChange={value => { setPassword(value); clearProblem('password'); }}
              {...fieldProps('password')}
            >
              <Label className={styles.label}>{t('join.choosePassword', { n: MIN_PASSWORD_LENGTH })}</Label>
              <Input ref={refs.password} className={styles.input} />
              {fieldError('password')}
            </TextField>

            {/* The same password again: it is typed into dots, so a slip would go unseen. */}
            <TextField
              className={styles.field}
              type="password"
              name="new-password-again"
              autoComplete="new-password"
              value={password2}
              onChange={value => { setPassword2(value); clearProblem('password2'); }}
              {...fieldProps('password2')}
            >
              <Label className={styles.label}>{t('join.repeatPassword')}</Label>
              <Input ref={refs.password2} className={styles.input} />
              {fieldError('password2')}
            </TextField>
          </>
        ) : null}

        <TextField
          className={styles.field}
          name="one-time-code"
          autoComplete="one-time-code"
          // A numeric keypad for six digits; arrived by link, the box already holds 32 characters nobody types.
          inputMode={prefill ? 'text' : 'numeric'}
          value={code}
          onChange={value => { setCode(value); clearProblem('code'); }}
          // Kept for the account it created, the form's refusal is about the code: tied to the box, a screen reader landing
          // there says why.
          aria-describedby={created !== null && refusalShown ? 'join-refusal' : undefined}
          {...fieldProps('code')}
        >
          <Label className={styles.label}>{t('join.code')}</Label>
          <Input ref={refs.code} className={`${styles.input} ${styles.code}`} autoCapitalize="off" spellCheck={false} />
          {fieldError('code')}
        </TextField>

        {/* Both are live regions that are there before they speak (a region inserted already filled is not announced reliably).
            The refusal is an alert; the wait before it empties it, so the same refusal twice is spoken twice. */}
        <p className={styles.wait} data-filled={notice !== null && 'busy' in notice ? 'true' : undefined} role="status">
          {notice !== null && 'busy' in notice ? t(notice.busy) : null}
        </p>
        <p
          id="join-refusal"
          className={styles.notice}
          data-kind="error"
          data-filled={refusalShown ? 'true' : undefined}
          role="alert"
        >
          {notice === null ? null
            : 'refusal' in notice ? (notice.refusal.key === 'join.tooManyMinutes'
              ? t(notice.refusal.key, { n: notice.refusal.n })
              : t(notice.refusal.key))
              : 'auth' in notice ? t(notice.auth) : null}
        </p>

        <Button type="submit" variant="primary" block isPending={sending}>{t('join.join')}</Button>
      </form>

      <div className={styles.ways}>
        {/* ⚠️ THE WAY OUT OF THE DEAD END, shown only when it is the answer: the email already has an account. It goes to the
            sign-in form with that address filled in, and an invitation goes along, offered after the sign-in. */}
        {newAccount && takenEmail !== null ? (
          <Button variant="secondary" block isDisabled={sending} onPress={() => { flowStore.signInInstead(takenEmail); }}>
            {t('join.signInInstead')}
          </Button>
        ) : null}
        <InstallGuideLink isDisabled={sending} />
        <Button variant="quiet" isDisabled={sending} onPress={() => { void back(); }}>{t('auth.back')}</Button>
      </div>
      {confirmDialog}
    </GateScreen>
  );
}
