import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { Navigate, useBlocker, useLocation } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { labourRateAllowed } from '@mise/shared/product-limits';
import { positiveNumber } from '@mise/shared/price-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import { FOODCOST_PATH } from './foodcostPath';
import { cameFromList, useLeave } from './foodcostNav';
import { SETTINGS_OPENER, useHandBack } from './handBack';
import styles from './FoodcostSettings.module.css';

// What a box holds → the rate it stands for: null for an empty box (clears the rate), NaN for
// something that is not a number. ⚠️ A COMMA TYPED IS A DECIMAL POINT: an Italian keyboard offers
// one, and the box is plain text (a number box returns '' for «12,5» in some browsers, which would
// read as «clear the rate»).
function readRate(raw: string): number | null {
  const text = raw.trim().replace(',', '.');
  if (text === '') return null;
  return /^(\d+\.?\d*|\.\d+)$/.test(text) ? Number(text) : Number.NaN;
}

// The Food cost settings: what an hour of work costs this venue.
//
// ⚠️ ONLY WHOEVER RUNS THE PLACE REACHES THIS SCREEN, and the rules say the same whatever it draws
// (P2): the rate is a wage figure, and an employee shown Food cost does not see it. An employee who
// types the address is sent to the list, and nothing of it is drawn for them.
//
// ⚠️ THE FORM WAITS FOR THE RATE. Opened by its address, the rate may not have arrived: a box
// copied now would be empty, and a Save would clear the rate over the real one
// (`settingsLoaded` in the store; the Pastries' editor-copies-too-early trap).
export function FoodcostSettings() {
  const { t } = useT();
  const { canManage } = useSession();
  const { settingsLoaded } = useFoodcost();

  if (!canManage) return <Navigate to={FOODCOST_PATH} replace state={KEEP_FOCUS} />;
  if (!settingsLoaded) {
    return (
      <section className={styles.settings} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <SettingsForm />;
}

// ⚠️ EVERYTHING HAPPENS ON A WORKING COPY (P20): nothing is saved until Save is pressed and
// confirmed, and leaving with a changed number asks first. The stored rate is read once, when the
// form opens: a colleague's change never rewrites a box somebody is typing in.
function SettingsForm() {
  const { t } = useT();
  const store = useFoodcostStore();
  const money = useMoney();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const ids = useId();
  const titleId = `${ids}-title`;
  const inputId = `${ids}-rate`;
  const noteId = `${ids}-note`;

  const [stored] = useState(() => positiveNumber(store.getSnapshot().labourCostPerHour));
  const [text, setText] = useState(stored === null ? '' : String(stored));
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  // ⚠️ DIRTY IS «THE NUMBER DIFFERS FROM THE STORED ONE», also kept in a ref: the router's blocker
  // reads it at the moment of a navigation, and a state value read there could be one render behind.
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const setDirtyBoth = (value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  };

  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const onLeaving = useCallback(() => { handBack.expect(SETTINGS_OPENER); }, [handBack]);
  const leave = useLeave(FOODCOST_PATH, onLeaving);

  // Opened from the list, the page does not move the focus (FROM_LIST): it goes to this title.
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  const discardQuestion = () => confirm({
    title: t('fc.discardChanges'),
    message: t('fc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ── Leaving with unsaved changes ──────────────────────────────────────────────────────────
  //
  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's
  // Back, a product picked in the split's list, the rail and the tab bar all navigate. Staying on
  // the same address is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  const askingLeave = useRef(false);
  useEffect(() => {
    latestBlocker.current = blocker;
    if (blocker.state !== 'blocked' || askingLeave.current) return;
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The form went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          current.proceed();
        } else {
          // Staying: the Back button had already said whose button is owed the focus.
          handBack.forget();
          current.reset();
        }
      } finally {
        askingLeave.current = false;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the
  // router's blocker fails silently on a POP to an entry it did not create (a page opened by its
  // address). Once answered the form is clean, so the blocker does not ask again.
  async function back() {
    if (asking.current || askingLeave.current) return;
    if (dirtyRef.current) {
      asking.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        asking.current = false;
      }
      setDirtyBoth(false);
    }
    leave();
  }

  async function save() {
    if (asking.current || askingLeave.current) return;
    const rate = readRate(text);
    // ⚠️ ASKED BEFORE «Save?», NOT AFTER. A 0 used to clear the stored rate in silence (it reads as
    // «no rate»), and a rate over the rules' ceiling said «saved» and was then refused. An EMPTY box
    // still clears the rate: that is a real answer.
    if (rate !== null && !labourRateAllowed(rate)) {
      setInvalid(true);
      input.current?.focus();
      say(t('fc.settings.rateOutOfRange'));
      return;
    }
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('fc.settings.saveQ'),
        message: t('fc.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }
    // Saved: nothing is unsaved any more, so leaving asks nothing.
    setDirtyBoth(false);
    store.saveLabourRate(rate);
    say(t('fc.settings.saved'));
    leave();
  }

  return (
    <section className={styles.settings} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={t('fc.settings.title')}
        titleId={titleId}
        titleRef={title}
        action={
          <Button variant="primary" onPress={() => { void save(); }}>
            <Check aria-hidden="true" />
            {t('ui.save')}
          </Button>
        }
      />

      <div className={styles.body}>
        <section className={styles.card} aria-labelledby={`${ids}-costs`}>
          <h3 id={`${ids}-costs`} className={styles.cardTitle}>{t('fc.settings.costsTitle')}</h3>
          <label htmlFor={inputId} className={styles.label}>
            {t('fc.settings.labourRate', { currency: money.symbol })}
          </label>
          <input
            ref={input}
            id={inputId}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={text}
            aria-invalid={invalid ? true : undefined}
            aria-describedby={noteId}
            className={`${styles.input} ${invalid ? styles.isError : ''}`}
            onChange={event => {
              setText(event.target.value);
              setInvalid(false);
              setDirtyBoth(readRate(event.target.value) !== stored);
            }}
          />
          <p id={noteId} className={styles.note}>{t('fc.settings.labourRateNote')}</p>
        </section>
      </div>

      {confirmDialog}
    </section>
  );
}
