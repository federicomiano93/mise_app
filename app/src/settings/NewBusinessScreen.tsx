import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { joinLinkFor } from '@mise/shared/join-link';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { LeaveDialog } from '../session/LeaveDialog';
import { LeaveFailed } from '../session/LeaveFailed';
import { useSession, useSessionStore } from '../session/SessionContext';
import { useLeaveFlow } from '../session/useLeaveFlow';
import { Button } from '../ui/Button';
import { copyToClipboard } from '../ui/clipboard';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { businessRefusal } from './businessRefusal';
import { useBackToSettings } from './settingsHandBack';
import { BUSINESS_SECTION_IDS } from './settingsSource';
import type { BusinessCountry, BusinessSectionId, CreatedBusiness } from './settingsSource';
import { SettingsSubScreen } from './SettingsSubScreen';
import { useSettingsSource } from './useSettingsSource';
import styles from './NewBusinessScreen.module.css';

// «New business» (the app's administrator only — SettingsSection replaces the screen with the page for anybody else, and the Cloud
// Function `createWorkspace` refuses them too). A port of js/staff/new-customer.js, whose comments record what it cost.
//
// ⚠️ NOTHING IS CHOSEN AT THE START — not who gets in, not the country, not one section (P20). The current app learnt it twice: a
// pre-chosen «for a customer» created the owner's own bakery as a customer's, and he could not get into it (13 Aug 2026); a pre-ticked
// section sells part of the app by accident; and a pre-chosen country would print the first Italian customer's allergen labels in
// English, finished-looking and non-compliant. Every one of the four is checked before anything is asked of the server.
//
// ⚠️ A CUSTOMER'S LINK IS SHOWN ONCE: only its hash is stored, so a business made and then walked away from without the link has
// nobody who can open it. Until the link has been copied or shared, leaving — by Back, the rail, the gesture (the router's blocker) —
// asks first, and so does closing the window (a hold that is not quiet, session/busy.ts). A business of your own has no link and
// nothing to lose, so it never asks.

type Who = 'self' | 'link';
type Field = 'name' | 'who' | 'country' | 'sections';

type Made = { readonly name: string; readonly created: CreatedBusiness; readonly madeAt: number };

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NAME = 80;

const SECTION_LABEL: Readonly<Record<BusinessSectionId, MessageKey>> = {
  orders: 'section.orders',
  calculator: 'section.calculator',
  catalogue: 'section.recipes',
  pastries: 'section.pastries',
  foodcost: 'section.foodcost',
};

const NO_SECTIONS: Readonly<Record<BusinessSectionId, boolean>> = {
  orders: false, calculator: false, catalogue: false, pastries: false, foodcost: false,
};

const FIELD_ERROR: Readonly<Record<Field, MessageKey>> = {
  name: 'newBusiness.err.name',
  who: 'newBusiness.err.who',
  country: 'newBusiness.err.country',
  sections: 'newBusiness.err.sections',
};

