import { useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { planSuppliers, supplierWrites } from '@mise/shared/invoice-import-model';
import type { SupplierPlanEntry } from '@mise/shared/invoice-import-model';
import { useDataServices } from '../../data/DataContext';
import type { MessageKey } from '../../i18n/en';
import { useT } from '../../i18n/useT';
import { markBusy } from '../../session/busy';
import { useSession } from '../../session/SessionContext';
import { ScrollAreaContext } from '../../shell/scrollArea';
import { Button } from '../../ui/Button';
import { FormBar } from '../../ui/FormBar';
import { useAlert } from '../../ui/useAlert';
import { useConfirm } from '../../ui/useConfirm';
import { IMPORT_OPENER, useHandBack } from '../handBack';
import { useSuppliers } from '../SuppliersContext';
import { cameFromList, useLeave } from '../suppliersNav';
import { SUPPLIERS_PATH } from '../suppliersPath';
import type { StoredDoc } from '../suppliersSource';
import { FileStep } from './FileStep';
import { IngredientsStep } from './IngredientsStep';
import { LeaveBlocker } from './LeaveBlocker';
import { NO_TICKS, chooseFrom, failureKey, readInvoiceFiles } from './importRun';
import type { ImportRun, Ticks } from './importRun';
import { SuppliersStep } from './SuppliersStep';
import { decisionsNow, newProgress, pendingOps, saveSupplierOps } from './supplierStep';
import type { SupplierDecision } from './supplierStep';
import styles from './InvoiceImportScreen.module.css';

// «Import from invoices» — suppliers and ingredients, with their prices, from the supplier e-invoices the owner downloaded from
// the Agenzia delle Entrate (the port of js/orders/invoice-import-screen.js, docs/parity/suppliers.md items I1–I9, I24–I36,
// I83–I87, I98–I99). Step 3e-6, part B3a: the frame, step 1 (choose the file) and step 2 (the suppliers). Step 3 and the summary
// are part B3b (IngredientsStep.tsx marks the hand-over).
//
// THE SCREEN DECIDES NOTHING ABOUT THE DATA. The model (@mise/shared/invoice-import-model) matches the file against what the venue
// holds and lists the writes, the plan (invoice-import-plan) applies the answers and re-checks, importSource.ts talks to Firestore.
// This file asks, shows and confirms.
//
// Three steps, one level: Choose the file → Suppliers → Ingredients (→ the summary). Back leaves the whole import (it asks first once
// a file is loaded and the import is not finished — P20); there is no Back inside it.
//
// ⚠️ NOTHING IS WRITTEN BEFORE THE CONFIRMATION OF ITS STEP, and a write never starts while a question is open. While suppliers are
// being written Back is off: a half-sent bulk import is the one thing here that cannot be put back by tapping Cancel.
// ⚠️ NOT LOCAL-FIRST, ON PURPOSE (decision T3): every read is from the server and a write is refused offline (importSource.ts).
// ⚠️ EVERY WORD IS ASKED INSIDE THE DRAWING, and this screen names no food: ingredient names are the file's own.

type Step = 'file' | 'suppliers' | 'ingredients';

const STEP_NUMBER = { file: 1, suppliers: 2, ingredients: 3 } as const satisfies Record<Step, number>;
const STEPS_IN_ALL = 3;

// What step 2 hands to step 3: which supplier each file supplier stands for.
type HandOver = { readonly supplierIdByKey: Readonly<Record<string, string>> };

export default function InvoiceImportScreen() {
  const { t } = useT();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const handBack = useHandBack();
  const scroll = useContext(ScrollAreaContext);
  const { locationId } = useSession();
  // The section is drawn only for a ready session (SectionRoute), so a venue is always open here.
  if (!locationId) throw new Error('Import from invoices needs an open venue.');
  const services = useDataServices();
  const [source] = useState(() => services.invoiceImport(locationId));
  const snapshot = useSuppliers();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const titleId = useId();
  const hintId = useId();

  const [step, setStep] = useState<Step>('file');
  const [live, setLive] = useState('');
  const [busy, setBusy] = useState(false);

  // Step 1
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [fileError, setFileError] = useState<MessageKey | null>(null);
  const [run, setRun] = useState<ImportRun | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Step 2
  const [supplierPlan, setSupplierPlan] = useState<SupplierPlanEntry[]>([]);
  const [answers, setAnswers] = useState<Record<string, SupplierDecision>>({});
  const [skips, setSkips] = useState<ReadonlySet<string>>(new Set());
  const [supplierError, setSupplierError] = useState<MessageKey | null>(null);
  const progress = useRef(newProgress());

  // Step 3 (B3b)
  const [handOver, setHandOver] = useState<HandOver | null>(null);

  // The same values, readable at once (the state is only read on the next render): the blocker and the async handlers use them.
  const runRef = useRef<ImportRun | null>(null);
  const busyRef = useRef(false);
  const working = useRef(false);
  const mounted = useRef(true);
  const leavingClean = useRef(false);
  const askingBack = useRef(false);
  const askingBlocked = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => { runRef.current = run; }, [run]);

  // What the section knows of the venue now, read when a selection or a plan is drawn.
  const latest = useRef(snapshot);
  useEffect(() => { latest.current = snapshot; }, [snapshot]);
  const existing = () => ({ suppliers: latest.current.suppliers, ingredients: latest.current.ingredients });

  // ⚠️ A SELF-STARTED RELOAD WOULD THROW THE IMPORT AWAY: it waits while a file is loaded or something is being written.
  const holding = run !== null || busy;
  useEffect(() => {
    if (!holding) return undefined;
    return markBusy();
  }, [holding]);

  // ── Focus ────────────────────────────────────────────────────────────────────────────────────────────────────────
  const title = useRef<HTMLHeadingElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorLine = useRef<HTMLParagraphElement>(null);
  const resultLine = useRef<HTMLParagraphElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const focusHeading = useRef(false);
  const focusAfterRead = useRef(false);
  const refocusPrimary = useRef(false);

  // Opened from its door the page does not move the focus (FROM_LIST): it goes to this title.
  useEffect(() => {
    if (cameFromList(state) && navigationType !== 'POP') title.current?.focus();
  }, []);

  // After each step: the top, and the step's heading.
  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    const area = scroll.element();
    if (area) area.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [step, scroll]);

  // ⚠️ AFTER A READ the focus — which fell to the page when the picker was disabled — goes to the next thing to do: the line that
  // says how it went (the result, or the refusal), else the Next button (P18).
  useEffect(() => {
    if (reading || !focusAfterRead.current) return;
    focusAfterRead.current = false;
    (errorLine.current ?? resultLine.current ?? primary.current)?.focus({ preventScroll: true });
  }, [reading, run, fileError]);

  // The save button was off while the write ran: the focus comes back to it.
  useEffect(() => {
    if (busy || !refocusPrimary.current) return;
    refocusPrimary.current = false;
    primary.current?.focus({ preventScroll: true });
  }, [busy]);

  const goTo = (next: Step) => {
    focusHeading.current = true;
    setStep(next);
  };

  // ── Leaving ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const leaving = useCallback(() => { handBack.expect(IMPORT_OPENER); }, [handBack]);
  const leave = useLeave(SUPPLIERS_PATH, leaving);

  const leaveQuestion = () => confirm({
    title: t('sup.imp.discard.title'),
    message: t('sup.imp.discard.message'),
    okLabel: t('sup.imp.discard.ok'),
    cancelLabel: t('common.cancel'),
    danger: true,
  });

  // ⚠️ EVERY WAY OUT GOES THROUGH THE ROUTER'S BLOCKER once a file is loaded or something is being written: the browser's Back, the
  // rail and the tab bar all navigate. While the suppliers are being written it refuses without asking.
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leavingClean.current && (runRef.current !== null || busyRef.current)
      && currentLocation.pathname !== nextLocation.pathname,
    [],
  );

  async function back() {
    if (busyRef.current || askingBack.current || askingBlocked.current) return;
    if (runRef.current !== null) {
      askingBack.current = true;
      try {
        if (!(await leaveQuestion()) || !mounted.current) return;
      } finally {
        askingBack.current = false;
      }
    }
    leavingClean.current = true;
    leave();
  }

  // ── Step 1 · choose the file ─────────────────────────────────────────────────────────────────────────────────────

  function resetImport() {
    setRun(null);
    setSupplierPlan([]);
    setAnswers({});
    setSkips(new Set());
    setSupplierError(null);
    setHandOver(null);
    progress.current = newProgress();
  }

  // The invoices the owner downloaded: read in memory, then the venue's remembered decisions (from the server, so offline refuses
  // like every other read of this import). Nothing is written.
  async function onFiles(files: File[]) {
    setFileError(null);
    resetImport();
    setFileName(files.map(file => file.name).join(', '));
    if (files.length === 0) return;
    setReading(true);
    setLive(t('sup.imp.file.reading'));
    try {
      // Let the browser paint «reading» before the heavy, synchronous part starts.
      await new Promise<void>(resolve => { setTimeout(resolve, 0); });
      const built = await readInvoiceFiles(files, locationId as string);
      let stored: StoredDoc[];
      try {
        stored = await source.loadDecisions();
      } catch (error) {
        console.error('The remembered decisions could not be read:', error);
        if (mounted.current) setFileError(failureKey(error, 'sup.imp.file.decisionsFailed'));
        return;
      }
      if (mounted.current) setRun(chooseFrom(built, stored, NO_TICKS, existing()));
    } catch (error) {
      // Whatever threw (the reader, the selection): the same plain message, never an unhandled rejection.
      console.error('The invoices could not be read:', error);
      if (mounted.current) {
        setRun(null);
        setFileError('sup.imp.file.invoicesUnreadable');
      }
    } finally {
      // ⚠️ The picker (off while reading) comes back on success AND on every failure.
      if (mounted.current) {
        setReading(false);
        setLive('');
        focusAfterRead.current = true;
      }
    }
  }

  // Ticking changes the selection at once, in memory — nothing is saved before the import is confirmed.
  function tick(change: (ticks: Ticks) => Ticks) {
    if (!run) return;
    setRun(chooseFrom(run.built, run.storedDecisions, change(run.ticks), existing()));
  }

  const onTick = (productKey: string, on: boolean) => {
    tick(ticks => {
      const overrides = { ...ticks.overrides };
      if (on) overrides[productKey] = 'ingredient';
      else delete overrides[productKey];
      return { ...ticks, overrides };
    });
  };

  const onSupplierTick = (supplierKey: string, on: boolean) => {
    tick(ticks => {
      const supplierOverrides = { ...ticks.supplierOverrides };
      if (on) supplierOverrides[supplierKey] = 'import';
      else delete supplierOverrides[supplierKey];
      return { ...ticks, supplierOverrides };
    });
  };

  // ⚠️ A PLAN DRAWN BEFORE THE LISTS HAVE ARRIVED WOULD CALL EVERYTHING NEW (suppliers included): the section's store must have the
  // suppliers, the ingredients and the prices from the SERVER. An empty venue is an answer too — the flags say «the server spoke»,
  // not «there is something» — so it never stays «loading».
  const ready = snapshot.suppliersFromServer && snapshot.ingredientsFromServer && snapshot.pricesFromServer;
  useEffect(() => {
    if (ready) setFileError(error => (error === 'sup.imp.notReady' ? null : error));
  }, [ready]);

  function startSuppliers() {
    if (!run) return;
    if (!ready) {
      setFileError('sup.imp.notReady');
      focusAfterRead.current = true;
      return;
    }
    // The lists have arrived now: what an article code already in Mise promotes is read again before planning.
    const again = chooseFrom(run.built, run.storedDecisions, run.ticks, existing());
    setRun(again);
    setSupplierPlan(planSuppliers(again.file.suppliers, existing().suppliers));
    setSupplierError(null);
    goTo('suppliers');
  }

  // ── Step 2 · the suppliers ───────────────────────────────────────────────────────────────────────────────────────

  const decisions = decisionsNow(answers, skips);
  const writes = supplierWrites(supplierPlan, decisions);
  const pending = pendingOps(writes.ops, progress.current);
  const blocked = writes.blocked.length;

  function finishSuppliers(done: ReturnType<typeof supplierWrites>) {
    setHandOver({ supplierIdByKey: { ...done.supplierIdByKey, ...progress.current.created } });
    goTo('ingredients');
  }

  async function saveSuppliers(done: ReturnType<typeof supplierWrites>, ops: ReturnType<typeof pendingOps>) {
    if (!run || working.current) return;
    // Taken before the first question: a second tap while the question is open or the write runs does nothing.
    working.current = true;
    try {
      // ⚠️ OFFLINE IS SAID BEFORE ANYTHING ELSE: the import needs the network (parity I8), and a question that ends in a refusal
      // is worse than the refusal.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        await alert({ message: t('sup.imp.stop.offline'), okLabel: t('common.ok') });
        return;
      }
      const creates = ops.filter(op => op.type === 'create-supplier').length;
      const links = ops.filter(op => op.type === 'link-supplier').length;
      const ok = await confirm({
        title: t('sup.imp.suppliers.confirmTitle'),
        message: [
          creates > 0 ? t('sup.imp.suppliers.confirmCreate', { n: creates }) : '',
          links > 0 ? t('sup.imp.suppliers.confirmLink', { n: links }) : '',
        ].filter(Boolean),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;

      busyRef.current = true;
      setBusy(true);
      setSupplierError(null);
      setLive(t('sup.imp.suppliers.saving'));
      const outcome = await saveSupplierOps(source, run.file, supplierPlan, ops, progress.current);
      busyRef.current = false;
      if (!mounted.current) return;
      setLive('');
      if (outcome.kind === 'saved') {
        finishSuppliers(done);
      } else if (outcome.kind === 'changed') {
        // Nothing was written: the answers for the suppliers that changed are void, and the step is drawn again with the fresh plan.
        const changed = new Set(outcome.keys);
        setAnswers(current => Object.fromEntries(Object.entries(current).filter(([key]) => !changed.has(key))));
        setSkips(current => new Set([...current].filter(key => !changed.has(key))));
        setSupplierPlan(outcome.fresh);
        setSupplierError('sup.imp.suppliers.changed');
        refocusPrimary.current = true;
      } else {
        console.error('Saving the imported suppliers failed:', outcome.error);
        setSupplierError(failureKey(outcome.error, 'sup.imp.suppliers.failed'));
        refocusPrimary.current = true;
      }
    } finally {
      busyRef.current = false;
      working.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const onAnswer = (key: string, decision: SupplierDecision | null) => {
    setAnswers(current => {
      const next = { ...current };
      if (decision === null) delete next[key];
      else next[key] = decision;
      return next;
    });
  };

  const onForget = (key: string, forget: boolean) => {
    setSkips(current => {
      const next = new Set(current);
      if (forget) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  // ── The frame ────────────────────────────────────────────────────────────────────────────────────────────────────

  let action = null;
  if (step === 'file' && run && !reading) {
    action = <Button ref={primary} variant="primary" onPress={startSuppliers}>{t('sup.imp.next')}</Button>;
  } else if (step === 'suppliers') {
    action = (
      <Button
        ref={primary}
        variant="primary"
        isDisabled={blocked > 0 || busy}
        aria-describedby={blocked > 0 ? hintId : undefined}
        onPress={() => { if (pending.length > 0) void saveSuppliers(writes, pending); else finishSuppliers(writes); }}
      >
        {pending.length > 0 ? t('sup.imp.suppliers.save', { n: pending.length }) : t('sup.imp.next')}
      </Button>
    );
  }

  return (
    <section className={styles.screen} aria-labelledby={titleId} aria-busy={busy ? true : undefined}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={() => { void back(); }}
        backDisabled={busy}
        title={t('sup.imp.title')}
        titleId={titleId}
        titleRef={title}
        sub={<p className={styles.sub}>{t('sup.imp.stepOf', { n: STEP_NUMBER[step], total: STEPS_IN_ALL })}</p>}
        action={action}
      />
      <div className={styles.body}>
        {step === 'file' ? (
          <FileStep
            headingRef={heading}
            errorRef={errorLine}
            resultRef={resultLine}
            fileName={fileName}
            reading={reading}
            error={fileError}
            run={run}
            open={openGroups}
            onToggle={(group, open) => { setOpenGroups(current => (current[group] === open ? current : { ...current, [group]: open })); }}
            onFiles={files => { void onFiles(files); }}
            onTick={onTick}
            onSupplierTick={onSupplierTick}
          />
        ) : null}
        {step === 'suppliers' ? (
          <SuppliersStep
            headingRef={heading}
            plan={supplierPlan}
            suppliers={snapshot.suppliers}
            answers={answers}
            skips={skips}
            error={supplierError}
            blocked={blocked}
            hintId={hintId}
            busy={busy}
            onAnswer={onAnswer}
            onForget={onForget}
          />
        ) : null}
        {step === 'ingredients' && run && handOver ? (
          <IngredientsStep headingRef={heading} run={run} supplierIdByKey={handOver.supplierIdByKey} />
        ) : null}
        {/* Present, empty, before it speaks: a live region inserted already filled is announced unreliably. */}
        <div role="status" className="visually-hidden">{live}</div>
      </div>
      {confirmDialog}
      {alertDialog}
      <LeaveBlocker shouldBlock={shouldBlock} ask={() => (busyRef.current ? Promise.resolve(false) : leaveQuestion())} asking={askingBlocked} />
    </section>
  );
}
