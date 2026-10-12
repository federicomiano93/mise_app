import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { cloneConfig } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { KEEP_FOCUS } from '../shell/Page';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import type { ConfirmOptions } from '../ui/useConfirm';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { cameFromParent, depthOf, useLeave } from './calculatorNav';
import {
  inWhatsappItem, whatsappDirectPath, whatsappListPath, whatsappPath,
} from './calculatorPath';
import type { WhatsappGroup, WhatsappTarget } from './calculatorPath';
import { whatsappItemOpener, useHandBack } from './handBack';
import { useSaveConfig } from './useSaveConfig';
import { WhatsappClientChooser } from './WhatsappClientChooser';
import { WhatsappEditorContext } from './whatsappEditorContext';
import type { WhatsappEditorState } from './whatsappEditorContext';
import { WhatsappLinesScreen } from './WhatsappLinesScreen';
import { WhatsappListScreen } from './WhatsappListScreen';
import {
  addEntry, copyItem, editLines, findDirect, findList, isBlank, nameOf, newDirect, newList, removeEntry, sameItem, withItem, withName,
} from './whatsappModel';
import type { WorkingItem } from './whatsappModel';
import { WhatsappPicker } from './WhatsappPicker';
import { WhatsappTop } from './WhatsappTop';

// The WhatsApp lists editor (a port of js/calculator-whatsapp-settings.js). It is two things:
//
//   · the TOP (Level 0): the prefill window and the saved lists and direct clients, each with a delete icon. It has no
//     Save and holds no working copy — it reads the live configuration, and a delete is applied at once.
//   · ONE ITEM at a time (a list with its client entries, or a direct client): ONE working copy of that item, held in
//     `WhatsappItemEditor` ABOVE its screens (the list, the chooser, a client's lines, the pickers), so moving between
//     them keeps every edit. Nothing is saved until Save; Save writes ONLY that item over the LATEST configuration.
//
// Opened by SettingsGate, which waits for the venue's real configuration: the item is copied ONCE, when its editor
// opens, so it must not be copied from the empty default.
export function WhatsappEditor({ target }: { target: WhatsappTarget }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = location;
  // The item made by `…/new`, for the editor that is about to open at its own address.
  const fresh = useRef<WorkingItem | null>(null);
  const madeFor = useRef<string | null>(null);

  useEffect(() => {
    if (target.kind === 'top') fresh.current = null;
    if (target.kind !== 'new' || madeFor.current === location.key) return;
    madeFor.current = location.key;
    const made: WorkingItem = target.group === 'list' ? { group: 'list', item: newList() } : { group: 'direct', item: newDirect() };
    fresh.current = made;
    void navigate(made.group === 'list' ? whatsappListPath(made.item.id) : whatsappDirectPath(made.item.id), { replace: true, state });
  }, [target, location.key, navigate, state]);

  if (target.kind === 'top') return <WhatsappTop />;
  if (target.kind === 'new') return null;
  const group: WhatsappGroup = target.kind === 'direct' || target.kind === 'directAdd' ? 'direct' : 'list';
  return <WhatsappItem key={`${group}:${target.id}`} target={target} group={group} seed={fresh.current} />;
}

type ItemTarget = Exclude<WhatsappTarget, { readonly kind: 'top' } | { readonly kind: 'new' }>;

// Finds the item to edit: the saved one, or the one `…/new` has just made. An id the configuration lacks goes back to
// the top.
function WhatsappItem({ target, group, seed }: { target: ItemTarget; group: WhatsappGroup; seed: WorkingItem | null }) {
  const { config } = useCalculator();
  const [initial] = useState<WorkingItem | null>(() => {
    if (group === 'list') {
      const saved = findList(config, target.id);
      if (saved) return { group: 'list', item: copyItem(saved) };
    } else {
      const saved = findDirect(config, target.id);
      if (saved) return { group: 'direct', item: copyItem(saved) };
    }
    return seed !== null && seed.group === group && seed.item.id === target.id ? seed : null;
  });
  if (initial === null) return <Navigate to={whatsappPath} replace state={KEEP_FOCUS} />;
  return <WhatsappItemEditor target={target} initial={initial} />;
}