export function NewBusinessScreen() {
  const { t } = useT();
  const source = useSettingsSource();
  const store = useSessionStore();
  const { user } = useSession();
  const back = useBackToSettings('new-business');
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const ids = useId();

  const [name, setName] = useState('');
  const [who, setWho] = useState<Who | null>(null);
  const [country, setCountry] = useState<BusinessCountry | null>(null);
  const [sections, setSections] = useState<Readonly<Record<BusinessSectionId, boolean>>>(NO_SECTIONS);
  const [invalid, setInvalid] = useState<ReadonlySet<Field>>(new Set());
  const [making, setMaking] = useState(false);
  const [failure, setFailure] = useState<MessageKey | null>(null);
  const [made, setMade] = useState<Made | null>(null);
  // The link has been copied or shared: from then on leaving is silent.
  const [handedOver, setHandedOver] = useState(false);

  // ⚠️ ONE CALL PER TAP, read at once (the state is only read on the next render): a double tap must not create two businesses.
  const inFlight = useRef(false);
  const alive = useRef(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const whoGroup = useRef<HTMLDivElement>(null);
  const countryGroup = useRef<HTMLDivElement>(null);
  const sectionGroup = useRef<HTMLDivElement>(null);
  const banner = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const anySection = BUSINESS_SECTION_IDS.some(id => sections[id]);
  const typed = name !== '' || who !== null || country !== null || anySection;
  const linkPending = made !== null && made.created.kind === 'link' && !handedOver;

  // What leaving would lose, if anything: typing nobody saved, or a link nobody has copied. A call in the air for a customer's
  // business counts as the link (its answer carries the one chance to see it); one for the owner's own loses nothing.
  type Guard = 'discard' | 'link' | null;
  let guard: Guard = null;
  if (made !== null) guard = linkPending ? 'link' : null;
  else if (making) guard = who === 'link' ? 'link' : null;
  else if (typed) guard = 'discard';
  const guardRef = useRef<Guard>(guard);
  guardRef.current = guard;

  // ⚠️ A HOLD MUST END (session/busy.ts): it lets go when the typing is gone, when the link has been handed over, and on leaving.
  // Not quiet: closing or reloading the window with any of these would lose something, so the browser asks as well.
  const held = guard !== null || making;
  useEffect(() => (held ? markBusy() : undefined), [held]);

  const shouldBlock: BlockerFunction = ({ currentLocation, nextLocation }) =>
    guardRef.current !== null && currentLocation.pathname !== nextLocation.pathname;
  const blocker = useBlocker(shouldBlock);
  const asking = useRef(false);
  useEffect(() => {
    if (blocker.state !== 'blocked' || asking.current) return;
    asking.current = true;
    const question = guardRef.current === 'link'
      ? { message: t('newBusiness.leave.link'), okLabel: t('newBusiness.leave.ok'), cancelLabel: t('unsent.stay'), danger: true }
      : { title: t('newBusiness.discard.title'), message: t('newBusiness.discard.body'), okLabel: t('ui.discard'), cancelLabel: t('common.cancel'), danger: true };
    void confirm(question).then(leave => {
      asking.current = false;
      if (blocker.state !== 'blocked') return;
      if (leave) blocker.proceed(); else blocker.reset();
    });
  }, [blocker, confirm, t]);

  // Opening the new venue wipes this phone's copy of the open one and reloads, so it asks what leaving asks (useLeaveFlow): «Not
  // sent yet» when something typed elsewhere has not reached the server. ⚠️ THE SESSION'S OWN SWITCH (`switchLocation`) CANNOT BE
  // USED: it checks the venue against the membership read at the start of the session, which does not hold the new one. The join's
  // way in (`openJoinedVenue`) does the same wipe, writes the venue as the one to open and reloads WITHOUT the browser's question.
  const open = useLeaveFlow((locationId: string) => {
    if (!user) throw new Error('Nobody is signed in.');
    return store.openJoinedVenue(locationId, user.uid);
  });

  function clear(field: Field): void {
    setInvalid(current => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });
    setFailure(null);
  }

  async function create(): Promise<void> {
    if (inFlight.current) return;
    const missing: Field[] = [];
    if (name.trim() === '') missing.push('name');
    if (who === null) missing.push('who');
    if (country === null) missing.push('country');
    if (!anySection) missing.push('sections');
    if (missing.length > 0 || who === null || country === null) {
      setInvalid(new Set(missing));
      setFailure(null);
      // FOCUS THE FIRST ONE MISSING, in the order they are on screen. The groups take the focus, not their first radio: a radio
      // chooses on an arrow key, and a stray key would then choose for the person.
      const first = missing[0];
      if (first === 'name') nameInput.current?.focus();
      else if (first === 'who') whoGroup.current?.focus();
      else if (first === 'country') countryGroup.current?.focus();
      else sectionGroup.current?.focus();
      return;
    }
    inFlight.current = true;
    const trimmed = name.trim();
    const forSelf = who === 'self';
    try {
      const ok = await confirm({
        title: t('newBusiness.confirm.title', { name: trimmed }),
        message: forSelf ? t('newBusiness.confirm.self') : t('newBusiness.confirm.link'),
        okLabel: t('newBusiness.confirm.ok'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !alive.current) return;
      setFailure(null);
      setMaking(true);
      try {
        const created = await source.createBusiness({ name: trimmed, country, sections, forSelf });
        if (!alive.current) return;
        setMade({ name: trimmed, created, madeAt: Date.now() });
      } catch (err) {
        // The error's code only: the request held a name, and a failed call has no link to leak, but a report needs no more.
        console.error('Creating a business failed:', (err as { code?: unknown } | null)?.code ?? 'no code');
        if (alive.current) setFailure(businessRefusal(err));
      } finally {
        if (alive.current) setMaking(false);
      }
    } finally {
      inFlight.current = false;
    }
  }

  // The banner takes the focus when the result appears: the screen was replaced under the person's finger.
  useEffect(() => {
    if (made !== null) banner.current?.focus();
  }, [made]);

  async function copy(link: string): Promise<void> {
    const copied = await copyToClipboard(link);
    if (!alive.current) return;
    if (copied) setHandedOver(true);
    // ⚠️ THE LINK STAYS ON SCREEN AS TEXT WHATEVER THE CLIPBOARD DID, and when it refused the notice says to copy it by hand.
    await alert(copied
      ? { message: t('newBusiness.link.copied'), okLabel: t('common.ok') }
      : { message: [t('newBusiness.link.manual'), link], okLabel: t('common.ok') });
  }

  async function share(businessName: string, link: string): Promise<void> {
    try {
      await navigator.share({ title: businessName, text: t('newBusiness.link.message', { name: businessName, link }) });
      if (alive.current) setHandedOver(true);
    } catch {
      // The sheet was closed without sending (AbortError), or the device refused: nothing was handed over, so leaving still asks.
    }
  }

  if (made !== null) {
    const { created } = made;
    const title = t('newBusiness.title');
    if (created.kind === 'mine') {
      return (
        <SettingsSubScreen door="new-business" title={title}>
          <div className={styles.result}>
            <p ref={banner} tabIndex={-1} className={styles.banner}>{t('newBusiness.made.self', { name: made.name })}</p>
            <p className={styles.note}>{t('newBusiness.self.text')}</p>
            <div className={styles.actions}>
              <Button variant="primary" isPending={open.checking} onPress={() => { void open.proceed(created.locationId); }}>
                {t('newBusiness.self.open', { name: made.name })}
              </Button>
              <Button onPress={back}>{t('newBusiness.done')}</Button>
            </div>
            <LeaveFailed failed={open.failed} />
            <LeaveDialog flow={open} role="dialog" title={t('newBusiness.self.open', { name: made.name })} actions={null}>{null}</LeaveDialog>
            {confirmDialog}
          </div>
        </SettingsSubScreen>
      );
    }

    const link = joinLinkFor(created.token);
    const days = Math.max(1, Math.round((created.expiresAt - made.madeAt) / DAY_MS));
    const canShare = typeof navigator !== 'undefined' && 'share' in navigator;
    return (
      <SettingsSubScreen door="new-business" title={title}>
        <div className={styles.result}>
          <p ref={banner} tabIndex={-1} className={styles.banner}>{t('newBusiness.made.link', { name: made.name })}</p>
          <h3 className={styles.heading}>{t('newBusiness.link.title')}</h3>
          <p className={styles.note}>{t('newBusiness.link.intro')}</p>
          {/* ⚠️ THE LINK IS ALWAYS ON SCREEN AS TEXT, whatever the clipboard did: a screen that only said «Copied» would leave nothing
              behind on the phones where the clipboard refuses. */}
          <p className={styles.link}>{link}</p>
          <div className={styles.actions}>
            <Button variant="primary" onPress={() => { void copy(link); }}>{t('newBusiness.link.copy')}</Button>
            {canShare ? <Button onPress={() => { void share(made.name, link); }}>{t('newBusiness.link.share')}</Button> : null}
            <Button onPress={back}>{t('newBusiness.done')}</Button>
          </div>
          <p className={styles.warning}>
            <strong>{t('newBusiness.link.warning.lead')}</strong>{' '}
            {t('newBusiness.link.warning', { n: days })}
          </p>
          {alertDialog}
          {confirmDialog}
        </div>
      </SettingsSubScreen>
    );
  }

  const nameId = `${ids}-name`;
  const field = (f: Field): { 'aria-invalid': true | undefined; 'aria-describedby': string | undefined } => ({
    'aria-invalid': invalid.has(f) ? true : undefined,
    'aria-describedby': invalid.has(f) ? `${ids}-${f}-error` : undefined,
  });
  const fieldError = (f: Field): ReactNode => (invalid.has(f)
    ? <p id={`${ids}-${f}-error`} className={styles.error}>{t(FIELD_ERROR[f])}</p>
    : null);

  return (
    <SettingsSubScreen door="new-business" title={t('newBusiness.title')} backDisabled={making}>
      <section className={styles.card} aria-labelledby={`${ids}-card`}>
        <h3 id={`${ids}-card`} className={styles.heading}>{t('newBusiness.form.title')}</h3>
        <p className={styles.note}>{t('newBusiness.form.note')}</p>

        <div className={styles.field}>
          <label className={styles.label} htmlFor={nameId}>{t('newBusiness.name')}</label>
          <input
            id={nameId}
            ref={nameInput}
            className={styles.input}
            value={name}
            maxLength={MAX_NAME}
            autoCapitalize="words"
            autoComplete="off"
            placeholder={t('newBusiness.name.placeholder')}
            disabled={making}
            {...field('name')}
            onChange={event => { setName(event.currentTarget.value); clear('name'); }}
          />
          {fieldError('name')}
        </div>

        <div className={styles.field}>
          <p id={`${ids}-who`} className={styles.label}>{t('newBusiness.who')}</p>
          <div
            ref={whoGroup}
            role="radiogroup"
            // Focusable by the code only (a missing answer), never a Tab stop of its own.
            tabIndex={-1}
            aria-labelledby={`${ids}-who`}
            aria-required="true"
            className={styles.choices}
            {...field('who')}
            data-invalid={invalid.has('who') || undefined}
          >
            {(['self', 'link'] as const).map(value => (
              <label key={value} className={styles.choice} data-checked={who === value} data-invalid={invalid.has('who') || undefined}>
                <input
                  type="radio"
                  name={`${ids}-who`}
                  value={value}
                  checked={who === value}
                  disabled={making}
                  aria-labelledby={`${ids}-who-${value}`}
                  aria-describedby={`${ids}-who-${value}-sub`}
                  className={styles.control}
                  onChange={() => { setWho(value); clear('who'); }}
                />
                <span className={styles.choiceText}>
                  <span id={`${ids}-who-${value}`} className={styles.choiceName}>{t(value === 'self' ? 'newBusiness.who.self' : 'newBusiness.who.link')}</span>
                  <span id={`${ids}-who-${value}-sub`} className={styles.choiceSub}>{t(value === 'self' ? 'newBusiness.who.self.sub' : 'newBusiness.who.link.sub')}</span>
                </span>
              </label>
            ))}
          </div>
          {fieldError('who')}
        </div>

        <div className={styles.field}>
          <p id={`${ids}-country`} className={styles.label}>{t('newBusiness.country')}</p>
          <div
            ref={countryGroup}
            role="radiogroup"
            tabIndex={-1}
            aria-labelledby={`${ids}-country`}
            aria-required="true"
            className={styles.choices}
            {...field('country')}
            aria-describedby={[`${ids}-country-help`, invalid.has('country') ? `${ids}-country-error` : ''].filter(Boolean).join(' ')}
          >
            {(['IT', 'GB'] as const).map(value => (
              <label key={value} className={styles.choice} data-checked={country === value} data-invalid={invalid.has('country') || undefined}>
                <input
                  type="radio"
                  name={`${ids}-country`}
                  value={value}
                  checked={country === value}
                  disabled={making}
                  aria-labelledby={`${ids}-country-${value}`}
                  aria-describedby={`${ids}-country-${value}-sub`}
                  className={styles.control}
                  onChange={() => { setCountry(value); clear('country'); }}
                />
                <span className={styles.choiceText}>
                  <span id={`${ids}-country-${value}`} className={styles.choiceName}>{t(value === 'IT' ? 'newBusiness.country.IT' : 'newBusiness.country.GB')}</span>
                  <span id={`${ids}-country-${value}-sub`} className={styles.choiceSub}>{t(value === 'IT' ? 'newBusiness.country.IT.sub' : 'newBusiness.country.GB.sub')}</span>
                </span>
              </label>
            ))}
          </div>
          <p id={`${ids}-country-help`} className={styles.note}>{t('newBusiness.country.help')}</p>
          {fieldError('country')}
        </div>

        <div className={styles.field}>
          <p id={`${ids}-sections`} className={styles.label}>{t('newBusiness.sections')}</p>
          <div
            ref={sectionGroup}
            role="group"
            tabIndex={-1}
            aria-labelledby={`${ids}-sections`}
            className={styles.checks}
            {...field('sections')}
          >
            {BUSINESS_SECTION_IDS.map(id => (
              <label key={id} className={styles.check} data-checked={sections[id]} data-invalid={invalid.has('sections') || undefined}>
                <input
                  type="checkbox"
                  checked={sections[id]}
                  disabled={making}
                  className={styles.control}
                  onChange={event => {
                    const on = event.currentTarget.checked;
                    setSections(current => ({ ...current, [id]: on }));
                    clear('sections');
                  }}
                />
                <span className={styles.checkName}>{t(SECTION_LABEL[id])}</span>
              </label>
            ))}
          </div>
          {fieldError('sections')}
        </div>

        {/* There from the start, so what it says is announced. */}
        <p aria-live="polite" className={failure === null ? styles.status : styles.error}>
          {making ? t('newBusiness.creating') : failure === null ? '' : t(failure)}
        </p>

        <div className={styles.actions}>
          <Button isDisabled={making} onPress={back}>{t('newBusiness.cancel')}</Button>
          <Button variant="primary" isPending={making} onPress={() => { void create(); }}>{t('newBusiness.create')}</Button>
        </div>
      </section>
      {confirmDialog}
    </SettingsSubScreen>
  );
}
