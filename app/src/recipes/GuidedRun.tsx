import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { BellRing, Check, Play } from 'lucide-react';
import { useBlocker, useLocation, useNavigationType } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { formatDuration, formatRemaining, normalizeEndNote, normalizeSteps, overdueText, progressText } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { announceAction } from '../telemetry/usage';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useConfirm } from '../ui/useConfirm';
import { acquireWakeLock, canKeepScreenAwake, releaseWakeLock } from '../ui/wakeLock';
import { startAlarm, stopAlarm, unlockAlarm } from './guidedAlarm';
import {
  TICK_MS, addMinute, advance, alarmDue, controlsFor, missedLines, runFrom, rung, sessionOf, snapshotAmounts, startTimer, stepLines, timerOf,
} from './guidedRunModel';
import type { RunLine, RunState } from './guidedRunModel';
import { clearSession, writeSession } from './guidedSession';
import type { GuidedSession } from './guidedSession';
import { cameFromRecipe, useLeave } from './recipesNav';
import { recipePath } from './recipesPath';
import styles from './GuidedRun.module.css';

const WAKE_OWNER = 'guided-mix';

// Nothing to do when the screen is left: the recipe steps back to the list's focus by itself.
const NOTHING = (): void => undefined;

type Props = {
  id: string;
  // The saved session this run goes on from (a mix just started has one too: the recipe's button writes it first).
  session: GuidedSession;
};

