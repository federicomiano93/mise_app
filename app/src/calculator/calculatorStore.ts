// calculatorStore.ts — the Calculator's configuration, the catalogue recipes its tabs are linked to, and the
// recent dough logs. One venue. The work view READS the configuration and WRITES logs (Confirm); the Settings
// WRITE the configuration (`saveConfig`, step 3c-2).
//
// A port of js/calculator-config-store.js, js/calculator-catalogue-link.js and js/log-store.js (the legacy
// migration left out: it stays in the current app), as plain TypeScript with no React and no Firebase in it: the source
// (calculatorSource.ts) and the browser (deps) are injected, so every trap below is a spec with fakes
// (calculatorStore.spec.ts). Screens read it through CalculatorContext.tsx.
//
// It says nothing in words: a failure is a CalculatorMessage, and the screen puts it in the person's language.
//
// ⚠️ THE LOCAL COPIES ARE THE CURRENT APP'S (same origin): `calculator-config` (the normalised configuration as
// JSON) and `logs-cache` (the array of log documents). Both apps paint from each other's copy, so the shapes
// must match exactly. Neither is under KEEP_PREFIXES: a venue switch wipes them, which is what keeps two
// venues apart (the venue is not in the key, it never was).
//
// ⚠️ DIFFERENCES FROM THE ORIGINAL, ON PURPOSE (docs/parity/calculator.md):
//   • a cached «there is no document» is not an answer at all (the Pastries' trap — the browser's own database
//     can be empty because this phone never synced it); a cached document IS one (it is real data, read from
//     the server once). The current app counts any callback.
//   • the same for a linked recipe: a cached «missing» is not shown as «missing» until the server says so.
//   • an empty logs answer from the browser's own database is not believed over a local copy that had logs.
//   • a log write the database REFUSES is said out loud (`log-not-saved`); the current app only logs it to the
//     console. Local-first stays: nothing is taken back by hand, the live stream shows what the server holds.
//   • a log already at the rules' 100-version cap is not written again (every further write would be
//     refused): `log-full` says so, and Reset starts a new log. The same for an edit or a restore
//     (`log-history-full`: Reset does not apply there).
//   • a NEW VERSION of an existing log (a re-Confirm, an edit, a restore) is sent ALONE and added to the server's
//     chain (calculatorSource `appendLogVersion`); the current app writes the whole chain as the phone holds it,
//     which drops a version another phone added meanwhile and recreates a log another phone deleted. Only a
//     brand-new log is written whole.
//   • a deleted log stays gone while its delete is in the air (offline: until the connection returns), and a
//     delete the database REFUSES brings the log back and says so (`log-not-deleted`); the current app only
//     logs it to the console and shows the log gone until the next load.
//   • while a configuration save is in the air, and until the stream shows the revision it wrote, the stream's
//     older document is HELD, not shown: Mise 2 listens with includeMetadataChanges, so a connection blip
//     re-delivers the document as it was before the save, and the screen would jump back to the old settings
//     (the current app does not hear metadata changes). A held document is still an answer.
//   • the store says nothing about a save kept local («the server has not answered»): it returns the reason,
//     and the screen says it in the person's language.

import { normalizeConfig, cloneConfig, DEFAULT_CONFIG, getRecipes } from '@mise/shared/calculator-config';
import type { CalculatorConfig } from '@mise/shared/calculator-config';
import { linkedRecipeIds } from '@mise/shared/calculator-recipe-source';
import { addVersion, confirmTarget, createLog, restoreVersion, setForDay } from '@mise/shared/log-model';
import type { ForDay, Log, LogVersion } from '@mise/shared/log-model';
import type { KeyValueStorage } from '../session/backend';
import type { CalculatorSource, StoredDoc } from './calculatorSource';

export const CONFIG_KEY = 'calculator-config';
export const LOGS_KEY = 'logs-cache';
// How far back the logs are read (js/firebase.js LOG_WINDOW_DAYS): far wider than the 48 hours the Log
// screen can show at most, so the window is never what hides a log.
export const LOG_WINDOW_DAYS = 30;
// firestore.rules: `versions` ≤ 100 (a document dies at 1 MB).
export const MAX_LOG_VERSIONS = 100;

