import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { cloneConfig, getClients, getRecipes } from '@mise/shared/calculator-config';
import type { Client } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import type { ConfirmOptions } from '../ui/useConfirm';
import { ClientList } from './ClientList';
import { ClientScreen } from './ClientScreen';
import { ClientsEditorContext } from './clientsEditorContext';
import type { ClientsEditorState } from './clientsEditorContext';
import {
  firstInvalid, isEmptyClient, moveClients, newClient, newProduct, patchClient, patchProduct, pausedQuantityKeys, sameClients,
  settleClients,
} from './clientsModel';
import { useCalculator, useCalculatorStore } from './CalculatorContext';
import { FROM_PARENT, useLeave } from './calculatorNav';
import { SETTINGS_PATH, clientPath, clientsPath, inClientsEditor } from './calculatorPath';
import type { SettingsTarget } from './calculatorPath';
import { useTabState } from './TabStateContext';
import { useSaveConfig } from './useSaveConfig';

// The Clients editor (a port of the editor in js/calculator-settings.js): ONE working copy of the whole address
// book, held HERE, above the list and the client screen, so going from the list to a client and back keeps every
// edit. Nothing is saved until Save; Save commits the whole `clients` array over the LATEST configuration (no
// other key of it is touched), asking first.
//
// Opened by SettingsGate, which waits for the venue's real configuration: the copy below is made ONCE, when the
// editor opens, so it must not be made from the empty default.
//
// The client's ordering link (parity 75) is drawn by ClientScreen (`OrderingLink`) and acts on the database at once, so it
// shows only a sentence while this editor holds unsaved changes. Republishing the clients' ordering menus when the address
// book is saved is the store's `onConfigSaved` (CalculatorContext), not this editor's business.
//
// ⚠️ THE DISCARD QUESTION FIRES ONLY WHEN THE EDITOR IS LEFT ALTOGETHER: every way out goes through the router's
// blocker, which lets a move between the editor's own addresses through. A SAVE IN FLIGHT IS PENDING, NOT GONE:
// Save ignores a second tap and Back waits (port of createSaveGuard). A refused save leaves the screen exactly as it
// was — dirty, with its edits — and Save is given back.
export function ClientsEditor({ target }: { target: SettingsTarget }) {
  const { t } = useT();
  const store = useCalculatorStore();
  const tabState = useTabState();
  const { config } = useCalculator();
  const navigate = useNavigate();
  const { state } = useLocation();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const [saveConfig, saveDialog] = useSaveConfig();
  const leaveToHub = useLeave(SETTINGS_PATH);
  const leaveToList = useLeave(clientsPath);
  const recipes = getRecipes(config);

  // The address book as the editor opened with it (or as it was last saved), and the copy being edited.
  const [opening, setOpening] = useState<Client[]>(() => cloneConfig(getClients(config)));
  const [clients, setClients] = useState<readonly Client[]>(opening);
  const [freshId, setFreshId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [checkTick, setCheckTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const dirty = !sameClients(opening, clients);

  // ⚠️ DIRTY IS ALSO KEPT IN A REF: the router's blocker reads it at the moment of a navigation, and a state value
  // read there could be one render behind.
  const dirtyRef = useRef(dirty);
  useLayoutEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  // The client on show was just added and is still empty: leaving it asks to drop it.
  const freshEmpty = target.kind === 'one' && freshId === target.id
    && isEmptyClient(clients.find(known => known.id === target.id));
  const freshEmptyRef = useRef(freshEmpty);
  useLayoutEffect(() => { freshEmptyRef.current = freshEmpty; }, [freshEmpty]);
  // Clients removed on purpose; a screen whose client is in here draws nothing while it leaves. Forgotten once the
  // editor has moved on, so an address that comes back (the browser's Forward) is an unknown client again.
  const dropped = useRef(new Set<string>());
  const shownId = target.kind === 'one' ? target.id : null;
  useEffect(() => {
    for (const id of [...dropped.current]) if (id !== shownId) dropped.current.delete(id);
  }, [shownId]);
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

  const discardQuestion = useCallback(() => confirm({
    title: t('calc.youHaveUnsavedChanges'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  const askDiscardNewClient = useCallback(() => confirm({
    title: t('calc.discardThisNewClient'),
    okLabel: t('ui.discard'),
    cancelLabel: t('common.cancel'),
    danger: true,
  }), [confirm, t]);

  // Set while the editor moves between its own screens by itself (Save opening the client to fix): the client
  // being left must not ask «discard this new client?» of a move it did not make.
  const quiet = useRef(false);
  const quietly = useCallback((move: () => void) => {
    quiet.current = true;
    try {
      move();
    } finally {
      quiet.current = false;
    }
  }, []);

  // ── Leaving ───────────────────────────────────────────────────────────────────────────────
  // ⚠️ A ROUTER SUPPORTS ONE BLOCKER, so this one asks both questions. Out of the editor altogether with unsaved
  // changes: «leave without saving?». Between its own addresses (the browser's Back from a new, empty client):
  // «discard this new client?». A move to the editor's own other screen with anything else asks nothing.
  //
  // ⚠️ WHILE THE SAVE IS IN THE AIR A WAY OUT IS REFUSED WITHOUT A QUESTION: the edits are not being lost (they are
  // on their way), so «unsaved changes will be lost?» would be a false alarm; and leaving now would hide the
  // outcome (a refusal is said on THIS screen). The person stays; the save settles; they leave again if they still want.
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    if (leavingClean.current) return false;
    if (!inClientsEditor(nextLocation.pathname)) return dirtyRef.current || sending.current;
    return !quiet.current && freshEmptyRef.current && nextLocation.pathname !== currentLocation.pathname;
  }, []);
  const blocker = useBlocker(shouldBlock);
  const latestBlocker = useRef(blocker);
  useEffect(() => {
    latestBlocker.current = blocker;
    // ⚠️ THE QUESTION STAYS «BEING ASKED» UNTIL THE ROUTER HAS LEFT ITS 'blocked' STATE, not until the answer: the
    // router publishes its state at a lower priority than the edit made on the way out (dropping a new client), so
    // a render in between still sees the old block and would ask the same question again.
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
    const leavingEditor = !inClientsEditor(blocker.location.pathname);
    void (async () => {
      try {
        const discard = await (leavingEditor ? discardQuestion() : askDiscardNewClient());
        // The screen went away while the question was open: the router has dropped its blocker.
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) {
          if (!leavingEditor) removeClient(target.kind === 'one' ? target.id : '');
          current.proceed();
        } else {
          current.reset();
        }
      } catch (error) {
        askingLeave.current = false;
        throw error;
      }
    })();
  });

  // The list's Back asks for itself BEFORE it navigates: its navigate(-1) is a POP, and the router's blocker fails
  // silently on a POP to an entry it did not create (a page opened by its address).
  const leaveEditor = useCallback(async () => {
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
    leaveToHub();
  }, [discardQuestion, leaveToHub]);

  function removeClient(clientId: string) {
    dropped.current.add(clientId);
    freshEmptyRef.current = false;
    setClients(known => known.filter(client => client.id !== clientId));
    setFreshId(known => (known === clientId ? null : known));
  }

  function open(clientId: string) {
    if (target.kind === 'one' && target.id === clientId) return;
    quietly(() => {
      void navigate(clientPath(clientId), {
        replace: target.kind === 'one',
        state: target.kind === 'one' ? state : FROM_PARENT,
      });
    });
  }

  async function save() {
    if (busy.current || askingLeave.current) return;
    busy.current = true;
    setSaving(true);
    try {
      // Required first: the first client or product with no name is opened, its blank fields are marked, and the
      // sentence is said. The focus moves to the first marked field once the sentence has been read.
      const invalid = firstInvalid(clients);
      if (invalid !== null) {
        setShowErrors(true);
        open(invalid.clientId);
        await alert({ message: t('calc.pleaseGiveEveryClient'), okLabel: t('common.ok') });
        if (mounted.current) setCheckTick(tick => tick + 1);
        return;
      }
      const ok = await confirm({
        title: t('calc.saveTheseChanges'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      const settled = settleClients(clients, recipes);
      // The latest configuration, with only the address book written over it: another phone's change to any other
      // part must not be undone by this save.
      const latest = cloneConfig(store.getSnapshot().config);
      sending.current = true;
      let stored: boolean;
      try {
        stored = await saveConfig({ ...latest, clients: settled });
      } finally {
        sending.current = false;
      }
      if (!stored || !mounted.current) return;
      // Saved (or kept on this phone, and said so). A paused product has no row, so its typed quantity would
      // become unreachable and reappear inside a real dough the day it is switched back on.
      for (const key of pausedQuantityKeys(settled)) tabState.remove(key);
      dirtyRef.current = false;
      setOpening(settled);
      setClients(settled);
      setShowErrors(false);
      setFreshId(null);
      // P20: after a successful save, back to the list.
      if (target.kind === 'one') leaveToList();
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  const value: ClientsEditorState = {
    clients,
    recipes,
    dirty,
    saving,
    showErrors,
    checkTick,
    freshId,
    rename: (clientId, name) => { setClients(known => patchClient(known, clientId, { name })); },
    patchProduct: (clientId, productId, patch) => { setClients(known => patchProduct(known, clientId, productId, patch)); },
    addProduct: clientId => {
      const product = newProduct(recipes);
      setClients(known => known.map(client => (client.id === clientId
        ? { ...client, products: [...(client.products ?? []), product] }
        : client)));
      return product.id;
    },
    removeProduct: (clientId, productId) => {
      setClients(known => known.map(client => (client.id === clientId
        ? { ...client, products: (client.products ?? []).filter(product => product.id !== productId) }
        : client)));
    },
    removeClient,
    addClient: () => {
      const client = newClient();
      setClients(known => [...known, client]);
      setFreshId(client.id);
      return client.id;
    },
    reorder: (moved, targetId, position) => { setClients(known => moveClients(known, moved, targetId, position)); },
    keep: () => {
      freshEmptyRef.current = false;
      setFreshId(null);
    },
    save,
    leaveEditor,
    leaveToList,
    quietly,
    askDiscardNewClient,
    wasDropped: clientId => dropped.current.has(clientId),
    confirm: (options: ConfirmOptions) => confirm(options),
  };

  return (
    <ClientsEditorContext.Provider value={value}>
      {target.kind === 'one' ? <ClientScreen key={target.id} clientId={target.id} /> : <ClientList />}
      {confirmDialog}
      {alertDialog}
      {saveDialog}
    </ClientsEditorContext.Provider>
  );
}
