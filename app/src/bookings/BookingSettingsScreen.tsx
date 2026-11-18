import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Navigate, useBlocker, useLocation, useNavigate } from 'react-router';
import type { BlockerFunction } from 'react-router';
import { itemsToStore, readPriceList, sharedNames } from '@mise/shared/price-list';
import type { PriceList } from '@mise/shared/price-list';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { venueHasSection } from '../session/visibility';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import {
  HALF_HOURS, MAX_SLOT_LIMIT, SLOT_MINUTES, generateSlots, sameSettings,
} from './bookingSettings';
import type { BookingModes, BookingSettings, SlotMinutes } from './bookingSettings';
import { cameFromList } from './bookingsNav';
import { BOOKINGS_PATH } from './bookingsPath';
import { useHelp } from './SettingHelp';
import { ProductsGroup } from './SettingsProductsGroup';
import type { ProductsData } from './SettingsProductsGroup';
import {
  changesSincePublish, choicesFrom, itemsToPublish, productRows, publishDiffers, sameChoices,
} from './settingsProducts';
import type { ProductChoice, ProductDoc } from './settingsProducts';
import styles from './BookingSettingsScreen.module.css';

// «Impostazioni prenotazioni» (bookings settings, 18 Nov 2026, the owner's layout drawn on his tablet): how the venue takes
// bookings — the phone, the WhatsApp reminder, pickup and/or delivery, the time slots, and the products the counter books (the
// price list that used to be published from Food cost). One Save writes the settings (config/bookings) and, when the products
// changed, publishes the list (price-list/bookings).
//
// ⚠️ ONLY WHOEVER MANAGES BOOKINGS (the session's canManage: the owner, a manager, the sales side's owner — the rules'
// managesBookings) reaches it; anybody else who types the address is sent to the list.
// ⚠️ ONLY THE SERVER'S ANSWER OPENS THE FORM: it is copied ONCE, and a copy taken from this device's own database — empty on a
// phone that never read it, offline — would offer the defaults and an empty product list, and a Save would write them over the
// real ones. So it waits for the server, and without it says so.
// ⚠️ P20: a working copy; nothing is written until Save is pressed and confirmed; leaving with changes asks first.

type Loaded<T> = { readonly status: 'waiting' } | { readonly status: 'ready'; readonly value: T } | { readonly status: 'failed' };

