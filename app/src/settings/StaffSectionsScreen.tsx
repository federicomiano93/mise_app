import { useEffect, useId, useRef, useState } from 'react';
import { HIDDEN_FIELD, SHOWN_FIELD, STAFF_CARDS, isHiddenForStaff } from '@mise/shared/home-cards';
import type { CardId, StaffCard } from '@mise/shared/home-cards';
import { isSectionAllowed } from '@mise/shared/sections';
import { useT } from '../i18n/useT';
import type { MessageKey } from '../i18n/en';
import type { DocData } from '../session/backend';
import { useSession } from '../session/SessionContext';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useAlert } from '../ui/useAlert';
import type { ConfirmOptions } from '../ui/useConfirm';
import { useConfirm } from '../ui/useConfirm';
import { SettingsSubScreen } from './SettingsSubScreen';
import { useSettingsSource } from './useSettingsSource';
import styles from './StaffSectionsScreen.module.css';

// What each card is called in Mise 2: the label of the section the person is sent to (the current app's cards had names of their own).
const NAME: Readonly<Record<CardId, MessageKey>> = {
  calculator: 'section.calculator',
  catalogue: 'section.recipes',
  orders: 'section.orders',
  suppliers: 'section.suppliers',
  pastries: 'section.pastries',
  foodcost: 'section.foodcost',
  inventory: 'section.stocktake',
};

// The venue document with one card changed, for the rare save that succeeded while the server could not be read straight after. Money
// cards are stored the other way round: SHOWN, not hidden (functions/onboarding.js setStaffCard).
function withCard(venue: DocData | null, card: StaffCard, hidden: boolean): DocData {
  const field = card.optIn ? SHOWN_FIELD : HIDDEN_FIELD;
  const current = venue?.[field];
  const map = current && typeof current === 'object' && !Array.isArray(current) ? current as Record<string, unknown> : {};
  return { ...venue, [field]: { ...map, [card.id]: card.optIn ? !hidden : hidden } };
}

