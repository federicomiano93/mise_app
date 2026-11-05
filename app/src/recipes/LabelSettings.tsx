import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode, Ref } from 'react';
import { Trash2 } from 'lucide-react';
import {
  DATE_KINDS, DPI_CHOICES, LABEL_SIZES, PRINTER_LANGUAGES, normalizeLabelProfile,
} from '@mise/shared/label-template-model';
import type { DateKind, PrinterLanguage } from '@mise/shared/label-template-model';
import {
  RECIPE_CATEGORIES_MAX, RECIPE_CATEGORY_MAX, addCategory, countInCategory, removeCategory, sortedCategories,
} from '@mise/shared/recipe-shelf';
import type { CategoryRefusal } from '@mise/shared/recipe-shelf';
import type { MessageKey } from '../i18n/en';
import { useDataServices } from '../data/DataContext';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession, useSessionStore } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { recipePhotoOn } from './photoGate';
import { SegmentedChoice } from './SegmentedChoice';
import { imageLabelChoice } from './imageLabelData';
import { LogoError, prepareLogo } from './logoUpload';
import { useLabelLogo } from './useLabelLogo';
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
  const image = imageLabelChoice(labelConfig);
  const isLogo = image.template === 'logo';
  // The sentence under the page when a refused save was put back: which one (the labels' or the categories').
  const [failed, setFailed] = useState<MessageKey | null>(null);
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
    setFailed(null);
    store.saveLabelProfile(patch).catch(() => {
      if (mounted.current) setFailed('label.settings.saveFailed');
      else say(t('label.settings.saveFailed'));
    });
  }

  // The recipe categories go through the same local-first write (saveRecipeCategories); a refusal puts the list back and says so
  // in the same line.
  function saveCategories(list: readonly string[]): void {
    setFailed(null);
    store.saveRecipeCategories(list).catch(() => {
      if (mounted.current) setFailed('cat.shelf.categoriesNotSaved');
      else say(t('cat.shelf.categoriesNotSaved'));
    });
  }

  const size = useCustomSize({ w: profile.widthMm, h: profile.heightMm }, save);
  const presetId = LABEL_SIZES.find(s => s.widthMm === profile.widthMm && s.heightMm === profile.heightMm)?.id ?? null;
  // ⚠️ A SIZE THAT MATCHES NO PRESET IS A CUSTOM SIZE, so the boxes open by themselves: otherwise nothing would be
  // chosen and nothing would say why.
  // ⚠️ AND THEY STAY OPEN WHILE SOMEBODY IS IN THEM, holds typing in them or a size waiting: a half-typed size that
  // happens to equal a preset must not close the boxes under the finger.
  const isCustom = presetId === null || customOpen || size.holding;
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
      <PhotoCard />

      <RecipeCategoriesCard onSave={saveCategories} />

      {/* ⚠️ THE MODEL DECIDES WHICH CARDS APPLY: the image label is always 80 × 60 mm at 203 dpi and has its own header, so
          the paper, the printer and «what else» belong to the standard model only (their code is untouched). */}
      <Card title={t('label.settings.modelCard')} intro={t('label.settings.modelNote')}>
        <SegmentedChoice
          label={t('label.settings.model')}
          choices={[
            { value: 'standard' as const, text: t('label.settings.model.standard') },
            { value: 'logo' as const, text: t('label.settings.model.logo') },
          ]}
          selected={image.template}
          onSelect={template => { if (template !== image.template) save({ template }); }}
        />
        {isLogo ? (
          <SwitchRow
            title={t('label.settings.rotate')}
            sub={t('label.settings.rotateNote')}
            selected={image.rotate180}
            onChange={on => { save({ rotate180: on }); }}
          />
        ) : null}
      </Card>

      {isLogo ? (
        <>
          <Card title={t('label.settings.header')} intro={t('label.settings.headerNote')}>
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
          </Card>
          <LogoCard />
        </>
      ) : null}

      {isLogo ? null : (
      <>
      <Card title={t('label.settings.title')}>
        <SegmentedChoice
          label={t('label.settings.size')}
          choices={sizeChoices}
          selected={isCustom ? 'custom' : presetId}
          onSelect={chooseSize}
        >
          {isCustom ? (
            <>
              <div
                className={styles.customRow}
                onFocus={size.enter}
                onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) size.leave(); }}
              >
                <SizeBox label={t('label.settings.width')} value={size.width} onChange={size.setWidth} />
                <SizeBox label={t('label.settings.height')} value={size.height} onChange={size.setHeight} />
              </div>
              {/* Empty until a size is refused for its range; it is there before it speaks. */}
              <p role="status" className={size.rangeError ? styles.rangeError : styles.quietInBlock}>
                {size.rangeError ? t('label.settings.sizeRange') : ''}
              </p>
            </>
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
      </>
      )}

      {/* The live region sits in the same block as the note, outside the column's gap: empty, it takes no room. */}
      <div>
        <p className={styles.setup}>{t('label.settings.setup')}</p>
        <p role="status" className={failed ? styles.failed : styles.quiet}>{failed ? t(failed) : ''}</p>
      </div>
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