export type CalculatorMessage =
  // A confirmed dough was refused by the database: it is not in the shared log.
  | { readonly kind: 'log-not-saved'; readonly dough: string }
  // A log added, edited or restored in the Dough history was refused by the database.
  | { readonly kind: 'log-history-not-saved'; readonly dough: string }
  // The tab's log already holds the most versions a log may hold: nothing was written.
  | { readonly kind: 'log-full'; readonly dough: string }
  // The same, met by an edit or a restore in the Dough history: Reset does not apply there.
  | { readonly kind: 'log-history-full'; readonly dough: string }
  // A delete was refused by the database: the log is back in the list.
  | { readonly kind: 'log-not-deleted'; readonly dough: string }
  // The configuration's live stream died (refused, or never started).
  | { readonly kind: 'config-stream-broken' }
  // The logs' live stream died.
  | { readonly kind: 'logs-stream-broken' };

// What a configuration save came to (js/calculator-config-store.js `saveConfig`). `saveFailureKey` of
// @mise/shared/calculator-config turns it into the sentence to say, or null when there is nothing to say.
export type ConfigSaveResult =
  | { readonly synced: true }
  // Kept on this device only: the database has not answered once, and sending the empty default (or a stale
  // copy) would overwrite the venue's real address book. The screen says so (`calc.savedLocallyOnly`).
  | { readonly synced: false; readonly reason: 'no-server-answer' }
  // Refused or unreachable: the change has been TAKEN BACK here, and the screen keeps its edits to try again.
  | { readonly synced: false; readonly reason: 'write-failed'; readonly code: string | null };

export interface CalculatorSnapshot {
  // The configuration in effect: the local copy (or the empty default) until the database answers.
  readonly config: CalculatorConfig;
  // Whether a believable answer came once: a document (even from the browser's own database), or the SERVER's
  // «there is no document». What
  // calculatorEmptyReason's `serverAnswered` means: until then an empty Calculator says «Loading…», never
  // «you have no recipes».
  readonly configAnswered: boolean;
  // The configuration's stream failed: the screen says it could not be loaded instead of «Loading…».
  readonly configFailed: boolean;
  // The SERVER has answered at least once (a document or «there is no document»), not only the browser's own
  // database. ⚠️ AN EDITOR COPIES THE CONFIGURATION ONLY AFTER THIS, and nothing is sent before it: the browser's
  // database answers in milliseconds with whatever this phone last saw — yesterday's clients on a tablet that
  // reopens straight onto the Clients editor — and a Save from that copy would write it over what other phones
  // added since. The work view may paint from it; a writer may not.
  readonly configFromServer: boolean;
  // id → the linked catalogue recipe, or null when it is gone or cannot be read. A MISSING KEY means «not
  // answered yet» — a different sentence from «gone» (js/calculator-catalogue-link.js).
  readonly linked: Readonly<Record<string, StoredDoc | null>>;
  // The logs of the last 30 days, as stored (ordering is the screen's).
  readonly logs: readonly Log[];
  // The logs can be trusted for «does this tab's log still exist»: a local copy existed, or a believable
  // answer came, or the stream failed.
  readonly logsLoaded: boolean;
  // Log writes or a configuration save handed over and not yet answered. While true the section holds the
  // session's busy marker.
  readonly unsent: boolean;
}

// What Confirm hands over: the version WITHOUT its kind — create or edit is the store's decision.
export interface DoughConfirm {
  // The log the tab is locked to (lock-<rid>.logId), or null.
  readonly linkedLogId: string | null;
  readonly dough: string;
  readonly recipeId: string;
  readonly forDay: ForDay;
  readonly version: Omit<LogVersion, 'kind'>;
}

export interface ConfirmResult {
  // The log the tab is now locked to.
  readonly logId: string;
  readonly target: 'create' | 'update';
}

// A log written by hand from the Dough history («Add log»): the version WITHOUT its kind.
export interface ManualLog {
  readonly dough: string;
  readonly recipeId: string;
  readonly forDay: ForDay;
  readonly version: Omit<LogVersion, 'kind'>;
}

// What an edit or a restore came to: written; refused before writing because the log already holds the most
// versions a log may hold (a `log-history-full` message says so); or the log is not (or no longer) in the list.
export type LogChange = 'saved' | 'full' | 'missing';

