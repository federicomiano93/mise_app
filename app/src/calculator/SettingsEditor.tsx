import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useBlocker, useLocation, useNavigationType } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { cloneConfig } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useConfirm } from '../ui/useConfirm';
import { useCalculatorStore } from './CalculatorContext';
import { cameFromParent, useLeave } from './calculatorNav';
import { SettingsScreen } from './SettingsScreen';
import { useSaveConfig } from './useSaveConfig';

type Props = {
  title: string;
  // Where Back goes when nothing is behind this screen (it was opened by its address).
  fallback: string;
  // Whether the working copy differs from what it was opened with. Save is disabled until it does.
  dirty: boolean;
  // The configuration to save, built from the LATEST one the store holds (never from the copy this screen
  // opened with): another phone's change to a part this screen does not edit must not be undone by saving.
  build: (latest: CalculatorConfig) => CalculatorConfig;
  // «Save these changes?»
  saveQuestion: string;
  // A screen with nothing to edit (a recipe without products) has no Save.
  showSave?: boolean;
  children: ReactNode;
};

// The form every editing screen of Settings is (Extra dough, a recipe's Divisor, Dough history): a working copy
// in the caller, a FormBar with Back and the one primary action, Save asking its question and then going
// through the one save path (useSaveConfig); leaving with unsaved edits asks (P20).
//
// ⚠️ A SAVE IN FLIGHT IS PENDING, NOT GONE: Save ignores a second tap (port of createSaveGuard) and Back waits.
// A refused save leaves the screen exactly as it was — dirty, with its edits — and Save is given back.
export function SettingsEditor({ title, fallback, dirty, build, saveQuestion, showSave = true, children }: Props) {
  const { t } = useT();
  const store = useCalculatorStore();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const [confirm, confirmDialog] = useConfirm();
  const [saveConfig, saveDialog] = useSaveConfig();
  const titleId = `${useId()}-title`;
  const heading = useRef<HTMLHeadingElement>(null);
  const leave = useLeave(fallback);

  // ⚠️ DIRTY IS ALSO KEPT IN A REF: the router's blocker reads it at the moment of a navigation, and a state value
  // read there could be one render behind.
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // Set once the edits are saved or thrown away on purpose: leaving then asks nothing.
  const leavingClean = useRef(false);
  // True only while the configuration is travelling to the server (see shouldBlock).
  const sending = useRef(false);

  const [saving, setSaving] = useState(false);
  const busy = useRef(false);
  const askingLeave = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts). The save in the air is the
  // store's own marker (CalculatorContext).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  // Opened from the level above, the page does not move the focus (FROM_PARENT): it goes to this title.
  useEffect(() => {
    // Not on a POP: that is Back arriving at an entry that remembers how it was opened, and the focus then goes
    // to the button that opened the screen the person has just left (handBack.ts).
    if (navigationType !== 'POP' && cameFromParent(state)) heading.current?.focus();
  }, []);

  const discardQuestion = useCallback(() => confirm({
    title: t('calc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // ── Leaving with unsaved changes ──────────────────────────────────────────────────────────
  //
  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER, not through the Back button: the browser's Back, the rail
  // and the tab bar all navigate. Staying on the same address is never blocked.
  //
  // ⚠️ WHILE THE SAVE IS IN THE AIR A WAY OUT IS REFUSED WITHOUT A QUESTION: the edits are not being lost (they are
  // on their way), so «unsaved changes will be lost?» would be a false alarm; and leaving now would hide the
  // outcome (a refusal is said on THIS screen). The person stays; the save settles; they leave again if they still want.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      !leavingClean.current && (dirtyRef.current || sending.current) && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    // ⚠️ THE QUESTION STAYS «BEING ASKED» UNTIL THE ROUTER HAS LEFT ITS 'blocked' STATE, not until the answer (see the
    // Clients editor): the router publishes its state at a lower priority, so a render in between would still see the
    // old block and ask the same question again.
    if (blocker.state !== 'blocked') {
      askingLeave.current = false;
      return;
    }
    if (askingLeave.current) return;
    if (sending.current) {
      blocker.reset();
      return;
    }
    askingLeave.current = true;
    void (async () => {
      try {
        const discard = await discardQuestion();
        // The screen went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker
  // fails silently on a POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (busy.current || askingLeave.current) return;
    if (dirtyRef.current) {
      busy.current = true;
      try {
        const discard = await discardQuestion();
        if (!discard || !mounted.current) return;
      } finally {
        busy.current = false;
      }
    }
    leavingClean.current = true;
    leave();
  }

  async function save() {
    if (busy.current || askingLeave.current) return;
    busy.current = true;
    setSaving(true);
    try {
      const ok = await confirm({
        title: saveQuestion,
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      const latest = cloneConfig(store.getSnapshot().config);
      sending.current = true;
      let stored: boolean;
      try {
        stored = await saveConfig(build(latest));
      } finally {
        sending.current = false;
      }
      if (!stored || !mounted.current) return;
      // Saved (or kept on this phone, and said so): nothing is unsaved any more, so leaving asks nothing.
      leavingClean.current = true;
      leave();
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  return (
    <SettingsScreen
      labelledBy={titleId}
      bar={
        <FormBar
          backLabel={t('ui.back')}
          onBack={() => { void back(); }}
          title={title}
          titleId={titleId}
          titleRef={heading}
          action={showSave ? (
            <Button
              variant="primary"
              isDisabled={!dirty}
              isPending={saving}
              onPress={() => { void save(); }}
            >
              <Check aria-hidden="true" />
              {t('ui.save')}
            </Button>
          ) : undefined}
        />
      }
    >
      {children}
      {confirmDialog}
      {saveDialog}
    </SettingsScreen>
  );
}