// «Sections for employees» (owner, manager and head chef — SettingsSection keeps everybody else out; the Cloud Function refuses them
// too): which sections the venue's ordinary employees see. A port of the SWITCHES of js/staff/home-cards-screen.js; the order of the
// sections is fixed in Mise 2 and is not here (docs/parity/home.md, decision D1).
//
// ⚠️⚠️ IT SAYS, EVERY TIME, THAT THE PERSON LOOKING STILL SEES EVERYTHING. A manager who hides Pastries and goes back to an app that still
// shows Pastries would reasonably conclude the switch is broken. The sentence is beside the switches, not in a help page.
//
// ⚠️ WHAT ASKS FIRST (the owner, 13 Sep 2026): hiding ANY section, because hiding also silences its notifications for employees; and
// SHOWING a money section (Food cost, Stocktake), because that gives employees access to the accounts. Showing an everyday section back
// saves at once.
//
// ⚠️ THE SWITCH SHOWS THE NEW STATE ONLY AFTER THE SERVER AGREED. It is a controlled switch whose state is the venue document: a tap
// that is refused changes nothing, and a successful one replaces the document by the one the server just answered with. No venue fact is
// kept in a module variable (the current app's `override` was one, and outlived the screen): the state lives and dies with the screen,
// and reopening it reads the server again.
export function StaffSectionsScreen() {
  const { t } = useT();
  const { location } = useSession();
  const source = useSettingsSource();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const [venue, setVenue] = useState<DocData | null>(location);
  const [saving, setSaving] = useState(false);
  // True once any save has begun: a slower first read must not put an older document over a newer answer.
  const touched = useRef(false);
  const rows = useRef(new Map<CardId, HTMLElement>());
  const refocus = useRef<CardId | null>(null);

  // The venue's own document is read once when the venue opens (the session), so what it holds may be old: the server is asked, and its
  // answer replaces it if nothing has been saved meanwhile. Offline, the session's copy stands.
  useEffect(() => {
    let alive = true;
    source.readVenueFromServer().then(fresh => {
      if (alive && !touched.current && fresh) setVenue(fresh);
    }, () => undefined);
    return () => { alive = false; };
  }, [source]);

  // ⚠️ THE SWITCH THAT WAS PRESSED KEEPS THE FOCUS. Every switch is disabled while a save is in the air, and a disabled control loses
  // the focus; without putting it back, somebody on a keyboard or a screen reader is thrown to the top of the page after every switch.
  useEffect(() => {
    if (saving || refocus.current === null) return;
    rows.current.get(refocus.current)?.querySelector('input')?.focus();
    refocus.current = null;
  }, [saving]);

  // ⚠️ EVERY SECTION THIS VENUE HAS — the money ones included — and none it does not. A switch for a part of the app the venue does not use
  // would promise something nobody can ever be shown.
  const cards = STAFF_CARDS.filter(card => isSectionAllowed(venue, card.section));

  function question(card: StaffCard, hide: boolean): ConfirmOptions | null {
    const section = t(NAME[card.id]);
    if (hide) {
      const lines = [t('staffSections.hide.body')];
      if (card.id === 'catalogue') lines.push(t('staffSections.catalogue.body'));
      if (card.employeePush) lines.push(t('staffSections.hide.push'));
      return {
        title: t('staffSections.hide.title', { section }),
        message: lines,
        okLabel: t('staffSections.hide.ok'),
        cancelLabel: t('common.cancel'),
        danger: true,
      };
    }
    if (card.optIn) {
      return {
        title: t('staffSections.show.title', { section }),
        message: card.id === 'foodcost' ? t('staffSections.show.foodcost') : t('staffSections.show.inventory'),
        okLabel: t('staffSections.show.ok'),
        cancelLabel: t('common.cancel'),
      };
    }
    return null;
  }

  async function toggle(card: StaffCard, hide: boolean): Promise<void> {
    refocus.current = card.id;
    const ask = question(card, hide);
    if (ask && !(await confirm(ask))) return;
    touched.current = true;
    setSaving(true);
    try {
      const fresh = await source.setStaffCard(card.id, hide);
      // Only after the server has agreed. Setting it first would leave the screen showing a change the venue never got.
      setVenue(previous => fresh ?? withCard(previous, card, hide));
    } catch (err) {
      console.error('Changing a section for employees failed:', err);
      await alert({ message: t('staffSections.err.save'), okLabel: t('common.ok') });
    }
    setSaving(false);
  }

  return (
    <SettingsSubScreen door="sections" title={t('staffSections.title')}>
      <p className={styles.text}>{t('staffSections.intro')}</p>
      {cards.length === 0 ? (
        <p className={styles.text}>{t('staffSections.none')}</p>
      ) : (
        <ul className={styles.list}>
          {cards.map(card => (
            <SectionRow
              key={card.id}
              card={card}
              shown={!isHiddenForStaff(venue, card.id)}
              disabled={saving}
              onChange={hide => { void toggle(card, hide); }}
              rowRef={node => {
                if (node) rows.current.set(card.id, node);
                else rows.current.delete(card.id);
              }}
            />
          ))}
        </ul>
      )}
      <p className={styles.note}>{t('staffSections.managersSeeAll')}</p>
      <p className={styles.note}>{t('staffSections.applies')}</p>
      {/* There from the start, so what it says is announced. */}
      <p role="status" className={styles.status}>{saving ? t('staffSections.saving') : ''}</p>
      {confirmDialog}
      {alertDialog}
    </SettingsSubScreen>
  );
}

type RowProps = {
  card: StaffCard;
  shown: boolean;
  disabled: boolean;
  // `hide` is true when the person is switching the section OFF.
  onChange: (hide: boolean) => void;
  rowRef: (node: HTMLLIElement | null) => void;
};

function SectionRow({ card, shown, disabled, onChange, rowRef }: RowProps) {
  const { t } = useT();
  const nameId = useId();
  const stateId = useId();
  return (
    <li ref={rowRef} className={styles.row}>
      <span id={nameId} className={styles.name}>{t(NAME[card.id])}</span>
      {/* ⚠️ A SWITCH, READ AS ONE: the section AND its state, so a screen reader hears «Pastries, Visible, switch, on» rather than a bare
          «Visible». The state is in words beside the switch as well: colour and position are never the only signal. */}
      <span id={stateId} className={styles.state}>{shown ? t('staffSections.shown') : t('staffSections.hidden')}</span>
      <SettingSwitch
        selected={shown}
        isDisabled={disabled}
        labelledBy={`${nameId} ${stateId}`}
        onChange={next => { onChange(!next); }}
      />
    </li>
  );
}