export interface CalculatorDeps {
  // localStorage, or null when the browser will not give it (then nothing is remembered).
  readonly storage: KeyValueStorage | null;
  now(): number;
  // A new log id: `log-<uuid>`, or `log-<time36>-<random>` without crypto.randomUUID (js/log-store.js).
  newLogId(): string;
  warn(message: string, detail?: unknown): void;
}

export interface CalculatorOptions {
  // The default title of a WhatsApp list, in the interface language (normalizeConfig's second argument).
  readonly marketOrderTitle?: string;
}

export interface CalculatorStore {
  getSnapshot(): CalculatorSnapshot;
  subscribe(listener: () => void): () => void;
  onMessage(listener: (message: CalculatorMessage) => void): () => void;
  // Starts the listeners; stop() ends them. Safe to call start → stop → start (React's development mode does
  // exactly that). Writes in the air are not cut short by stop().
  start(): void;
  stop(): void;
  // Saves a confirmed dough LOCAL-FIRST: a new log, or a new version of the tab's log when it still exists.
  // null when nothing was written (the log is full: a `log-full` message says so).
  confirmDough(input: DoughConfirm): ConfirmResult | null;
  // The Dough history's writes, all LOCAL-FIRST like Confirm (the list changes at once, the write follows; a
  // refusal is said as a message). `addLog` makes a NEW log with `origin: 'manual'` and returns its id.
  addLog(input: ManualLog): string;
  // Appends an `edit` version to a log.
  editLog(logId: string, version: Omit<LogVersion, 'kind'>): LogChange;
  // Appends a copy of version `index` (0-based) on top, as a `restore`: the history is never truncated.
  restoreLog(logId: string, index: number, meta: { calculatedBy: string; at: { date: string; time: string } }): LogChange;
  // Deletes a whole log. A log that is not in the list is left alone.
  deleteLog(logId: string): void;
  // Saves the whole configuration LOCAL-FIRST: memory, the local copy and the screen change at once; then it is
  // sent, unless the database has never answered (see ConfigSaveResult). A refused or failed write is taken back
  // here if nothing newer replaced it. Never rejects.
  saveConfig(next: CalculatorConfig): Promise<ConfigSaveResult>;
  // Every catalogue recipe, read once from the server (the link picker). Rejects when it cannot be read.
  listCatalogueRecipes(): Promise<StoredDoc[]>;
  // Gives every row of catalogue recipe `id`, as the server holds it now, a stable id and resolves with those
  // rows (calculatorSource `stampRowIds`). Rejects when refused, unreachable or gone: the caller links nothing.
  stampRowIds(id: string): Promise<unknown[]>;
}

export function genLogId(randomUUID?: () => string, now: number = Date.now(), random: () => number = Math.random): string {
  if (randomUUID) return 'log-' + randomUUID();
  return 'log-' + now.toString(36) + '-' + random().toString(36).slice(2, 8);
}

export function browserCalculatorDeps(): CalculatorDeps {
  let storage: KeyValueStorage | null = null;
  try { storage = window.localStorage; } catch { /* blocked site data */ }
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? () => crypto.randomUUID()
    : undefined;
  return {
    storage,
    now: () => Date.now(),
    newLogId: () => genLogId(uuid),
    warn: (message, detail) => console.warn(message, detail),
  };
}

function isLog(value: unknown): value is Log {
  return !!value && typeof value === 'object' && typeof (value as Log).id === 'string' && !!(value as Log).id;
}