// The photograph reader's switch (the first card, as in the current app): whether this venue may read a recipe from a
// photograph. Shown for whoever runs the place only (the section decides who sees Settings at all).
//
// ⚠️ IT ASKS, AND IT SAYS WHAT IT COSTS. This is the only control in the app that starts something billable, so switching it
// on is a decision somebody makes on purpose rather than a tap they can make by accident. The switch shows what the
// venue's document says (ONLY a literal true counts, photoGate.ts) and moves when the server has done it: the tap asks,
// the Cloud Function writes, the venue is read again, and only then does it show the new state. A refusal leaves it as it was.
function PhotoCard() {
  const { t } = useT();
  const say = useStatusMessage();
  const { location, locationId } = useSession();
  const sessionStore = useSessionStore();
  const services = useDataServices();
  const [confirm, confirmDialog] = useConfirm();
  const source = useMemo(() => services.photo(locationId as string), [services, locationId]);
  const headId = useId();

  const fromSession = recipePhotoOn(location);
  // ⚠️ THE ANSWER IS HELD HERE UNTIL THE SESSION SHOWS IT (the current app's `overriddenPhotoOn`): the venue's document is
  // read when the venue opens and does not follow a write made afterwards, so the session is read again, and if that read
  // could not reach the server the switch still tells the truth about what was just done.
  const [held, setHeld] = useState<boolean | null>(null);
  useEffect(() => { if (held !== null && held === fromSession) setHeld(null); }, [held, fromSession]);
  const on = held ?? fromSession;

  const [busy, setBusy] = useState(false);
  // In a ref as well: a second tap while the question is open or the call is in the air must be ignored at once.
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  async function change(next: boolean): Promise<void> {
    if (working.current) return;
    working.current = true;
    try {
      const ok = await confirm({
        title: t(next ? 'cat.photo.turnOnTitle' : 'cat.photo.turnOffTitle'),
        message: t(next ? 'cat.photo.turnOnBody' : 'cat.photo.turnOffBody'),
        okLabel: t(next ? 'cat.photo.turnOn' : 'cat.photo.turnOff'),
        cancelLabel: t('common.cancel'),
      });
      if (!ok || !mounted.current) return;
      setBusy(true);
      // ⚠️ HELD BY THE CALL, NOT BY THE SCREEN: a reload the app starts by itself waits for the answer even if Settings is left.
      const release = markBusy();
      try {
        await source.setRecipePhoto(next);
        await sessionStore.refreshLocation();
        if (mounted.current) setHeld(next);
        say(t(next ? 'cat.photo.nowOn' : 'cat.photo.nowOff'));
      } catch (error) {
        // ⚠️ A FAILED CALL MAY STILL HAVE CHANGED THE SWITCH: a phone that stopped waiting (a timeout, the signal lost on the
        // way back) does not stop the server. So the venue is read again from the server in every case, and the switch shows
        // what the server holds — never «off» while staff can already spend money on reads.
        // ⚠️ IN THE PERSON'S LANGUAGE, NOT THE SERVER'S: the function's sentences are English and the SDK's are codes
        // («deadline-exceeded»); the current app showed them as they came.
        await sessionStore.refreshLocation();
        const code = String((error as { code?: unknown } | null)?.code ?? '');
        say(t(/permission-denied$/.test(code) ? 'cat.photo.switchNotAllowed' : 'cat.photo.switchFailed'));
      } finally {
        release();
        if (mounted.current) setBusy(false);
      }
    } finally {
      working.current = false;
    }
  }

  return (
    <section className={styles.card} aria-labelledby={headId} aria-busy={busy ? true : undefined}>
      <div className={styles.head}>
        <h3 id={headId} className={styles.headTitle}>{t('settings.cat.photo')}</h3>
      </div>
      <SwitchRow
        title={t('cat.photo.setting')}
        sub={t('cat.photo.settingNote')}
        selected={on}
        onChange={next => { void change(next); }}
        busy={busy}
      />
      {confirmDialog}
    </section>
  );
}