export function BookingSettingsScreen() {
  const { t } = useT();
  const { canManage, role, location, locationId } = useSession();
  const services = useDataServices();
  // The products can be changed only by whoever runs Food cost (the rules: cardAccess 'manage' publishes the list).
  const managesFoodcost = canManage && role !== 'owner-kitchen' && venueHasSection(location, 'foodcost');
  const [settings, setSettings] = useState<Loaded<BookingSettings>>({ status: 'waiting' });
  const [products, setProducts] = useState<Loaded<readonly ProductDoc[]>>({ status: 'waiting' });
  const [recipes, setRecipes] = useState<ReadonlyMap<string, unknown>>(new Map());
  const [published, setPublished] = useState<Loaded<PriceList>>({ status: 'waiting' });

  useEffect(() => {
    if (!canManage || !locationId) return undefined;
    return services.bookings(locationId).watchSettings(
      (value, meta) => { if (meta.fromServer) setSettings(current => (current.status === 'ready' ? current : { status: 'ready', value })); },
      () => { setSettings(current => (current.status === 'ready' ? current : { status: 'failed' })); },
    );
  }, [canManage, locationId, services]);

  // The products' data, live while the screen is open (P14): Food cost's products and recipes and the published list for whoever
  // runs Food cost; the published list alone (read only) for anybody else.
  useEffect(() => {
    if (!canManage || !locationId) return undefined;
    if (!managesFoodcost) {
      return services.bookings(locationId).watchPriceList(
        list => { setPublished({ status: 'ready', value: list }); },
        () => { setPublished({ status: 'failed' }); },
      );
    }
    const foodcost = services.foodcost(locationId);
    const stops = [
      foodcost.watchProducts(
        (list, meta) => { if (meta.fromServer) setProducts({ status: 'ready', value: list }); },
        () => { setProducts(current => (current.status === 'ready' ? current : { status: 'failed' })); },
      ),
      // Quiet: a venue may not use the recipe book, and then nothing is pre-filled.
      foodcost.watchRecipes(list => { setRecipes(new Map(list.map(recipe => [recipe.id, recipe]))); }, () => undefined),
      foodcost.watchPriceList(
        (data, meta) => { if (meta.fromServer) setPublished(current => (current.status === 'ready' ? current : { status: 'ready', value: readPriceList(data) })); },
        () => { setPublished(current => (current.status === 'ready' ? current : { status: 'failed' })); },
      ),
    ];
    return () => { for (const stop of stops) stop(); };
  }, [canManage, managesFoodcost, locationId, services]);

  if (!canManage) return <Navigate to={BOOKINGS_PATH} replace state={KEEP_FOCUS} />;
  const productsSettled = !managesFoodcost || products.status !== 'waiting';
  if (settings.status !== 'ready' || published.status === 'waiting' || !productsSettled) {
    const failed = settings.status === 'failed';
    return (
      <section className={styles.screen} aria-busy={!failed}>
        <p className={styles.loading}>{failed ? t('bookings.settings.readFailed') : t('bookings.settings.waiting')}</p>
      </section>
    );
  }
  const data: ProductsData = !managesFoodcost
    ? { kind: 'readOnly', published: published.status === 'ready' ? published.value : null }
    : products.status === 'ready' && published.status === 'ready'
      ? { kind: 'editable', products: products.value, recipes, published: published.value }
      : { kind: 'unavailable' };
  return <SettingsForm initial={settings.value} data={data} />;
}

