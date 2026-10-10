import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FieldError, Input, Label, TextField } from 'react-aria-components';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { resetFailureKey, signInErrorKey } from './authErrors';
import { GateScreen } from './GateScreen';
import { useSessionStore } from './SessionContext';
import styles from './SignInScreen.module.css';

// What the block above the button says. Kept as a key (or an address), not as finished text, so
// it is worded in the language on screen when it is drawn. `id` makes two identical failures in
// a row two announcements to a screen reader, not one.
type Notice =
  | { id: number; kind: 'error'; key: MessageKey }
  | { id: number; kind: 'success'; address: string };

type FieldProblem = 'auth.enterEmail' | 'auth.typeEmailFirst' | 'auth.enterPassword';

// The sign-in form. A port of signInScreen in js/auth-gate.js, minus the two entrances that come
// with the invitations (join code, install guide: step 3g).
export function SignInScreen() {
  const { t } = useT();
  const store = useSessionStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailProblem, setEmailProblem] = useState<FieldProblem | null>(null);
  const [passwordProblem, setPasswordProblem] = useState<FieldProblem | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [resetting, setResetting] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const noticeCount = useRef(0);

  const say = (message: { kind: 'error'; key: MessageKey } | { kind: 'success'; address: string }) => {
    noticeCount.current += 1;
    setNotice({ id: noticeCount.current, ...message });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (signingIn) return;
    setNotice(null);
    // ⚠️ Each empty field is named on the field itself and the focus goes there, so a keyboard
    // or screen-reader user lands on what needs fixing, not on a message somewhere else.
    if (!email.trim()) {
      setEmailProblem('auth.enterEmail');
      emailRef.current?.focus();
      return;
    }
    if (!password) {
      setPasswordProblem('auth.enterPassword');
      passwordRef.current?.focus();
      return;
    }
    setSigningIn(true);
    try {
      await store.signIn(email, password);
      // The session takes it from here: this screen is replaced. It stays «Signing in…» until it
      // is, so a slow answer cannot be sent twice.
    } catch (error) {
      say({ kind: 'error', key: signInErrorKey(error) });
      setSigningIn(false);
      // Selected, so the next try is a retype. (A wrong email is the rarer mistake.)
      passwordRef.current?.select();
    }
  }

  async function forgot() {
    if (resetting) return;
    const address = email.trim();
    setNotice(null);
    if (!address) {
      setEmailProblem('auth.typeEmailFirst');
      emailRef.current?.focus();
      return;
    }
    setResetting(true);
    try {
      await store.sendReset(address);
      say({ kind: 'success', address });
    } catch (error) {
      // An address with no account gets the SAME sentence as one with an account.
      const key = resetFailureKey(error);
      say(key === null ? { kind: 'success', address } : { kind: 'error', key });
    } finally {
      setResetting(false);
    }
  }

  return (
    <GateScreen subtitle={t('auth.signIn.sub')}>
      <form className={styles.form} noValidate onSubmit={event => { void submit(event); }}>
        <TextField
          className={styles.field}
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoFocus
          validationBehavior="aria"
          value={email}
          onChange={value => { setEmail(value); setEmailProblem(null); }}
          isInvalid={emailProblem !== null}
        >
          <Label className={styles.label}>{t('auth.email')}</Label>
          <Input ref={emailRef} className={styles.input} autoCapitalize="none" spellCheck={false} />
          <FieldError className={styles.error}>
            {emailProblem === null ? null : <span role="alert">{t(emailProblem)}</span>}
          </FieldError>
        </TextField>

        <TextField
          className={styles.field}
          type="password"
          name="password"
          autoComplete="current-password"
          validationBehavior="aria"
          value={password}
          onChange={value => { setPassword(value); setPasswordProblem(null); }}
          isInvalid={passwordProblem !== null}
        >
          <Label className={styles.label}>{t('auth.password')}</Label>
          <Input ref={passwordRef} className={styles.input} />
          <FieldError className={styles.error}>
            {passwordProblem === null ? null : <span role="alert">{t(passwordProblem)}</span>}
          </FieldError>
        </TextField>

        {notice === null ? null : (
          <p
            key={notice.id}
            className={styles.notice}
            data-kind={notice.kind}
            role={notice.kind === 'error' ? 'alert' : 'status'}
          >
            {notice.kind === 'error' ? t(notice.key) : t('auth.resetSent', { address: notice.address })}
          </p>
        )}

        <Button type="submit" variant="primary" block isPending={signingIn}>
          {signingIn ? t('auth.signingIn') : t('auth.signIn')}
        </Button>
        <Button variant="quiet" isPending={resetting} onPress={() => { void forgot(); }}>
          {t('auth.forgot')}
        </Button>
      </form>
    </GateScreen>
  );
}