// The guided mix (a port of js/catalogue/guided-run.js): the screen someone stands in front of with their hands in dough, so it
// is built for exactly that — one instruction at a time, the amounts big enough to read from a step back, and a countdown
// that is right whatever the phone did while nobody was looking.
//
// ⚠️ NOTHING IN THIS FILE COUNTS SECONDS. A timer is the wall-clock instant it ENDS (`endsAt`); the 250 ms interval only
// repaints, and coming back to the page repaints at once (`visibilitychange`), so a throttled or suspended tab never shows a
// time that did not happen. The rules of the clock are in guidedRunModel.ts.
//
// ⚠️ THE RUN WORKS AGAINST A FROZEN SNAPSHOT (`session.snapshot`), never the live recipe: a recipe edited on another phone
// arrives mid-screen, and changing amounts under somebody's hands halfway through a dough is the one thing this screen must
// not do. The snapshot is taken when the mix is started and travels in the saved session.
//
// ⚠️ THE SESSION IS SAVED AFTER EVERY CHANGE (the step and the timer's end), so a reload, a crash or a call from the other
// app picks the mix up where it was. Finishing clears it; leaving keeps it.
export function GuidedRun({ id, session }: Props) {
  const { t, locale } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const [confirm, confirmDialog] = useConfirm();
  const ids = useId();
  const titleId = `${ids}-title`;
  const { snapshot } = session;
  const steps = useMemo(() => normalizeSteps(snapshot.steps), [snapshot]);
  const amounts = useMemo(() => snapshotAmounts(snapshot), [snapshot]);

  const [run, setRun] = useState<RunState>(() => runFrom(session));
  // The state, readable at once by the interval and the page-visible handler, which outlive the render that made them.
  const runNow = useRef(run);
  const [now, setNow] = useState(() => Date.now());

  const update = (next: RunState, at: number) => {
    runNow.current = next;
    setRun(next);
    setNow(at);
  };
  // A change of the run that is kept: saved for a reload to find, or cleared when the mix is over.
  const commit = (next: RunState, at: number) => {
    update(next, at);
    if (next.finished) clearSession();
    else writeSession(sessionOf(next, id, snapshot, session.startedAt));
  };

  // ── The clock and the alarm ──────────────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Which timer the alarm has sounded for is in the state, so it rings once per step and not once per repaint.
    const tick = () => {
      const at = Date.now();
      const current = runNow.current;
      if (current.finished) return;
      if (alarmDue(current, at)) {
        startAlarm();
        update(rung(current), at);
        return;
      }
      // Only the clock face changes while a timer runs (or counts how late it is), so the card is not redrawn when nothing moved.
      if (timerOf(current, at) !== 'idle') setNow(at);
    };
    // ⚠️ A HIDDEN TAB'S INTERVAL IS THROTTLED OR STOPPED, so coming back repaints at once instead of waiting for the next tick.
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      tick();
      setNow(Date.now());
    };
    // Straight away too: a session picked up on a timer that ran out while the app was closed rings now.
    tick();
    const timer = window.setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      // Leaving stops the sound and the buzz.
      stopAlarm();
    };
  }, []);

  // The screen stays lit while the mix is open and not finished; a reload the app starts by itself waits for it.
  const finished = run.finished;
  useEffect(() => {
    if (finished) return undefined;
    acquireWakeLock(WAKE_OWNER);
    const release = markBusy();
    return () => {
      releaseWakeLock(WAKE_OWNER);
      release();
    };
  }, [finished]);

  // ── Leaving ──────────────────────────────────────────────────────────────────────────────────────────────────
  // One level up: the recipe. The browser's Back when the recipe is the entry behind this one, otherwise this entry is
  // replaced by the recipe (a page opened by its address, or the mix reopened after a reload).
  const leave = useLeave(recipePath(id), NOTHING, cameFromRecipe);
  const leavingClean = useRef(false);
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ⚠️ LEAVING MID-DOUGH ASKS, AND KEEPS THE SESSION EITHER WAY: the answer is about navigating, never about throwing the
  // dough away.
  const leaveQuestion = () => confirm({
    title: t('cat.leaveTheGuidedMix'),
    message: t('cat.youAreOn', { progress: progressText(runNow.current.index, steps.length, { inline: true }, t) }),
    okLabel: t('ui.leave'),
    cancelLabel: t('common.cancel'),
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER: the browser's Back, the rail and the tab bar all navigate. Not after
  // the mix is finished. Staying on the same address is never blocked.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && !runNow.current.finished && currentLocation.pathname !== nextLocation.pathname,
    [],
  );
  const blocker = useBlocker(shouldBlock);
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
        const ok = await leaveQuestion();
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (ok) current.proceed();
        else current.reset();
      } catch (error) {
        asking.current = false;
        throw error;
      }
    })();
  });

  // ⚠️ THE BACK BUTTON ASKS FOR ITSELF, BEFORE IT NAVIGATES: its navigate(-1) is a POP, and the router's blocker fails silently
  // on a POP to an entry it did not create (a page opened by its address).
  async function back() {
    if (asking.current) return;
    if (!runNow.current.finished) {
      asking.current = true;
      try {
        const ok = await leaveQuestion();
        if (!ok || !mounted.current) return;
      } finally {
        asking.current = false;
      }
    }
    leavingClean.current = true;
    leave();
  }

  // ── The controls ─────────────────────────────────────────────────────────────────────────────────────────────
  const step = steps[run.index];

  function begin() {
    if (step === undefined) return;
    announceAction('timer-started');
    // The tap that starts a timer is a real gesture, which is the only moment a browser will let the alarm be authorised.
    unlockAlarm();
    const at = Date.now();
    commit(startTimer(runNow.current, step, at), at);
  }

  function next() {
    stopAlarm();
    const at = Date.now();
    commit(advance(runNow.current, steps), at);
  }

  function extend() {
    const at = Date.now();
    commit(addMinute(runNow.current), at);
  }

  // The focus: the step's instruction every time a new step opens (a screen reader reads it), the end card when the mix
  // finishes. Not when the screen first opens: that is the title's.
  const title = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const doneHeading = useRef<HTMLParagraphElement>(null);
  const focused = useRef({ index: run.index, finished: run.finished });
  useEffect(() => {
    if (cameFromRecipe(state) && navigationType !== 'POP') title.current?.focus();
  }, []);
  useEffect(() => {
    const before = focused.current;
    focused.current = { index: run.index, finished: run.finished };
    if (run.finished && !before.finished) doneHeading.current?.focus();
    else if (!run.finished && run.index !== before.index) heading.current?.focus();
  }, [run.index, run.finished]);

  const name = snapshot.name === '' ? t('cat.noName') : snapshot.name;
  const timer = timerOf(run, now);

  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        title={name}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.eyebrow}>{t('cat.guidedMixing')}</p>}
      />
      <div className={styles.body}>
        {run.finished ? (
          <Finished
            snapshotNote={normalizeEndNote(snapshot.endNote)}
            missed={missedLines(snapshot, amounts, t, locale)}
            doneRef={doneHeading}
            onBack={() => { void back(); }}
          />
        ) : step === undefined ? null : (
          <>
            {/* ⚠️ THE COUNTER SITS OUTSIDE THE CARD, above it: inside, it would take the card's first line, the most valuable
                line on a screen read in a hurry, to say something nobody acts on. */}
            <p className={styles.progress}>{progressText(run.index, steps.length, {}, t)}</p>
            <div className={`${styles.card} ${timer === 'finished' ? styles.due : ''}`}>
              <h3 ref={heading} tabIndex={-1} className={styles.text}>{step.text === '' ? t('cat.stepN', { n: run.index + 1 }) : step.text}</h3>
              <Lines lines={stepLines(step, snapshot, amounts, t, locale)} />
              {/* The speed is an instruction (set the mixer to this), so it comes BEFORE the clock. Drawn anew with each step
                  (keyed), so the flash plays once for the step that changed gear and never again on a repaint. */}
              {step.speed === '' ? null : (
                <p key={run.index} className={`${styles.speed} ${run.speedChanged ? styles.speedChanged : ''}`}>
                  {t('cat.guided.speedN', { n: step.speed })}
                </p>
              )}
              {step.seconds > 0 ? (
                <div className={styles.clock}>
                  <span className={styles.time}>
                    {timer === 'idle' ? formatDuration(step.seconds) : formatRemaining(run.endsAt, now)}
                  </span>
                  {timer === 'finished' ? (
                    <p className={styles.dueText}>
                      <BellRing aria-hidden="true" />
                      <span>{overdueText(run.endsAt, now, t) || t('cat.timeIsUp')}</span>
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
            <Controls kind={controlsFor(step, run, steps, now)} onStart={begin} onSkip={next} onExtend={extend} onDone={next} />
            {/* What this phone can actually do about the screen going dark, said in one line. No notification yet in Mise 2. */}
            <p className={styles.note}>{canKeepScreenAwake() ? t('cat.keepThisScreenOpen') : t('cat.keepThisScreenOpen2')}</p>
          </>
        )}
        {/* ⚠️ THESE TWO LIVE REGIONS ARE ALWAYS ON THE PAGE, and only their text comes and goes: text added to a region that was
            already there is announced, one inserted already filled in often is not. The speed change is said once, as the step
            opens; «Time is up» once, as the timer runs out. The countdown itself is never a live region (it would read out
            every second). */}
        <p role="status" className="visually-hidden">{!run.finished && run.speedChanged && step !== undefined ? t('cat.guided.speedN', { n: step.speed }) : ''}</p>
        <p role="status" className="visually-hidden">{!run.finished && timer === 'finished' ? t('cat.timeIsUp') : ''}</p>
      </div>
      {confirmDialog}
    </section>
  );
}

function Lines({ lines }: { lines: readonly RunLine[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className={styles.lines}>
      {lines.map(line => (
        <li key={line.key} className={`${styles.line} ${line.missing ? styles.gone : ''}`}>
          <span className={styles.name}>{line.label}</span>
          <span className={styles.amount}>
            <span className={styles.num}>{line.num}</span>
            <span className={styles.unit}>{line.unit}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Controls({ kind, onStart, onSkip, onExtend, onDone }: {
  kind: ReturnType<typeof controlsFor>;
  onStart: () => void;
  onSkip: () => void;
  onExtend: () => void;
  onDone: () => void;
}) {
  const { t } = useT();
  if (kind === 'start-timer') {
    return (
      <div className={styles.actions}>
        <Button variant="primary" className={styles.go} onPress={onStart}>
          <Play aria-hidden="true" />
          {t('cat.startTheTimer')}
        </Button>
        {/* A step can be finished without its timer: the mixer was already running, or this dough needed a minute less.
            Guiding is not commanding. */}
        <Button className={styles.go} onPress={onSkip}>{t('cat.skipTheTimer')}</Button>
      </div>
    );
  }
  if (kind === 'running') {
    return (
      <div className={styles.actions}>
        <Button variant="primary" className={styles.go} isDisabled>{t('cat.running')}</Button>
        <div className={styles.adjust}>
          <Button className={styles.small} onPress={onExtend}>{t('cat.1Min')}</Button>
          <Button className={styles.small} onPress={onDone}>{t('cat.doneEarly')}</Button>
        </div>
      </div>
    );
  }
  return (
    <div className={styles.actions}>
      <Button variant="primary" className={styles.go} onPress={onDone}>
        <Check aria-hidden="true" />
        {kind === 'done-finish' ? t('cat.doneFinish') : t('cat.stepDone')}
      </Button>
    </div>
  );
}

// The last screen: what was made, the recipe's own closing instruction and — the part that matters — anything the procedure
// never mentioned, so a row that was left out of every step does not quietly stay out of the bowl.
function Finished({ snapshotNote, missed, doneRef, onBack }: {
  snapshotNote: string;
  missed: readonly RunLine[];
  doneRef: Ref<HTMLParagraphElement>;
  onBack: () => void;
}) {
  const { t } = useT();
  return (
    <>
      <div className={styles.card}>
        {/* Three DIFFERENT kinds of thing can share this card, each dressed differently so a glance tells them apart: a status,
            the recipe's closing instruction, and the warning. */}
        <p ref={doneRef} tabIndex={-1} className={styles.done}>
          <Check aria-hidden="true" />
          {t('cat.doughFinished')}
        </p>
        {snapshotNote === '' ? null : <p className={styles.endNote}>{snapshotNote}</p>}
        {missed.length === 0 ? null : (
          <div className={styles.missed}>
            <p className={styles.missedTitle}>{t('cat.notInAnyStepCheck')}</p>
            <Lines lines={missed} />
          </div>
        )}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" className={styles.go} onPress={onBack}>
          <Check aria-hidden="true" />
          {t('cat.backToTheRecipe')}
        </Button>
      </div>
    </>
  );
}