function SettingsForm({ initial, data }: { initial: BookingSettings; data: ProductsData }) {
  const { t, locale } = useT();
  const { locationId } = useSession();
  const services = useDataServices();
  const navigate = useNavigate();
  const say = useStatusMessage();
  const [confirm, confirmDialog] = useConfirm();
  const { state } = useLocation();
  const ids = useId();
  const title = useRef<HTMLHeadingElement>(null);

  // The working copy (P20).
  const [draft, setDraft] = useState<BookingSettings>(initial);
  const [limitText, setLimitText] = useState(initial.slotLimit === null ? '' : String(initial.slotLimit));
  const [problem, setProblem] = useState<'slotOrder' | 'slotLimit' | null>(null);
  const editable = data.kind === 'editable';
  const [startChoices] = useState<ReadonlyMap<string, ProductChoice>>(() => (data.kind === 'editable' ? choicesFrom(data.published) : new Map()));
  const [choices, setChoices] = useState<ReadonlyMap<string, ProductChoice>>(startChoices);

  // ⚠️ The recipes may arrive after the form opened: the rows (and so the pre-fill) follow them, the ticks do not move.
  const recipes = data.kind === 'editable' ? data.recipes : null;
  const products = data.kind === 'editable' ? data.products : null;
  const { rows, unpriced } = useMemo(
    () => (products === null ? { rows: [], unpriced: [] } : productRows(products, id => recipes?.get(id), locale)),
    [products, recipes, locale],
  );
  const toPublish = useMemo(() => itemsToPublish(rows, choices), [rows, choices]);
  const since = data.kind === 'editable' ? changesSincePublish(rows, data.published) : { stale: false, gone: 0 };

  const limit = parseLimit(limitText);
  const effective: BookingSettings = { ...draft, slotLimit: typeof limit === 'number' ? limit : null };
  const dirty = !sameSettings(initial, effective) || (typeof limit !== 'number' && limit !== null) || !sameChoices(startChoices, choices);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const leaving = useRef(false);

  useEffect(() => (dirty ? markBusy() : undefined), [dirty]);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (cameFromList(state)) title.current?.focus();
  }, []);

  // ── Leaving: every way out goes through the router's blocker ──
  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) => !leaving.current && dirtyRef.current && currentLocation.pathname !== nextLocation.pathname,
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
        const discard = await confirm({
          title: t('bookings.discard.title'),
          message: t('bookings.settings.discardBody'),
          okLabel: t('ui.discard'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!mounted.current) return;
        const current = latestBlocker.current;
        if (current.state !== 'blocked') return;
        if (discard) current.proceed();
        else current.reset();
      } finally {
        askingLeave.current = false;
      }
    })();
  }, [blocker, confirm, t]);

  const back = () => {
    if (cameFromList(state)) void navigate(-1);
    else void navigate(BOOKINGS_PATH, { replace: true });
  };

  const update = (patch: Partial<BookingSettings>) => { setDraft(current => ({ ...current, ...patch })); };

  // ── Saving ──
  const asking = useRef(false);
  async function save() {
    if (asking.current || askingLeave.current) return;
    if (draft.slotFirst !== null && (draft.slotLast === null || draft.slotLast <= draft.slotFirst)) {
      setProblem('slotOrder');
      document.getElementById(`${ids}-slotLast`)?.focus();
      return;
    }
    if (limit === 'invalid') {
      setProblem('slotLimit');
      document.getElementById(`${ids}-slotLimit`)?.focus();
      return;
    }
    setProblem(null);
    const publish = editable && publishDiffers(toPublish, data.published);
    const clashes = publish ? sharedNames(toPublish) : [];
    if (clashes.length > 0) {
      say(t('bookings.settings.clash', { names: clashes.join(', ') }), 5000);
      return;
    }
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('bookings.settings.saveQ'),
        message: publish ? t('bookings.settings.saveBodyProducts') : t('bookings.settings.saveBody'),
        okLabel: t('ui.save'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current || !locationId) return;
    } finally {
      asking.current = false;
    }
    // Never awaited (local-first): Firestore shows the new settings at once and sends them when it can; only a refusal is said.
    if (!sameSettings(initial, effective)) {
      services.bookings(locationId).saveSettings(effective).catch((err: unknown) => {
        console.error('Saving the bookings settings failed:', err);
        say(t('bookings.settings.notSaved'), 5000);
      });
    }
    if (publish) {
      services.foodcost(locationId).publishPriceList(itemsToStore(toPublish)).catch((err: unknown) => {
        console.error('Publishing the price list failed:', err);
        say(t('bookings.settings.notPublished'), 5000);
      });
    }
    leaving.current = true;
    say(t('bookings.settings.saved'));
    back();
  }

  const slots = draft.slotFirst !== null && draft.slotLast !== null ? generateSlots(draft.slotFirst, draft.slotLast, draft.slotMinutes) : [];
  const lastChoices = HALF_HOURS.filter(time => draft.slotFirst === null || time > draft.slotFirst);
  const pickFirst = (value: string) => {
    if (value === '') {
      update({ slotFirst: null, slotLast: null });
      return;
    }
    // A first slot after the last moves the last four hours on (never past the day's last half hour).
    const last = draft.slotLast !== null && draft.slotLast > value
      ? draft.slotLast
      : HALF_HOURS[Math.min(HALF_HOURS.indexOf(value) + 8, HALF_HOURS.length - 1)] ?? null;
    update({ slotFirst: value, slotLast: last !== null && last > value ? last : null });
  };

  return (
    <section className={styles.screen} aria-labelledby={`${ids}-title`}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={back}
        title={t('bookings.settings.title')}
        titleId={`${ids}-title`}
        titleRef={title}
        sub={<span className={styles.dirty} data-dirty={dirty ? 'true' : undefined} aria-live="polite">{dirty ? t('bookings.settings.unsaved') : ''}</span>}
        action={<Button variant="primary" className={styles.save} onPress={() => { void save(); }}>{t('ui.save')}</Button>}
      />
      <div className={styles.body}>
        <Group title={t('bookings.settings.customer')}>
          <SwitchRow
            name={t('bookings.settings.askPhone')}
            help={t('bookings.settings.askPhoneHelp')}
            selected={draft.askPhone}
            onChange={value => { update({ askPhone: value }); }}
          />
          {/* ⚠️ THE REMINDER NEEDS THE PHONE: with the phone off it shows off and cannot be switched; its «?» says why. */}
          <SwitchRow
            name={t('bookings.settings.reminder')}
            help={draft.askPhone ? t('bookings.settings.reminderHelp') : `${t('bookings.settings.reminderHelp')} ${t('bookings.settings.reminderNeedsPhone')}`}
            selected={draft.askPhone && draft.whatsappReminder}
            disabled={!draft.askPhone}
            onChange={value => { update({ whatsappReminder: value }); }}
          />
        </Group>

        <Group title={t('bookings.settings.modesGroup')}>
          <Row name={t('bookings.settings.modes')} help={t('bookings.settings.modesHelp')} controlId={`${ids}-modes`}>
            <select
              id={`${ids}-modes`}
              className={styles.select}
              value={draft.modes}
              onChange={event => { update({ modes: event.currentTarget.value as BookingModes }); }}
            >
              <option value="both">{t('bookings.settings.modes.both')}</option>
              <option value="pickup">{t('bookings.settings.modes.pickup')}</option>
              <option value="delivery">{t('bookings.settings.modes.delivery')}</option>
            </select>
          </Row>
        </Group>

        <Group title={t('bookings.settings.slotsGroup')}>
          <Row name={t('bookings.settings.slotFirst')} controlId={`${ids}-slotFirst`}>
            <select
              id={`${ids}-slotFirst`}
              className={styles.select}
              value={draft.slotFirst ?? ''}
              onChange={event => { pickFirst(event.currentTarget.value); }}
            >
              <option value="">{t('bookings.settings.slotNone')}</option>
              {HALF_HOURS.slice(0, -1).map(time => <option key={time} value={time}>{time}</option>)}
            </select>
          </Row>
          <Row
            name={t('bookings.settings.slotLast')}
            controlId={`${ids}-slotLast`}
            error={problem === 'slotOrder' ? t('bookings.settings.slotOrder') : null}
          >
            <select
              id={`${ids}-slotLast`}
              className={styles.select}
              value={draft.slotLast ?? ''}
              disabled={draft.slotFirst === null}
              aria-invalid={problem === 'slotOrder' ? true : undefined}
              aria-describedby={problem === 'slotOrder' ? `${ids}-slotLast-error` : undefined}
              onChange={event => { update({ slotLast: event.currentTarget.value === '' ? null : event.currentTarget.value }); }}
            >
              {draft.slotLast === null ? <option value="">—</option> : null}
              {lastChoices.map(time => <option key={time} value={time}>{time}</option>)}
            </select>
          </Row>
          <Row name={t('bookings.settings.slotMinutes')} controlId={`${ids}-slotMinutes`}>
            <select
              id={`${ids}-slotMinutes`}
              className={styles.select}
              value={String(draft.slotMinutes)}
              onChange={event => { update({ slotMinutes: Number(event.currentTarget.value) as SlotMinutes }); }}
            >
              {SLOT_MINUTES.map(minutes => (
                <option key={minutes} value={String(minutes)}>
                  {t(minutes === 30 ? 'bookings.settings.minutes30' : minutes === 60 ? 'bookings.settings.minutes60' : 'bookings.settings.minutes120')}
                </option>
              ))}
            </select>
          </Row>
          <Row
            name={t('bookings.settings.slotLimit')}
            help={t('bookings.settings.slotLimitHelp')}
            controlId={`${ids}-slotLimit`}
            error={problem === 'slotLimit' ? t('bookings.settings.slotLimitBad') : null}
          >
            <input
              id={`${ids}-slotLimit`}
              className={styles.input}
              value={limitText}
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              placeholder={t('bookings.settings.slotLimitPlaceholder')}
              aria-invalid={problem === 'slotLimit' ? true : undefined}
              aria-describedby={problem === 'slotLimit' ? `${ids}-slotLimit-error` : undefined}
              onChange={event => { setLimitText(event.currentTarget.value); }}
            />
          </Row>
          <div className={styles.slots}>
            <p id={`${ids}-slots`} className={styles.caption}>{t('bookings.settings.slotsCaption')}</p>
            {slots.length === 0 ? (
              <p className={styles.muted}>{t('bookings.settings.slotsNone')}</p>
            ) : (
              <ul className={styles.chips} aria-labelledby={`${ids}-slots`}>
                {slots.map(slot => <li key={slot.start} className={styles.chip}>{`${slot.start}–${slot.end}`}</li>)}
              </ul>
            )}
          </div>
        </Group>

        <Group title={t('bookings.settings.productsGroup')}>
          <SwitchRow
            name={t('bookings.settings.perPieceSlips')}
            help={t('bookings.settings.perPieceSlipsHelp')}
            selected={draft.perPieceSlips}
            onChange={value => { update({ perPieceSlips: value }); }}
          />
          <ProductsGroup
            data={data}
            rows={rows}
            unpriced={unpriced}
            choices={choices}
            onChoices={setChoices}
            perPieceShown={draft.perPieceSlips}
            stale={since.stale}
            gone={since.gone}
            extras={draft.extras}
            onExtras={extras => { update({ extras }); }}
          />
        </Group>
      </div>
      {confirmDialog}
    </section>
  );
}