// ⚠️ THE DISCARD QUESTION FIRES ONLY WHEN THE ITEM IS LEFT ALTOGETHER: every way out goes through the router's blocker,
// which lets a move between the item's own addresses through (the Clients editor's design). Back from the chooser, a
// client's lines or a picker steps up and asks nothing — the edits stay in the working copy. A SAVE IN FLIGHT IS
// PENDING, NOT GONE: Save ignores a second tap and every way out waits. A refused save leaves the screen exactly as it
// was — dirty, with its edits — and Save is given back.
function WhatsappItemEditor({ target, initial }: { target: ItemTarget; initial: WorkingItem }) {
  const { t } = useT();
  const store = useCalculatorStore();
  const navigate = useNavigate();
  const { state } = useLocation();
  const handBack = useHandBack();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const [saveConfig, saveDialog] = useSaveConfig();
  const { group } = initial;
  const id = initial.item.id;
  const leaveToTop = useLeave(whatsappPath);
  const leaveToItem = useLeave(group === 'list' ? whatsappListPath(id) : whatsappDirectPath(id));

  // The item as the editor opened with it, and the copy being edited. The copy is also kept in a ref, written in the
  // same breath as the state: the router's blocker reads «is anything unsaved» before React has rendered an edit.
  const [opening, setOpening] = useState<WorkingItem>(initial);
  const copy = useRef<WorkingItem>(initial);
  const [working, setWorking] = useState<WorkingItem>(initial);
  const [showErrors, setShowErrors] = useState(false);
  const [checkTick, setCheckTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = !sameItem(opening, working);

  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const openingRef = useRef(opening);
  const leavingClean = useRef(false);
  // True only while the configuration is travelling to the server (see shouldBlock).
  const sending = useRef(false);
  const busy = useRef(false);
  const askingLeave = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Unsaved edits: a reload the app starts by itself waits (session/busy.ts).
  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);

  const edit = useCallback((change: (known: WorkingItem) => WorkingItem) => {
    const next = change(copy.current);
    copy.current = next;
    dirtyRef.current = !sameItem(openingRef.current, next);
    setWorking(next);
  }, []);

  const discardQuestion = useCallback(() => confirm({
    title: t('calc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // ── Leaving ───────────────────────────────────────────────────────────────────────────────
  // ⚠️ WHILE THE SAVE IS IN THE AIR A WAY OUT IS REFUSED WITHOUT A QUESTION: the edits are not being lost (they are on
  // their way), so «unsaved changes will be lost?» would be a false alarm; and leaving now would hide the outcome (a
  // refusal is said on THIS screen). The person stays; the save settles; they leave again if they still want.
  const shouldBlock = useCallback<BlockerFunction>(({ nextLocation }) => {
    if (leavingClean.current) return false;
    if (inWhatsappItem(nextLocation.pathname, group, id)) return false;
    return dirtyRef.current || sending.current;
  }, [group, id]);
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    // ⚠️ THE QUESTION STAYS «BEING ASKED» UNTIL THE ROUTER HAS LEFT ITS 'blocked' STATE, not until the answer (see the
    // Clients editor): a render in between would ask the same question again.
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

  // Back from the list or the direct client asks for itself BEFORE it navigates: its navigate(-1) is a POP, and the
  // router's blocker fails silently on a POP to an entry it did not create (a page opened by its address).
  const leaveItem = useCallback(async () => {
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
    handBack.expect(whatsappItemOpener(group, id));
    leaveToTop();
  }, [discardQuestion, leaveToTop, handBack, group, id]);

  // P20: after a successful save, back to the top — from however deep the person is. Each screen the editor pushed
  // carries its depth, so one step back of that many lands on the top without a trail of screens behind it.
  function goTop() {
    leavingClean.current = true;
    handBack.expect(whatsappItemOpener(group, id));
    const depth = depthOf(state);
    if (cameFromParent(state) && depth > 0) void navigate(-depth);
    else void navigate(whatsappPath, { replace: true, state: KEEP_FOCUS });
  }

  async function save() {
    if (busy.current || askingLeave.current) return;
    busy.current = true;
    setSaving(true);
    try {
      // Required first: the name is marked, the person is taken to the screen that has it, and the sentence is said.
      // The focus moves to the field once it has been read.
      if (isBlank(nameOf(copy.current))) {
        setShowErrors(true);
        if (target.kind === 'entry') leaveToItem();
        await alert({
          message: t(group === 'list' ? 'calc.pleaseNameThisList' : 'calc.pleaseNameThisClient'),
          okLabel: t('common.ok'),
        });
        if (mounted.current) setCheckTick(tick => tick + 1);
        return;
      }
      const ok = await confirm({
        title: t('calc.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      // The latest configuration, with only this item written over it: another phone's change to any other list,
      // client or key must not be undone by this save.
      const latest = cloneConfig(store.getSnapshot().config);
      const saved = copy.current;
      sending.current = true;
      let stored: boolean;
      try {
        stored = await saveConfig(withItem(latest, saved));
      } finally {
        sending.current = false;
      }
      if (!stored || !mounted.current) return;
      dirtyRef.current = false;
      openingRef.current = saved;
      setOpening(saved);
      setShowErrors(false);
      goTop();
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const value: WhatsappEditorState = {
    working,
    dirty,
    saving,
    showErrors,
    checkTick,
    rename: name => { edit(known => withName(known, name)); },
    addEntry: clientId => {
      edit(known => (known.group === 'list' ? { group: 'list', item: addEntry(known.item, clientId) } : known));
    },
    removeEntry: clientId => {
      edit(known => (known.group === 'list' ? { group: 'list', item: removeEntry(known.item, clientId) } : known));
    },
    editLines: (clientId, change) => { edit(known => editLines(known, clientId, change)); },
    save,
    leaveItem,
    confirm: (options: ConfirmOptions) => confirm(options),
  };

  return (
    <WhatsappEditorContext.Provider value={value}>
      {screenOf(target)}
      {confirmDialog}
      {alertDialog}
      {saveDialog}
    </WhatsappEditorContext.Provider>
  );
}

function screenOf(target: ItemTarget) {
  switch (target.kind) {
    case 'list':
      return <WhatsappListScreen />;
    case 'listAdd':
      return <WhatsappClientChooser />;
    case 'entry':
      return <WhatsappLinesScreen key={target.clientId} clientId={target.clientId} />;
    case 'entryAdd':
      return <WhatsappPicker key={target.clientId} clientId={target.clientId} />;
    case 'direct':
      return <WhatsappLinesScreen clientId={null} />;
    case 'directAdd':
      return <WhatsappPicker clientId={null} />;
  }
}