export function createCalculatorStore(
  source: CalculatorSource,
  options: CalculatorOptions,
  deps: CalculatorDeps,
): CalculatorStore {
  const title = options.marketOrderTitle;
  const normalize = (raw: unknown) => (title ? normalizeConfig(raw, title) : normalizeConfig(raw));

  // A corrupt or unavailable copy reads as «none»; the listener fills it in.
  function readJson(key: string): unknown {
    try {
      const raw = deps.storage?.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function writeJson(key: string, value: unknown): void {
    try {
      deps.storage?.setItem(key, JSON.stringify(value));
    } catch {
      // Storage full or blocked: the copy in memory still works this session.
    }
  }

  const bootConfig = readJson(CONFIG_KEY);
  const bootLogs = readJson(LOGS_KEY);

  // normalizeConfig never throws and rebuilds from a fixed key list, so a junk copy reads as the empty default.
  let config: CalculatorConfig = bootConfig ? normalize(bootConfig) : cloneConfig(DEFAULT_CONFIG);
  let configAnswered = false;
  let configFailed = false;
  let configFromServer = false;
  let linked: Readonly<Record<string, StoredDoc | null>> = {};
  // What the stream last said, and the logs written here that the stream may not show yet.
  let streamLogs: readonly Log[] = Array.isArray(bootLogs) ? bootLogs.filter(isLog) : [];
  const pending = new Map<string, { log: Log; seq: number }>();
  let logs: readonly Log[] = streamLogs;
  let logsLoaded = Array.isArray(bootLogs);
  let logsFromServer = false;
  let inFlight = 0;
  let seq = 0;
  // Deletes in the air (id → how many), and the logs this session has deleted for good: both are kept out of
  // the list, whatever the stream or a late write's answer says (see `gone`).
  const deleting = new Map<string, number>();
  const deleted = new Set<string>();
  // Configuration saves in the air; the revision this phone last wrote; and the stream's latest document while
  // it may not be shown (older than that revision, or a save is in the air).
  let configSaving = 0;
  let writtenRev = 0;
  let heldConfig: Record<string, unknown> | null = null;

  const listeners = new Set<() => void>();
  const messageListeners = new Set<(message: CalculatorMessage) => void>();
  let stops: Array<() => void> = [];
  const linkedStops = new Map<string, () => void>();
  let started = false;

  let snapshot: CalculatorSnapshot = build();

  function build(): CalculatorSnapshot {
    return {
      config, configAnswered, configFailed, configFromServer, linked, logs, logsLoaded,
      unsent: inFlight > 0 || configSaving > 0,
    };
  }

  // ⚠️ A LISTENER THAT THROWS NEVER STOPS THE DATA (store-notify-guarded): the data is stored before anybody
  // is told, and one bad subscriber does not keep the others from hearing.
  function changed(): void {
    snapshot = build();
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        deps.warn('Calculator: screen refresh failed', err);
      }
    }
  }

  function say(message: CalculatorMessage): void {
    for (const listener of [...messageListeners]) {
      try {
        listener(message);
      } catch (err) {
        deps.warn('Calculator: message listener failed', err);
      }
    }
  }

  // The logs the screen sees: the stream's, with every log written here and not yet answered laid on top (a
  // log confirmed before Firestore had even loaded must exist at once, or the next Confirm on the same tab
  // would make a second log instead of a new version).
  function mergeLogs(): void {
    let next: readonly Log[] = streamLogs;
    if (pending.size > 0) {
      const byId = new Map(streamLogs.map(log => [log.id, log] as const));
      for (const [id, { log }] of pending) byId.set(id, log);
      next = [...byId.values()];
    }
    logs = deleting.size > 0 || deleted.size > 0 ? next.filter(log => !gone(log.id)) : next;
    writeJson(LOGS_KEY, logs);
  }

  // ⚠️ A DELETED LOG NEVER COMES BACK BY ITSELF: an earlier write of it answering late, or a dead stream that still
  // holds it, must not put back what somebody has just thrown away (and a tab locked to it would then UPDATE it).
  function gone(id: string): boolean {
    return deleting.has(id) || deleted.has(id);
  }

  // Starts a listener for every newly linked recipe and stops the ones nothing points at any more.
  function syncLinked(): void {
    if (!started) return;
    const wanted = new Set(linkedRecipeIds(getRecipes(config)));
    let dropped = false;
    for (const [id, stop] of linkedStops) {
      if (wanted.has(id)) continue;
      stop();
      linkedStops.delete(id);
      if (id in linked) {
        const next = { ...linked };
        delete next[id];
        linked = next;
        dropped = true;
      }
    }
    for (const id of wanted) {
      if (linkedStops.has(id)) continue;
      // The id is registered BEFORE the watch starts: a source that answers at once (a cached document) must
      // not find it missing and drop the answer.
      let stopWatch: () => void = () => {};
      linkedStops.set(id, () => stopWatch());
      stopWatch = source.watchLinkedRecipe(id, (recipe, meta) => {
        if (!linkedStops.has(id)) return;
        // ⚠️ A CACHED «MISSING» IS NOT AN ANSWER: offline on a phone that never read this recipe, the browser's
        // database says «no such document», and the tab would say «the recipe was deleted» when it was not.
        if (!recipe && !meta.fromServer) return;
        // The same answer again (only the metadata changed) is no news: the snapshot keeps its objects.
        if (id in linked && JSON.stringify(linked[id]) === JSON.stringify(recipe)) return;
        linked = { ...linked, [id]: recipe };
        changed();
      });
    }
    if (dropped) changed();
  }

  const revOf = (data: Record<string, unknown>) => Number(data.configRev) || 0;

  function onConfig(data: Record<string, unknown> | null, fromServer: boolean): void {
    // The first answer from the server is news even when nothing else changes (an editor is waiting for it).
    const firstFromServer = fromServer && !configFromServer;
    if (fromServer) configFromServer = true;
    readConfig(data, fromServer);
    if (firstFromServer) changed();
  }

  function readConfig(data: Record<string, unknown> | null, fromServer: boolean): void {
    if (!data) {
      // «No document» from the browser's own database proves nothing; from the server it is the answer a
      // brand-new venue gets, and the empty screen must hear it (js/calculator-config-store.js).
      if (!fromServer) return;
      // The document is gone: no revision of ours can be waited for any more.
      writtenRev = 0;
      heldConfig = null;
      if (configAnswered) return; // a later null: the document was deleted; keep what is on screen
      configAnswered = true;
      configFailed = false;
      changed();
      return;
    }
    // ⚠️ HELD, NOT SHOWN, while it may be the document as it was BEFORE this phone's own save (see the header). It
    // still counts as the answer.
    if (configSaving > 0 || revOf(data) < writtenRev) {
      heldConfig = data;
      if (!configAnswered || configFailed) {
        configAnswered = true;
        configFailed = false;
        changed();
      }
      return;
    }
    heldConfig = null;
    applyConfig(data);
  }

  // A held document is shown once nothing of ours is in the air and it is not older than what we wrote.
  function releaseHeld(): void {
    if (configSaving > 0 || !heldConfig || revOf(heldConfig) < writtenRev) return;
    const data = heldConfig;
    heldConfig = null;
    applyConfig(data);
  }

  function applyConfig(data: Record<string, unknown>): void {
    // ⚠️ THE SAME CONFIGURATION KEEPS THE SAME OBJECT. The listener also fires when only the metadata changes
    // (the connection drops or comes back, the server confirms the phone's copy), and a new object would read as
    // «the configuration changed» to every screen — the full-screen recipe closes on exactly that.
    const next = normalize(data);
    const same = JSON.stringify(next) === JSON.stringify(config);
    const news = !same || !configAnswered || configFailed;
    if (!same) {
      config = next;
      writeJson(CONFIG_KEY, config);
    }
    // A document from the browser's own database is still the venue's real data (it came from the server
    // once), unlike the empty default the guard exists for: it counts as the answer, as in the current app.
    configAnswered = true;
    configFailed = false;
    if (!same) syncLinked();
    if (news) changed();
  }

  function onLogs(list: StoredDoc[], fromServer: boolean): void {
    // ⚠️ An EMPTY answer from the browser's own database is not believed over a copy that had logs.
    if (!fromServer && list.length === 0 && streamLogs.length > 0 && !logsFromServer) return;
    if (fromServer) logsFromServer = true;
    streamLogs = list.filter(isLog) as Log[];
    logsLoaded = true;
    mergeLogs();
    changed();
  }

  // `refused`: what to say when the database refuses it (a Confirm and a Dough history change say it differently).
  // `send`: how it reaches the database — the whole document for a NEW log, only the added version otherwise.
  function write(
    log: Log,
    refused: 'log-not-saved' | 'log-history-not-saved',
    send: () => Promise<void> = () => source.saveLog(log),
  ): void {
    const mySeq = ++seq;
    pending.set(log.id, { log, seq: mySeq });
    inFlight += 1;
    mergeLogs();
    changed();
    const settle = (saved: boolean) => {
      inFlight -= 1;
      // Only the latest write of this log leaves the overlay: an older one answering late must not drop a
      // newer version the stream has not shown yet.
      if (pending.get(log.id)?.seq === mySeq) {
        pending.delete(log.id);
        // ⚠️ A SAVED LOG THE STREAM HAS NOT SHOWN STAYS IN THE LIST (as js/log-store.js keeps it in `current`):
        // a dead stream never shows it, and without it the tab's next Confirm would make a SECOND log. The
        // stream's next answer replaces the list as ever.
        if (saved && !gone(log.id) && !streamLogs.some(known => known.id === log.id)) streamLogs = [...streamLogs, log];
        mergeLogs();
      }
      changed();
    };
    send().then(() => settle(true), err => {
      deps.warn('[logs] confirmed dough not saved:', err);
      settle(false);
      say({ kind: refused, dough: log.dough });
    });
  }

  // The log as the list shows it now, or null (never one that is being deleted).
  const findLog = (id: string): Log | null => logs.find(log => log.id === id) ?? null;

  // A new version on top of a log already in the list, unless it is full.
  function append(logId: string, makeNext: (log: Log) => Log): LogChange {
    const log = findLog(logId);
    if (!log) return 'missing';
    if ((log.versions?.length ?? 0) >= MAX_LOG_VERSIONS) {
      say({ kind: 'log-history-full', dough: log.dough });
      return 'full';
    }
    const next = makeNext(log);
    write(next, 'log-history-not-saved', appendOnly(next, null));
    return 'saved';
  }

  // How a NEW VERSION of an existing log is sent: only that version, added to the server's chain
  // (calculatorSource `appendLogVersion`) — never the whole chain as this phone holds it. The list shows the
  // whole `next` at once; the stream then shows the server's chain, another phone's versions included.
  function appendOnly(next: Log, forDay: ForDay | null): () => Promise<void> {
    const versions = next.versions ?? [];
    const added = versions[versions.length - 1] ?? {};
    return () => source.appendLogVersion(next.id, added as Record<string, unknown>, forDay);
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },

    onMessage(listener) {
      messageListeners.add(listener);
      return () => { messageListeners.delete(listener); };
    },

    start() {
      if (started) return;
      started = true;
      stops = [
        source.watchConfig(
          (data, meta) => onConfig(data, meta.fromServer),
          () => {
            configFailed = true;
            changed();
            say({ kind: 'config-stream-broken' });
          },
        ),
        source.watchLogs(
          deps.now() - LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000,
          (list, meta) => onLogs(list, meta.fromServer),
          () => {
            // The local copy stays the best guess; Confirm can still decide create or update from it.
            logsLoaded = true;
            changed();
            say({ kind: 'logs-stream-broken' });
          },
        ),
      ];
      syncLinked();
    },

    stop() {
      if (!started) return;
      started = false;
      for (const stop of stops) stop();
      stops = [];
      for (const stop of linkedStops.values()) stop();
      linkedStops.clear();
    },

    confirmDough(input) {
      const linkedLog = input.linkedLogId ? logs.find(log => log.id === input.linkedLogId) ?? null : null;
      const target = confirmTarget({ linkedId: input.linkedLogId, linkedExists: !!linkedLog });
      if (target === 'update' && linkedLog) {
        if ((linkedLog.versions?.length ?? 0) >= MAX_LOG_VERSIONS) {
          say({ kind: 'log-full', dough: linkedLog.dough });
          return null;
        }
        const next = setForDay(addVersion(linkedLog, { ...input.version, kind: 'edit' }), input.forDay);
        write(next, 'log-not-saved', appendOnly(next, input.forDay));
        return { logId: next.id, target: 'update' };
      }
      const log = createLog({
        id: deps.newLogId(),
        dough: input.dough,
        recipeId: input.recipeId,
        forDay: input.forDay,
        version: { ...input.version, kind: 'create' },
        createdAtMs: deps.now(),
        origin: 'calculator',
      });
      write(log, 'log-not-saved');
      return { logId: log.id, target: 'create' };
    },

    addLog(input) {
      const log = createLog({
        id: deps.newLogId(),
        dough: input.dough,
        recipeId: input.recipeId,
        forDay: input.forDay,
        version: { ...input.version, kind: 'create' },
        createdAtMs: deps.now(),
        origin: 'manual',
      });
      write(log, 'log-history-not-saved');
      return log.id;
    },

    editLog: (logId, version) => append(logId, log => addVersion(log, { ...version, kind: 'edit' })),

    restoreLog(logId, index, meta) {
      const log = findLog(logId);
      // An index outside the chain would append nothing (restoreVersion returns a copy): nothing to write.
      if (log && !(Number.isInteger(index) && index >= 0 && index < (log.versions?.length ?? 0))) return 'missing';
      return append(logId, current => restoreVersion(current, index, meta));
    },

    deleteLog(logId) {
      const log = findLog(logId);
      if (!log) return;
      deleting.set(logId, (deleting.get(logId) ?? 0) + 1);
      inFlight += 1;
      mergeLogs();
      changed();
      const settle = () => {
        inFlight -= 1;
        const left = (deleting.get(logId) ?? 1) - 1;
        if (left > 0) deleting.set(logId, left);
        else deleting.delete(logId);
      };
      source.deleteLog(logId).then(() => {
        settle();
        deleted.add(logId);
        streamLogs = streamLogs.filter(known => known.id !== logId);
        mergeLogs();
        changed();
      }, (err: unknown) => {
        deps.warn('[logs] delete refused:', err);
        settle();
        // ⚠️ REFUSED: the log comes back from what the stream holds (it never stopped holding it).
        mergeLogs();
        changed();
        say({ kind: 'log-not-deleted', dough: log.dough });
      });
    },

    saveConfig(next) {
      const previous = config;
      const mine = normalize(next);
      config = mine;
      writeJson(CONFIG_KEY, config);
      syncLinked();
      // ⚠️ NOTHING LEAVES THE DEVICE BEFORE THE SERVER HAS ANSWERED ONCE (js/calculator-config-store.js
      // `serverAnswered`): until then the configuration on screen may be the empty default or a stale copy, and
      // the first Save would write it over the venue's real clients, products and recipes. «There is no
      // document» from the server IS an answer, so a brand-new venue can save its first client.
      // ⚠️ STRICTER THAN THE CURRENT APP: an answer from the browser's own database does not count here (see
      // `configFromServer`) — a whole configuration built on yesterday's copy must not be sent.
      if (!configFromServer) {
        changed();
        deps.warn('Calculator config kept local only: the server has not answered yet.');
        return Promise.resolve({ synced: false, reason: 'no-server-answer' } as const);
      }
      configSaving += 1;
      changed();
      return source.saveConfig(mine).then(
        (rev): ConfigSaveResult => {
          configSaving -= 1;
          writtenRev = Math.max(writtenRev, Number(rev) || 0);
          // ⚠️ THE COPY ON SCREEN TAKES THE REVISION IT WAS WRITTEN AS: with the old one, every next save would read
          // as a concurrent write to reconcileConfigWrite and put back each `cat-*` recipe deleted since — for good
          // when the stream is dead and no echo ever brings the new revision.
          if (config === mine && Number(rev) > 0) {
            config = { ...config, configRev: Number(rev) };
            writeJson(CONFIG_KEY, config);
          }
          releaseHeld();
          changed();
          return { synced: true };
        },
        (err: unknown): ConfigSaveResult => {
          deps.warn('Calculator config not saved to Firestore:', err);
          configSaving -= 1;
          // ⚠️ A REFUSED WRITE IS TAKEN BACK HERE TOO: nothing sends it again, and the next load would replace it
          // with the server's copy — so keeping it would show the change as saved until then, and then lose it.
          // The screen keeps ITS working copy with the edits. Only if nothing newer replaced it meanwhile.
          if (config === mine) {
            config = previous;
            writeJson(CONFIG_KEY, config);
            syncLinked();
          }
          releaseHeld();
          changed();
          const code = err && typeof err === 'object' && typeof (err as { code?: unknown }).code === 'string'
            ? (err as { code: string }).code
            : null;
          return { synced: false, reason: 'write-failed', code };
        },
      );
    },

    listCatalogueRecipes: () => source.listCatalogueRecipes(),

    stampRowIds: id => source.stampRowIds(id),
  };
}