// The limit box: '' is no limit, a whole number 1–999 a limit, anything else is said on Save.
function parseLimit(text: string): number | null | 'invalid' {
  const clean = text.trim();
  if (clean === '') return null;
  if (!/^[0-9]+$/.test(clean)) return 'invalid';
  const n = Number(clean);
  return n >= 1 && n <= MAX_SLOT_LIMIT ? n : 'invalid';
}

// A group: its title in the small uppercase legend style, a thin line above every group but the first.
function Group({ title, children }: { title: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section className={styles.group} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.legend}>{title}</h3>
      {children}
    </section>
  );
}

// One setting: its name (17px semibold, all the same size) with its «?», the control at the right edge, and the help box under it.
function Row({ name, help, controlId, error = null, children }: {
  name: string; help?: string; controlId: string; error?: string | null; children: ReactNode;
}) {
  const { toggle, box } = useHelp(name, help);
  return (
    <div className={styles.rowWrap}>
      <div className={styles.row}>
        <span className={styles.nameBox}>
          <label className={styles.name} htmlFor={controlId}>{name}</label>
          {toggle}
        </span>
        <span className={styles.control}>{children}</span>
      </div>
      {error !== null ? <p id={`${controlId}-error`} className={styles.error}>{error}</p> : null}
      {box}
    </div>
  );
}

function SwitchRow({ name, help, selected, disabled = false, onChange }: {
  name: string; help: string; selected: boolean; disabled?: boolean; onChange: (value: boolean) => void;
}) {
  const nameId = useId();
  const { toggle, box } = useHelp(name, help);
  return (
    <div className={styles.rowWrap}>
      <div className={styles.row}>
        <span className={styles.nameBox}>
          <span id={nameId} className={styles.name}>{name}</span>
          {toggle}
        </span>
        <span className={styles.control}>
          <SettingSwitch selected={selected} onChange={onChange} labelledBy={nameId} isDisabled={disabled} />
        </span>
      </div>
      {box}
    </div>
  );
}