// The words a recipe can be filed under (NEW IN MISE 2, docs/parity/catalogue.md «Recipe categories and the archive»): alphabetical, a
// low-key bin on each, and a box to add one. Deleting a word writes no recipe: the recipes under it read as «no category» until
// the word is added again, and the question says how many.
//
// ⚠️ DRAWN ONLY ONCE THE LABEL PROFILE HAS ARRIVED (LabelSettings shows nothing else before): the list lives in that document,
// and a write over a list not yet seen would replace the venue's own words.
function RecipeCategoriesCard({ onSave }: { onSave: (list: readonly string[]) => void }) {
  const { t, locale } = useT();
  const { categories, recipes, labelConfigFromServer } = useRecipes();
  // ⚠️ THE LIST IS WRITTEN WHOLE, so it is changed only on the SERVER's word: a copy kept on this phone could be a version behind,
  // and writing it would take away a word another manager added. Until then add and delete stay drawn (aria-disabled, never
  // `disabled`: Chrome blurs a disabled control under the finger) and do nothing.
  const writable = labelConfigFromServer;
  const [confirm, confirmDialog] = useConfirm();
  const headId = useId();
  const boxId = useId();
  const refusalId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const bins = useRef(new Map<string, HTMLButtonElement>());
  const asking = useRef(false);
  const [typed, setTyped] = useState('');
  const [refusal, setRefusal] = useState<{ kind: CategoryRefusal; name: string } | null>(null);
  const list = sortedCategories(categories, locale);

  // Where the focus goes once a deleted row has left the page: the bin that takes its place (the next row's, or the last when it
  // was the last), or the card's heading when none is left — never the page.
  const [after, setAfter] = useState<{ deleted: string; next: string | null } | null>(null);
  useEffect(() => {
    if (after === null || list.includes(after.deleted)) return;
    setAfter(null);
    const target = after.next === null ? undefined : bins.current.get(after.next);
    (target ?? heading.current)?.focus();
  });

  function add(): void {
    if (!writable) return;
    const result = addCategory(categories, typed);
    if ('refusal' in result) {
      setRefusal({ kind: result.refusal, name: typed.trim().replace(/\s+/g, ' ') });
      box.current?.focus();
      return;
    }
    setRefusal(null);
    setTyped('');
    onSave(result.list);
    box.current?.focus();
  }

  async function remove(name: string): Promise<void> {
    if (asking.current || !writable) return;
    asking.current = true;
    try {
      const count = countInCategory(recipes, name, categories);
      const ok = await confirm({
        title: t('cat.shelf.deleteCategoryTitle', { name }),
        message: count === 0 ? t('cat.shelf.deleteCategoryNone') : t('cat.shelf.deleteCategoryUsed', { n: count }),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      const index = list.indexOf(name);
      const rest = list.filter(word => word !== name);
      setAfter({ deleted: name, next: rest[Math.min(index, rest.length - 1)] ?? null });
      onSave(removeCategory(categories, name));
    } finally {
      asking.current = false;
    }
  }

  const refusalText = refusal === null ? '' : refusal.kind === 'tooLong'
    ? t('cat.shelf.refusal.tooLong', { n: RECIPE_CATEGORY_MAX })
    : refusal.kind === 'taken'
      ? t('cat.shelf.refusal.taken', { name: refusal.name })
      : refusal.kind === 'full'
        ? t('cat.shelf.refusal.full', { n: RECIPE_CATEGORIES_MAX })
        : t('cat.shelf.refusal.empty');

  return (
    <section className={styles.card} aria-labelledby={headId}>
      <div className={styles.head}>
        <h3 id={headId} ref={heading} tabIndex={-1} className={styles.headTitle}>{t('cat.shelf.settingsTitle')}</h3>
        <p className={styles.note}>{t('cat.shelf.settingsNote')}</p>
        {writable ? null : <p className={styles.note}>{t('cat.shelf.waitingForServer')}</p>}
      </div>
      {list.length === 0 ? (
        <div className={styles.row}>
          <span className={styles.text}><span className={styles.sub}>{t('cat.shelf.settingsEmpty')}</span></span>
        </div>
      ) : (
        <ul className={styles.rows}>
          {list.map(name => (
            <li key={name} className={styles.row}>
              <span className={styles.text}><span className={styles.title}>{name}</span></span>
              <button
                ref={node => {
                  if (node) bins.current.set(name, node);
                  else bins.current.delete(name);
                }}
                type="button"
                className={styles.bin}
                aria-label={t('cat.shelf.deleteCategory', { name })}
                title={t('cat.shelf.deleteCategory', { name })}
                aria-disabled={writable ? undefined : 'true'}
                onClick={() => { void remove(name); }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className={styles.field}>
        <label htmlFor={boxId} className={styles.fieldName}>{t('cat.shelf.newCategory')}</label>
        <div className={styles.addRow}>
          <input
            ref={box}
            id={boxId}
            type="text"
            autoComplete="off"
            className={styles.input}
            maxLength={RECIPE_CATEGORY_MAX}
            placeholder={t('cat.shelf.newCategoryPlaceholder')}
            aria-invalid={refusal === null ? undefined : true}
            aria-describedby={refusal === null ? undefined : refusalId}
            value={typed}
            onChange={event => { setTyped(event.target.value); setRefusal(null); }}
            onKeyDown={event => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              add();
            }}
          />
          <Button variant="secondary" isPending={!writable} onPress={add}>{t('cat.shelf.add')}</Button>
        </div>
        {/* Empty until a word is refused; it is there before it speaks, so a screen reader hears the sentence. */}
        <p id={refusalId} role="status" className={refusal === null ? styles.quietInBlock : styles.rangeError}>{refusalText}</p>
      </div>
      {confirmDialog}
    </section>
  );
}

// How long the logo card waits for the server before it says the logo is kept on this device.
const LOGO_SAVE_WAIT_MS = 8000;

const LOGO_ERROR_TEXT: Readonly<Record<LogoError['code'], MessageKey>> = {
  blank: 'label.settings.logoBlank',
  'too-tall': 'label.settings.logoTooTall',
  undecodable: 'label.settings.logoUndecodable',
  'too-big': 'label.settings.logoTooBig',
};

// The logo of the «with logo» label: chosen from the phone's own files, turned into the printer's black and white by
// prepareLogo and stored for the whole venue. Shown only for that model.
//
// ⚠️ ONE PICK AT A TIME (`working`), HELD BY THE CALL: the app does not reload by itself while the logo is being prepared
// and written (markBusy), and the file box is emptied after every pick so the same file can be chosen again.
// ⚠️ THE SENTENCE LIVES IN THE CARD'S OWN `role="status"`, there before it speaks, so a screen reader hears the outcome.
function LogoCard() {
  const { t } = useT();
  const store = useRecipesStore();
  const logo = useLabelLogo();
  const [confirm, confirmDialog] = useConfirm();
  const headId = useId();
  const noteId = useId();
  const fileBox = useRef<HTMLInputElement>(null);
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<MessageKey | null>(null);
  const [failedCard, setFailedCard] = useState(false);

  async function pick(file: Blob): Promise<void> {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setSaid(null);
    setFailedCard(false);
    const release = markBusy();
    let outcome: MessageKey = 'label.settings.logoSaved';
    let bad = false;
    try {
      let prepared;
      try {
        prepared = await prepareLogo(file);
      } catch (error) {
        bad = true;
        outcome = error instanceof LogoError ? LOGO_ERROR_TEXT[error.code] : 'label.settings.logoUndecodable';
      }
      if (prepared !== undefined) {
        // ⚠️ OFFLINE THE WRITE NEVER ANSWERS: saveLabelLogo resolves when the SERVER has it, so without a limit the card
        // would stay busy for as long as the connection is away, with no sentence at all. After LOGO_SAVE_WAIT_MS the card
        // is released and says it is kept on this device; the write is still awaited in the background and its real end
        // (saved, or refused) replaces that sentence if the card is still there and no newer pick has started.
        const settled = store.saveLabelLogo(prepared).then(() => 'saved' as const, () => 'failed' as const);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const slow = new Promise<'slow'>(resolve => { timer = setTimeout(() => { resolve('slow'); }, LOGO_SAVE_WAIT_MS); });
        const first = await Promise.race([settled, slow]);
        clearTimeout(timer);
        if (first === 'failed') {
          bad = true;
          outcome = 'label.settings.logoSaveFailed';
        } else if (first === 'slow') {
          outcome = 'label.settings.logoQueued';
          void settled.then(last => {
            if (!mounted.current || working.current) return;
            setSaid(last === 'saved' ? 'label.settings.logoSaved' : 'label.settings.logoSaveFailed');
            setFailedCard(last === 'failed');
          });
        }
      }
    } finally {
      release();
      working.current = false;
      if (mounted.current) {
        setBusy(false);
        setSaid(outcome);
        setFailedCard(bad);
      }
    }
  }

  async function remove(): Promise<void> {
    if (working.current) return;
    working.current = true;
    try {
      const ok = await confirm({
        title: t('label.settings.logoRemoveTitle'),
        message: t('label.settings.logoRemoveBody'),
        okLabel: t('label.settings.logoRemove'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok || !mounted.current) return;
      setBusy(true);
      setSaid(null);
      setFailedCard(false);
      const release = markBusy();
      let bad = false;
      try {
        await store.removeLabelLogo();
      } catch {
        bad = true;
      } finally {
        release();
        if (mounted.current) {
          setBusy(false);
          setFailedCard(bad);
          setSaid(bad ? 'label.settings.logoRemoveFailed' : null);
        }
      }
    } finally {
      working.current = false;
    }
  }

  const has = logo.status === 'ready';
  return (
    <section className={styles.card} aria-labelledby={headId} aria-busy={busy ? true : undefined}>
      <div className={styles.head}>
        <h3 id={headId} className={styles.headTitle}>{t('label.settings.logo')}</h3>
        <p id={noteId} className={styles.note}>{t('label.settings.logoNote')}</p>
      </div>
      <div className={styles.logoBody}>
        {logo.status === 'loading' ? <p className={styles.note}>{t('label.settings.logoLoading')}</p> : null}
        {logo.status === 'failed' ? <p className={styles.failed}>{t('label.settings.logoFailed')}</p> : null}
        {logo.status === 'none' || logo.status === 'unreadable' ? <p className={styles.note}>{t('label.settings.logoNone')}</p> : null}
        {logo.status === 'ready' ? (
          <img className={styles.logoPreview} src={logo.logo.png} alt={t('label.settings.logoAlt')} />
        ) : null}
        {logo.status === 'loading' || logo.status === 'failed' ? null : (
          <div className={styles.logoActions}>
            <button type="button" className={styles.logoButton} disabled={busy} aria-describedby={noteId} onClick={() => { fileBox.current?.click(); }}>
              {t(has ? 'label.settings.logoChange' : 'label.settings.logoChoose')}
            </button>
            {has ? (
              <button type="button" className={styles.logoRemove} disabled={busy} aria-label={t('label.settings.logoRemove')} onClick={() => { void remove(); }}>
                <Trash2 aria-hidden="true" />
              </button>
            ) : null}
          </div>
        )}
        <input
          ref={fileBox}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className={styles.fileBox}
          tabIndex={-1}
          aria-hidden="true"
          data-testid="logo-file"
          onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void pick(file);
          }}
        />
        <p role="status" className={failedCard ? styles.failed : said === null ? styles.quietInBlock : styles.logoSaid}>{said === null ? '' : t(said)}</p>
      </div>
      {confirmDialog}
    </section>
  );
}

function SwitchRow({ title, sub, selected, onChange, busy = false }: {
  title: string; sub?: string; selected: boolean; onChange: (selected: boolean) => void; busy?: boolean;
}) {
  const ids = useId();
  return (
    <div className={styles.row} aria-busy={busy ? true : undefined}>
      <span className={styles.text}>
        <span id={`${ids}-title`} className={styles.title}>{title}</span>
        {sub === undefined ? null : <span id={`${ids}-sub`} className={styles.sub}>{sub}</span>}
      </span>
      <SettingSwitch
        selected={selected}
        onChange={next => { if (!busy) onChange(next); }}
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

function SizeBox({ label, value, onChange }: {
  label: string; value: string; onChange: (text: string) => void;
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

// The least and the most a label may measure, in millimetres: the rules' own bounds (config/labels), repeated here so
// a size outside them is never sent.
export const MIN_MM = 20;
export const MAX_MM = 300;
const inRange = (mm: number): boolean => Number.isFinite(mm) && mm >= MIN_MM && mm <= MAX_MM;

// The two boxes of a custom size.
//
// ⚠️ ON LEAVING THE BOXES, NEVER PER KEYSTROKE: typing «102» would otherwise save 1, then 10, then 102 — three writes,
// and the first two are label sizes this venue never chose.
//
// ⚠️⚠️ AND THE TWO BOXES ARE ONE DECISION, SO THEY ARE ONE WRITE `{ widthMm, heightMm }`, written 350 ms after focus
// left BOTH boxes. Moving from the width to the height arms nothing, and focus or typing in either box stops a timer that
// is running: written mid-typing, `{ new width, old height }` could be a preset, the boxes would close under the finger,
// and a half-typed height would be lost. While a box has the focus or holds typing, the boxes stay open (`holding`).
//
// ⚠️ A SIZE THE RULES WOULD REFUSE IS NEVER SENT: an empty box, text that is no number, or a value outside 20–300 writes
// nothing, puts both boxes back to the saved size and says why (`rangeError`) until the next valid size. Sent, the
// profile would lay every label out on the default paper meanwhile, and offline the refused write would wait in the queue.
//
// The state lives here, above the boxes, because the boxes come and go: a PRESET tapped while a size waits to be written
// cancels it (`cancel`), and the boxes closing must not write it after the preset.
function useCustomSize(saved: { w: number; h: number }, save: (patch: Patch) => void) {
  const [wDraft, setWDraft] = useState<string | null>(null);
  const [hDraft, setHDraft] = useState<string | null>(null);
  const [pending, setPendingState] = useState<{ w: number; h: number } | null>(null);
  const [inside, setInside] = useState(false);
  const [rangeError, setRangeError] = useState(false);
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

  // Writes what the boxes hold NOW, if it is a valid size that differs from the saved one (the screen going, the page
  // being hidden). The newest word wins: typing over a size that waits.
  function commitNow(): void {
    stopTimer();
    const { saved: held, wDraft: wTyped, hDraft: hTyped, save: write } = latest.current;
    const waiting = pendingRef.current;
    const w = wTyped !== null ? millimetres(wTyped) : waiting?.w ?? held.w;
    const h = hTyped !== null ? millimetres(hTyped) : waiting?.h ?? held.h;
    setPending(null);
    setWDraft(null);
    setHDraft(null);
    if (inRange(w) && inRange(h) && (w !== held.w || h !== held.h)) write({ widthMm: w, heightMm: h });
  }
  const commitRef = useRef(commitNow);
  commitRef.current = commitNow;

  function flush(): void {
    stopTimer();
    const next = pendingRef.current;
    if (next === null) return;
    setPending(null);
    const { saved: held, save: write } = latest.current;
    if (next.w !== held.w || next.h !== held.h) write({ widthMm: next.w, heightMm: next.h });
  }

  // Focus came into the boxes (or moved from one to the other): nothing may be written while somebody is in them.
  function enter(): void {
    stopTimer();
    setInside(true);
  }

  // Focus left BOTH boxes.
  function leave(): void {
    setInside(false);
    const w = millimetres(width);
    const h = millimetres(height);
    setWDraft(null);
    setHDraft(null);
    if (!inRange(w) || !inRange(h)) {
      stopTimer();
      setPending(null);
      setRangeError(true);
      return;
    }
    setRangeError(false);
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
    setInside(false);
    setRangeError(false);
  }

  // Typing that is not the saved size, or a size not yet written: a reload the app starts by itself waits.
  const differs = pending !== null
    || (wDraft !== null && millimetres(wDraft) !== saved.w)
    || (hDraft !== null && millimetres(hDraft) !== saved.h);
  useEffect(() => (differs ? markBusy() : undefined), [differs]);

  // ⚠️ A PAGE HIDDEN OR KILLED (the tablet put to sleep, the browser closed) would lose a size still waiting its 350 ms:
  // it is written at once.
  useEffect(() => {
    const hidden = () => { if (document.visibilityState === 'hidden') commitRef.current(); };
    const gone = () => { commitRef.current(); };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', gone);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', gone);
    };
  }, []);

  // ⚠️ LEAVING THE SCREEN: a size waiting its 350 ms is written at once, and so is one still being typed.
  useEffect(() => () => { commitRef.current(); }, []);

  return {
    width, height, setWidth: (text: string) => { stopTimer(); setWDraft(text); }, setHeight: (text: string) => { stopTimer(); setHDraft(text); },
    enter, leave, cancel, rangeError,
    // The boxes stay open while somebody is in them, holds typing or a size waiting, or the range sentence is up.
    holding: inside || wDraft !== null || hDraft !== null || pending !== null || rangeError,
  };
}
