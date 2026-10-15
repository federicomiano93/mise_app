import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import {
  DATE_KINDS, DPI_CHOICES, LABEL_SIZES, PRINTER_LANGUAGES, normalizeLabelProfile,
} from '@mise/shared/label-template-model';
import type { DateKind, PrinterLanguage } from '@mise/shared/label-template-model';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { FormBar } from '../ui/FormBar';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useStatusMessage } from '../ui/StatusMessage';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { SegmentedChoice } from './SegmentedChoice';
import styles from './LabelSettings.module.css';

// How long the two boxes of a custom size wait, after one is left, before the size is written: the next box left
// in that time makes it ONE write (the current app's number).
export const SIZE_SETTLE_MS = 350;

// What each choice SAYS, as KEYS resolved while drawing (the language arrives after the module is read).
const PRINTER_TEXT: Readonly<Record<PrinterLanguage, MessageKey>> = {
  os: 'label.settings.printer.os',
  zpl: 'label.settings.printer.zpl',
};
const DATE_KIND_TEXT: Readonly<Record<DateKind, MessageKey>> = {
  useBy: 'label.settings.dateKind.useBy',
  bestBefore: 'label.settings.dateKind.bestBefore',
};

type Patch = Readonly<Record<string, unknown>>;

type Props = {
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// The label Settings: the paper, the printer and what else goes on a printed label (a port of the label half of
// js/catalogue/catalogue-settings.js, for whoever runs the place — the section decides who). Every control SAVES ON
// THE TAP, no Save button: the screen draws what the store holds, and the store changes at once and puts a refused
// change back (recipesStore.saveLabelProfile), so the screen and the label screen always agree.
//
// ⚠️ THE CONTROLS WAIT FOR THE PAPER (`labelConfigKnown`): drawn before the answer, they would show the defaults, and
// a tap would write over a profile the phone has not seen.
export function LabelSettings({ titleRef, onBack }: Props) {
  const { t } = useT();
  const { labelConfigKnown } = useRecipes();
  const titleId = useId();
  return (
    <section className={styles.screen} aria-labelledby={titleId} aria-busy={labelConfigKnown ? undefined : true}>
      <FormBar backLabel={t('ui.back')} onBack={onBack} title={t('ui.settings')} titleId={titleId} titleRef={titleRef} />
      {labelConfigKnown ? <Controls /> : <p className={styles.loading}>{t('session.loading')}</p>}
    </section>
  );
}

function Controls() {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  const { labelConfig } = useRecipes();
  // ⚠️ DRAWN FROM THE NORMALISED PROFILE, the one place that decides what a missing or corrupt field means.
  const profile = normalizeLabelProfile(labelConfig);
  const [failed, setFailed] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ⚠️ A REFUSED SAVE IS SAID WHERE THE PERSON IS LOOKING: in this screen's own live region, which exists before it
  // speaks. A save made as the screen closes (a box still holding typing) is refused after the screen is gone, so
  // that one is said through the section's message instead.
  function save(patch: Patch): void {
    setFailed(false);
    store.saveLabelProfile(patch).catch(() => {
      if (mounted.current) setFailed(true);
      else say(t('label.settings.saveFailed'));
    });
  }

  const size = useCustomSize({ w: profile.widthMm, h: profile.heightMm }, save);
  const presetId = LABEL_SIZES.find(s => s.widthMm === profile.widthMm && s.heightMm === profile.heightMm)?.id ?? null;
  // ⚠️ A SIZE THAT MATCHES NO PRESET IS A CUSTOM SIZE, so the boxes open by themselves: otherwise nothing would be
  // chosen and nothing would say why.
  const isCustom = presetId === null || customOpen;
  const sizeChoices = [
    ...LABEL_SIZES.map(s => ({ value: s.id, text: `${s.widthMm} × ${s.heightMm}` })),
    { value: 'custom', text: t('label.settings.custom') },
  ];

  function chooseSize(value: string): void {
    if (value === 'custom') {
      setCustomOpen(true);
      return;
    }
    // A preset tapped while a custom size is waiting to be written: the preset is what the person meant.
    size.cancel();
    setCustomOpen(false);
    const preset = LABEL_SIZES.find(s => s.id === value);
    if (preset && (preset.widthMm !== profile.widthMm || preset.heightMm !== profile.heightMm)) {
      save({ widthMm: preset.widthMm, heightMm: preset.heightMm });
    }
  }

  // ⚠️ A BLOCK THE LABEL WOULD LEAVE OUT, SWITCHED ON WITH NOTHING BEHIND IT: the label leaves the line out —
  // correctly — but from here that looks like a setting that did not save, so the screen says so.
  const empty = (profile.showStorage && !profile.storageText)
    || (profile.showBusiness && !profile.businessName && !profile.businessAddress);

  return (
    <div className={styles.body}>
      <Card title={t('label.settings.title')}>
        <SegmentedChoice
          label={t('label.settings.size')}
          choices={sizeChoices}
          selected={isCustom ? 'custom' : presetId}
          onSelect={chooseSize}
        >
          {isCustom ? (
            <div className={styles.customRow}>
              <SizeBox label={t('label.settings.width')} value={size.width} onChange={size.setWidth} onLeave={size.leave} />
              <SizeBox label={t('label.settings.height')} value={size.height} onChange={size.setHeight} onLeave={size.leave} />
            </div>
          ) : null}
        </SegmentedChoice>

        <SegmentedChoice
          label={t('label.settings.printer')}
          choices={PRINTER_LANGUAGES.map(language => ({ value: language, text: t(PRINTER_TEXT[language]) }))}
          selected={profile.printerLanguage}
          onSelect={language => { save({ printerLanguage: language }); }}
          note={t('label.settings.printerNote')}
        />

        {/* ⚠️ THE RESOLUTION ONLY MATTERS TO A PRINTER DRIVEN IN ITS OWN LANGUAGE. Through the print dialog the driver
            owns it, and offering the choice there would invite somebody to set a number that changes nothing and then
            believe it did. */}
        {profile.printerLanguage === 'zpl' ? (
          <SegmentedChoice
            label={t('label.settings.dpi')}
            choices={DPI_CHOICES.map(dpi => ({ value: dpi, text: `${dpi} dpi` }))}
            selected={profile.dpi}
            onSelect={dpi => { save({ dpi }); }}
            note={t('label.settings.dpiNote')}
          />
        ) : null}

        <SwitchRow
          title={t('label.settings.showDate')}
          sub={t('label.settings.showDateNote')}
          selected={profile.showDate}
          onChange={on => { save({ showDate: on }); }}
        />

        {/* ⚠️⚠️ WHICH DATE IS THE ONE CHOICE HERE THAT CAN HARM SOMEBODY: «use by» is a safety statement, «best before» a
            quality one, and the note says so in words. Only with a date on the label. */}
        {profile.showDate ? (
          <SegmentedChoice
            label={t('label.settings.dateKind')}
            choices={DATE_KINDS.map(kind => ({ value: kind, text: t(DATE_KIND_TEXT[kind]) }))}
            selected={profile.dateKind}
            onSelect={kind => { save({ dateKind: kind }); }}
            note={t('label.settings.dateKindNote')}
          />
        ) : null}
      </Card>

      <Card title={t('label.settings.full')} intro={t('label.settings.fullNote')}>
        <SwitchRow
          title={t('label.settings.showWeight')}
          selected={profile.showWeight}
          onChange={on => { save({ showWeight: on }); }}
        />
        <SwitchRow
          title={t('label.settings.showStorage')}
          selected={profile.showStorage}
          onChange={on => { save({ showStorage: on }); }}
        />
        {profile.showStorage ? (
          <TextSetting
            label={t('label.settings.storageText')}
            placeholder={t('label.settings.storagePlaceholder')}
            saved={profile.storageText}
            onSave={text => { save({ storageText: text }); }}
          />
        ) : null}
        <SwitchRow
          title={t('label.settings.showBusiness')}
          selected={profile.showBusiness}
          onChange={on => { save({ showBusiness: on }); }}
        />
        {profile.showBusiness ? (
          <>
            <TextSetting
              label={t('label.settings.businessName')}
              saved={profile.businessName}
              onSave={text => { save({ businessName: text }); }}
            />
            <TextSetting
              label={t('label.settings.businessAddress')}
              saved={profile.businessAddress}
              onSave={text => { save({ businessAddress: text }); }}
            />
          </>
        ) : null}
        {profile.showBusiness || empty ? (
          <div className={styles.notes}>
            {profile.showBusiness ? <p className={styles.note}>{t('label.settings.businessNote')}</p> : null}
            {empty ? <p className={styles.hint}>{t('label.settings.emptyBlock')}</p> : null}
          </div>
        ) : null}
      </Card>

      <p className={styles.setup}>{t('label.settings.setup')}</p>
      <p role="status" className={failed ? styles.failed : styles.quiet}>{failed ? t('label.settings.saveFailed') : ''}</p>
    </div>
  );
}

function Card({ title, intro, children }: { title: string; intro?: string; children: ReactNode }) {
  const headId = useId();
  return (
    <section className={styles.card} aria-labelledby={headId}>
      <div className={styles.head}>
        <h3 id={headId} className={styles.headTitle}>{title}</h3>
        {intro === undefined ? null : <p className={styles.note}>{intro}</p>}
      </div>
      {children}
    </section>
  );
}

function SwitchRow({ title, sub, selected, onChange }: {
  title: string; sub?: string; selected: boolean; onChange: (selected: boolean) => void;
}) {
  const ids = useId();
  return (
    <div className={styles.row}>
      <span className={styles.text}>
        <span id={`${ids}-title`} className={styles.title}>{title}</span>
        {sub === undefined ? null : <span id={`${ids}-sub`} className={styles.sub}>{sub}</span>}
      </span>
      <SettingSwitch
        selected={selected}
        onChange={onChange}
        labelledBy={`${ids}-title`}
        describedBy={sub === undefined ? undefined : `${ids}-sub`}
      />
    </div>
  );
}

// ⚠️ A FREE-TYPED LINE IS SAVED WHEN THE BOX IS LEFT, never on every keystroke — a half-typed address must never reach
// a label — and only if it differs from what is saved, trimmed. WHILE THE BOX HAS TYPING IN IT it shows that typing:
// a snapshot arriving mid-word must not write .value under the caret (it jumps to the end). Without typing it shows
// what the store holds, so a refused save shows the value put back.
//
// ⚠️ LEAVING THE SCREEN WITH TYPING IN IT SAVES IT: the store's write outlives the screen, and a line that was typed
// and then lost to a tap on Back is a label that prints without it.
function TextSetting({ label, placeholder, saved, onSave }: {
  label: string; placeholder?: string; saved: string; onSave: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const latest = useRef({ draft, saved, onSave });
  useEffect(() => { latest.current = { draft, saved, onSave }; });

  const differs = draft !== null && draft.trim() !== saved;
  useEffect(() => (differs ? markBusy() : undefined), [differs]);

  useEffect(() => () => {
    const { draft: typed, saved: held, onSave: write } = latest.current;
    if (typed !== null && typed.trim() !== held) write(typed.trim());
  }, []);

  function commit(): void {
    if (draft === null) return;
    const text = draft.trim();
    // The ref first: a screen closed in the same breath must not save it a second time.
    latest.current = { ...latest.current, draft: null };
    setDraft(null);
    if (text !== saved) onSave(text);
  }

  return (
    <label className={styles.field}>
      <span className={styles.fieldName}>{label}</span>
      <input
        type="text"
        maxLength={200}
        autoComplete="off"
        className={styles.input}
        placeholder={placeholder}
        value={draft ?? saved}
        onChange={event => { setDraft(event.target.value); }}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') commit(); }}
      />
    </label>
  );
}

function SizeBox({ label, value, onChange, onLeave }: {
  label: string; value: string; onChange: (text: string) => void; onLeave: () => void;
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldName}>{label}</span>
      <span className={styles.fieldBox}>
        <input
          type="number"
          min={20}
          max={300}
          step={0.5}
          inputMode="decimal"
          className={styles.input}
          value={value}
          onChange={event => { onChange(event.target.value); }}
          onBlur={onLeave}
        />
        <span className={styles.unit} aria-hidden="true">mm</span>
      </span>
    </label>
  );
}

// A box's text → the millimetres it stands for, or NaN for an empty box or text that is no number.
function millimetres(text: string): number {
  return text.trim() === '' ? Number.NaN : Number(text);
}

// The two boxes of a custom size.
//
// ⚠️ ON LEAVING A BOX, NEVER PER KEYSTROKE: typing «102» would otherwise save 1, then 10, then 102 — three writes, and
// the first two are label sizes this venue never chose.
//
// ⚠️⚠️ AND THE TWO BOXES ARE ONE DECISION, SO THEY ARE ONE WRITE `{ widthMm, heightMm }`, written 350 ms after the
// last box was left: a width and a height written one after the other leave a moment where the store holds a size
// nobody asked for. A box that is empty or holds no number writes nothing (the box shows the saved size again).
//
// The state lives here, above the boxes, because the boxes come and go: a PRESET tapped while a size waits to be
// written cancels it (`cancel`), and the boxes closing must not write it after the preset.
function useCustomSize(saved: { w: number; h: number }, save: (patch: Patch) => void) {
  const [wDraft, setWDraft] = useState<string | null>(null);
  const [hDraft, setHDraft] = useState<string | null>(null);
  const [pending, setPendingState] = useState<{ w: number; h: number } | null>(null);
  const pendingRef = useRef<{ w: number; h: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef({ saved, wDraft, hDraft, save });
  useEffect(() => { latest.current = { saved, wDraft, hDraft, save }; });

  const setPending = (next: { w: number; h: number } | null) => {
    pendingRef.current = next;
    setPendingState(next);
  };
  const stopTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  // What the boxes show: the typing, else the size waiting to be written, else the saved one.
  const width = wDraft ?? String(pending?.w ?? saved.w);
  const height = hDraft ?? String(pending?.h ?? saved.h);

  function flush(): void {
    stopTimer();
    const next = pendingRef.current;
    if (next === null) return;
    setPending(null);
    const { saved: held, save: write } = latest.current;
    if (next.w !== held.w || next.h !== held.h) write({ widthMm: next.w, heightMm: next.h });
  }

  function leave(): void {
    const w = millimetres(width);
    const h = millimetres(height);
    setWDraft(null);
    setHDraft(null);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return;
    if (pendingRef.current === null && w === saved.w && h === saved.h) return;
    stopTimer();
    setPending({ w, h });
    timer.current = setTimeout(flush, SIZE_SETTLE_MS);
  }

  function cancel(): void {
    stopTimer();
    setPending(null);
    setWDraft(null);
    setHDraft(null);
  }

  // Typing that is not the saved size, or a size not yet written: a reload the app starts by itself waits.
  const differs = pending !== null
    || (wDraft !== null && millimetres(wDraft) !== saved.w)
    || (hDraft !== null && millimetres(hDraft) !== saved.h);
  useEffect(() => (differs ? markBusy() : undefined), [differs]);

  // ⚠️ LEAVING THE SCREEN: a size waiting its 350 ms is written at once, and so is one still being typed.
  useEffect(() => () => {
    stopTimer();
    const { saved: held, wDraft: wTyped, hDraft: hTyped, save: write } = latest.current;
    const waiting = pendingRef.current;
    const w = waiting?.w ?? (wTyped === null ? held.w : millimetres(wTyped));
    const h = waiting?.h ?? (hTyped === null ? held.h : millimetres(hTyped));
    if (Number.isFinite(w) && Number.isFinite(h) && (w !== held.w || h !== held.h)) write({ widthMm: w, heightMm: h });
  }, []);

  return { width, height, setWidth: setWDraft, setHeight: setHDraft, leave, cancel };
}
