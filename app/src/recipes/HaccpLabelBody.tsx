import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import {
  HACCP_FIELDS, HACCP_TEXT_MAX, dateFromInput, firstNameOf, haccpContent, haccpSettingsOf, haccpSizeMm, inputFromDate,
  layoutHaccpLabel, lotFromDate,
} from '@mise/shared/haccp-label';
import type {
  HaccpContent, HaccpDateField, HaccpField, HaccpLayout, HaccpSize, HaccpState, HaccpTextField, HaccpValues,
} from '@mise/shared/haccp-label';
import { measureLikePillow, unsupportedChars } from '@mise/shared/label-image-fonts';
import type { LabelMetrics } from '@mise/shared/label-image-fonts';
import { BODY_PX, S } from '@mise/shared/label-image-layout';
import type { Bitmap } from '@mise/shared/label-image-raster';
import { dateText, useByDate } from '@mise/shared/label-template-model';
import { allergenName, canPrintLabel, outputLanguage } from '@mise/shared/market';
import { canLabel, recipeAllergens } from '@mise/shared/recipe-allergen-model';
import type { RecipeAllergens } from '@mise/shared/recipe-allergen-model';
import { allergensOn } from '@mise/shared/venue-features';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { announceAction } from '../telemetry/usage';
import { useAllergenTables } from './allergenTables';
import { bitmapPng, loadLogoImage, paintBitmap, renderLayoutBitmap } from './labelCanvas';
import { useLabelFonts } from './labelFonts';
import { HACCP_FIELD_TEXT } from './haccpText';
import { HACCP_STORAGE_MAX, labelTextsOf } from './labelTexts';
import { closePrintHost, openHaccpPrintHost } from './printHost';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { useLabelMetrics } from './useLabelMetrics';
import { useStillWaiting } from './useStillWaiting';
import styles from './LabelScreen.module.css';
import own from './HaccpLabelBody.module.css';

// The HACCP label screen's body (image labels step 2): the boxes for this print, the preview of the very dots, the refusals
// and Print. NEW IN MISE 2 (no original in js/).
//
// ⚠️⚠️ WHAT YOU SEE IS WHAT THE PRINTER GETS, AS ON THE «WITH LOGO» LABEL. The preview is the very dots of the label (its size
// in millimetres × 8), and the print dialog's picture is a PNG of the same dots: the screen never draws a second version.
//
// ⚠️⚠️ THE WORDS ON THE LABEL ARE THE COUNTRY'S (`outputLanguage`), the sentences that tell somebody what to tap are the
// interface's (`t()`): a lab in Italy prints «Preparato il» whatever language the tablet speaks.
//
// ⚠️⚠️ TOO LONG, TOO WIDE OR WITH A LETTER THE FONTS DO NOT HOLD IS REFUSED, NEVER SHRUNK AND NEVER CUT: the layout says so
// (`refused`), the screen names every reason in one sentence, draws nothing and offers no Print.
//
// ⚠️⚠️ THE ALLERGENS FIELD, PRINTED, MEANS THE RECIPE IS FULLY DECLARED: the product label's rule (a recipe with an ingredient
// Mise knows nothing about gets no allergen line at all, because a missing allergen on food is worse than no label). Set to «by
// hand» or «off» in Settings, the declarations are never asked for.
//
// ⚠️ NOTHING TYPED HERE IS SAVED ANYWHERE, and leaving never asks: the boxes are this print's (a lot, a quantity, a date). The
// storage text starts from the recipe's own (the recipe editor), the lot from the prepared-on date, «prepared by» from the
// signed-in person's first name, and every date from today — and each FOLLOWS its source until somebody types in its box.

// The first half: the refusals that need no font and no width table. A venue that cannot print this label downloads none of it.
export function HaccpLabelBody({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const { location } = useSession();
  const { recipes, ingredients, ingredientsLoaded, labelConfig, labelConfigKnown } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const stillWaiting = useStillWaiting(!ingredientsLoaded);
  const declared = useMemo(() => recipeAllergens(recipe, tables), [recipe, tables]);
  const settings = haccpSettingsOf(labelConfig);

  const lang = outputLanguage(location);
  const printAllergens = settings.fields.allergens === 'print';

  let content: ReactNode;
  if (!labelConfigKnown) {
    // ⚠️ THE FIELDS AND THE SIZE ARE BELIEVED ONLY ONCE THEY HAVE ARRIVED: a label drawn from the defaults could be the wrong one.
    content = <p className={styles.checking} aria-busy="true">{t('session.loading')}</p>;
  } else if (lang === null || !canPrintLabel(location)) {
    content = blocked(t('label.blocked'), [t('label.blocked.noCountry')]);
  } else if (printAllergens && !allergensOn(location)) {
    content = blocked(t('label.blocked'), [t('haccp.label.allergensOff')]);
  } else if (printAllergens && !ingredientsLoaded) {
    content = (
      <div>
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
        {stillWaiting ? <p className={styles.checking}>{t('recipes.allergensStillWaiting')}</p> : null}
      </div>
    );
  } else if (printAllergens && !canLabel(declared)) {
    // Not declared with no row to name means no rows at all: «0 ingredients are not declared» would say nothing.
    content = blocked(t('label.blocked'), [declared.gaps.length === 0
      ? t('label.blocked.noWeights')
      : t('label.blocked.notDeclared', { n: declared.gaps.length })]);
  } else {
    return (
      <div className={styles.body}>
        <HaccpLabelReady recipe={recipe} fieldsKey={HACCP_FIELDS.map(field => settings.fields[field]).join(',')} size={settings.size} declared={declared} />
      </div>
    );
  }
  return <div className={styles.body}><div role="status">{content}</div></div>;
}

const blocked = (title: string, sentences: readonly string[]): ReactNode => (
  <div className={styles.blocked}>
    <p className={styles.blockedTitle}>{title}</p>
    {sentences.map(sentence => <p key={sentence} className={styles.blockedText}>{sentence}</p>)}
  </div>
);

// Which boxes the screen draws, in the order they are printed: a field printed (not off, not left to the pen) that takes a
// value somebody can set. The name, the allergens and the use-by date are never boxes.
const DATE_BOXES: readonly HaccpDateField[] = ['preparedOn', 'blastChilledOn', 'frozenOn', 'openedOn'];
const TEXT_BOXES: readonly HaccpTextField[] = ['lot', 'preparedBy', 'storage', 'quantity'];

// The characters of the label's texts that its fonts cannot print, each once and in the order they first appear.
function missingChars(metrics: LabelMetrics, content: HaccpContent, layout: HaccpLayout): string[] {
  const found: string[] = [];
  const add = (list: string[]) => { for (const ch of list) if (!found.includes(ch)) found.push(ch); };
  for (const line of layout.titleLines) add(unsupportedChars(metrics, line, 'title', layout.titleSize * S));
  for (const row of content.rows) {
    add(unsupportedChars(metrics, `${row.caption}:`, 'bold', BODY_PX));
    if (row.value !== null) add(unsupportedChars(metrics, row.value, row.bold ? 'bold' : 'regular', BODY_PX));
  }
  return found;
}

// A label's width in CSS pixels at 96 to the inch: what the preview has on a screen wide enough to show it real size.
const mmToPx = (mm: number): number => (mm * 96) / 25.4;

// Today as a local day at midnight (the date boxes start here).
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

type ReadyProps = {
  recipe: CatalogueRecipe;
  // The eleven states, as one string (`HACCP_FIELDS` order) so a snapshot that changed nothing is not a change here.
  fieldsKey: string;
  size: HaccpSize;
  declared: RecipeAllergens;
};

// ⚠️ THE COUNTRY'S LANGUAGE IS ASKED AGAIN HERE, not handed down (label-separation.spec.ts: `lang` is declared from outputLanguage
// in each component that draws a food word, and nowhere else). HaccpLabelBody has already refused a venue without one.
function HaccpLabelReady({ recipe, fieldsKey, size, declared }: ReadyProps) {
  const { t } = useT();
  const { location, user } = useSession();
  const lang = outputLanguage(location);
  const store = useRecipesStore();
  const fonts = useLabelFonts();
  const metrics = useLabelMetrics();
  const idBase = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The settings as plain values: the same string gives the same object, so nothing below is redone for a snapshot that
  // changed nothing.
  const fields = useMemo(() => {
    const states = fieldsKey.split(',') as HaccpState[];
    return Object.fromEntries(HACCP_FIELDS.map((field, index) => [field, states[index]])) as Record<HaccpField, HaccpState>;
  }, [fieldsKey]);

  // ── The values of this print ───────────────────────────────────────────────
  // ⚠️ TODAY IS TODAY WHEN THE LABEL IS PRINTED, NOT WHEN THE SCREEN WAS OPENED: the lab tablet stays on this screen overnight,
  // and a label printed in the morning with yesterday's prepared-on date carries a use-by date a day too early. An untouched
  // date box follows the day (asked again when the screen comes back, every minute, and at Print); a typed one is the person's.
  const [day, setDay] = useState(() => inputFromDate(today()));
  const [datesTyped, setDatesTyped] = useState<Partial<Record<HaccpDateField, string>>>({});
  const dates = useMemo(() => Object.fromEntries(
    DATE_BOXES.map(field => [field, datesTyped[field] ?? day]),
  ) as Record<HaccpDateField, string>, [datesTyped, day]);
  useEffect(() => {
    const check = () => { setDay(inputFromDate(today())); };
    const timer = window.setInterval(check, 60_000);
    document.addEventListener('visibilitychange', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, []);
  // null = the lot still FOLLOWS the prepared-on date; any typing in the box (even emptying it) is the person's.
  const [lotTyped, setLotTyped] = useState<string | null>(null);
  const [preparedBy, setPreparedBy] = useState('');
  // null = the storage text still FOLLOWS the recipe's (edited on another device meanwhile, it changes here too).
  const [storageTyped, setStorageTyped] = useState<string | null>(null);
  const storage = storageTyped ?? labelTextsOf(recipe).haccpStorage;
  const [quantity, setQuantity] = useState('');

  // ⚠️ THE ROSTER IS READ ONCE, ONLY WHEN THE FIELD IS PRINTED, and what it gives is a starting point: a person who has typed
  // in the box before the answer comes keeps their words. The tablet in the lab is one shared account, so the name is editable.
  const printsBy = fields.preparedBy === 'print';
  const typedBy = useRef(false);
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!printsBy || uid === null) return undefined;
    let alive = true;
    void store.readMember(uid).then(member => {
      if (alive && !typedBy.current) setPreparedBy(firstNameOf(member));
    });
    return () => { alive = false; };
  }, [printsBy, uid, store]);

  // Does a date box still follow the day AND does the label use it? The prepared-on date is used by the use-by date and by a
  // lot nobody typed even when it is not printed itself.
  const followsDay = (field: HaccpDateField): boolean => datesTyped[field] === undefined && (fields[field] === 'print'
    || (field === 'preparedOn' && (fields.useBy === 'print' || (fields.lot === 'print' && lotTyped === null))));

  const preparedOn = dateFromInput(dates.preparedOn);
  const lot = lotTyped ?? lotFromDate(preparedOn);
  const shelfLifeDays = recipe.shelfLifeDays;
  // ⚠️ NO DATE TO COUNT FROM, NO USE-BY DATE: a cleared prepared-on box must not count from 1970.
  const useBy = preparedOn === null ? null : useByDate(shelfLifeDays, preparedOn);

  // The allergens' NAMES, in the label's language, as plain strings (the layout is keyed on them).
  const printsAllergens = fields.allergens === 'print';
  const allergenNames = useMemo(
    () => (printsAllergens ? declared.allergens.map(code => allergenName(code, lang)) : null),
    [printsAllergens, declared.allergens, lang],
  );
  const traceNames = useMemo(
    () => (printsAllergens ? declared.mayContain.map(code => allergenName(code, lang)) : []),
    [printsAllergens, declared.mayContain, lang],
  );
  const allergenKey = allergenNames === null ? '' : allergenNames.join('\u0000');
  const traceKey = traceNames.join('\u0000');

  const name = recipe.name;
  const useByKey = useBy === null ? '' : inputFromDate(useBy);
  // ⚠️ THE CONTENT DEPENDS ON PLAIN VALUES, NEVER ON THE OBJECTS THEY CAME IN (the ⚠️ in ImageLabelBody): a Firestore snapshot
  // hands down new objects for the recipe and the settings, and keyed on those the drawing would be thrown away and made
  // again for nothing — Print vanishing from under the finger. Strings are equal when nothing changed.
  const content = useMemo(() => {
    const values: HaccpValues = {
      name,
      preparedOn: dateFromInput(dates.preparedOn),
      useBy: dateFromInput(useByKey),
      lot,
      preparedBy,
      storage,
      blastChilledOn: dateFromInput(dates.blastChilledOn),
      frozenOn: dateFromInput(dates.frozenOn),
      openedOn: dateFromInput(dates.openedOn),
      quantity,
      allergens: allergenNames,
      mayContain: traceNames,
    };
    return haccpContent(fields, values, lang);
    // allergenNames / traceNames are rebuilt only when their keys change.
  }, [fields, name, dates, useByKey, lot, preparedBy, storage, quantity, allergenKey, traceKey, lang]);

  const usable = metrics !== null && metrics !== 'failed' ? metrics : null;
  const layout = useMemo(() => {
    if (usable === null) return null;
    return layoutHaccpLabel(content, size, (text, font, px) => measureLikePillow(usable, text, font, px));
  }, [content, size, usable]);

  // ── The drawing ────────────────────────────────────────────────────────────
  const [drawn, setDrawn] = useState<{ readonly bitmap: Bitmap; readonly png: string; readonly layout: HaccpLayout } | null>(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const [shownWidth, setShownWidth] = useState<number | null>(null);

  // The dots, drawn once the typeface, the widths and a layout that may be printed are all there. A result that arrives after
  // any of them changed is dropped.
  // ⚠️ THE PREVIOUS DRAWING STAYS ON SCREEN WHILE THE NEW ONE IS MADE (Print off meanwhile, see `drawing`): clearing it first
  // made the screen blink at every keystroke. It is cleared only when the inputs no longer make a label that may be printed.
  useEffect(() => {
    setDrawFailed(false);
    if (layout === null || layout.refused || usable === null || fonts !== 'ready') {
      setDrawn(null);
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        const bitmap = renderLayoutBitmap(layout.elements, layout.width, layout.height, usable, null);
        const png = bitmapPng(bitmap);
        // ⚠️ DECODED BEFORE PRINT IS PRESSED: window.print() does not wait for a picture still being decoded, and a label
        // printed blank is a wasted label.
        await loadLogoImage(png).catch(() => undefined);
        if (alive) setDrawn({ bitmap, png, layout });
      } catch {
        if (alive) setDrawFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [layout, usable, fonts]);

  const mayDraw = layout !== null && !layout.refused && fonts === 'ready';
  const drawing = mayDraw && drawn !== null && drawn.layout !== layout;
  const current = drawn !== null && !drawing && mayDraw ? drawn : null;

  useEffect(() => {
    if (drawn === null || canvasRef.current === null) return;
    try {
      paintBitmap(canvasRef.current, drawn.bitmap);
    } catch {
      setDrawFailed(true);
    }
  }, [drawn]);

  // Is the preview shown at its real size, or smaller to fit a narrow screen? Measured, never assumed.
  const showing = drawn !== null && mayDraw && !drawFailed;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!showing || canvas === null) {
      setShownWidth(null);
      return undefined;
    }
    const measure = () => {
      const width = canvas.getBoundingClientRect().width;
      setShownWidth(width > 0 ? width : null);
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(canvas);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [showing]);

  const mm = haccpSizeMm(size);
  const sizeParams = { w: String(mm.width), h: String(mm.height) };
  const measured = shownWidth === null ? null : shownWidth < mmToPx(mm.width) - 1;

  // ⚠️ THE HOST IS THE PRINT'S, NOT THIS SCREEN'S (printHost.tsx explains why it outlives the screen). One road only: this
  // device's print window, the label at its exact size. The lab printer's own road is a later step.
  const print = () => {
    if (current === null) return;
    // A day that turned since the last look redraws the label with today's dates first; Print comes back with the new drawing.
    const now = inputFromDate(today());
    if (now !== day) {
      setDay(now);
      if (DATE_BOXES.some(followsDay)) return;
    }
    openHaccpPrintHost(current.png, size);
    try {
      window.print();
      announceAction('haccp-label-printed');
    } catch {
      closePrintHost();
    }
  };

  const neutral = (key: MessageKey): ReactNode => <p className={styles.checking} aria-busy="true">{t(key)}</p>;

  // What the status region says, in the order somebody can fix it: the typeface, the widths, then the layout's own reasons.
  let status: ReactNode = null;
  if (fonts === 'failed') {
    status = blocked(t('label.blocked'), [t('label.preview.fontMissing')]);
  } else if (metrics === 'failed') {
    status = blocked(t('label.blocked'), [t('label.image.metricsFailed')]);
  } else if (fonts === 'loading' || usable === null || layout === null) {
    status = neutral('label.image.preparing');
  } else if (layout.refused) {
    const reasons: string[] = [];
    if (layout.empty) reasons.push(t('haccp.label.empty'));
    if (layout.tooLong) reasons.push(t('haccp.label.tooLong'));
    if (layout.tooWide.includes('title')) reasons.push(t('haccp.label.titleTooWide'));
    if (layout.tooWide.includes('caption')) reasons.push(t('haccp.label.captionTooWide'));
    if (layout.tooWide.includes('word')) reasons.push(t('haccp.label.wordTooWide'));
    if (layout.unmeasurable) reasons.push(t('label.image.unsupportedChars', { chars: missingChars(usable, content, layout).join(' ') }));
    status = blocked(t('label.image.refused'), reasons);
  } else if (drawFailed) {
    status = blocked(t('label.blocked'), [t('label.image.drawFailed')]);
  } else if (drawn === null) {
    status = neutral('label.image.preparing');
  }

  const off = !showing || drawing;
  const box = (field: HaccpField): boolean => fields[field] === 'print';
  const boxId = (field: HaccpField): string => `${idBase}-${field}`;

  const dateBox = (field: HaccpDateField) => (
    <div key={field} className={own.cell}>
      <label htmlFor={boxId(field)} className={own.label}>{t(HACCP_FIELD_TEXT[field])}</label>
      <input
        id={boxId(field)}
        type="date"
        className={own.input}
        value={dates[field]}
        onChange={event => { const typed = event.target.value; setDatesTyped(current => ({ ...current, [field]: typed })); }}
      />
    </div>
  );

  const textBox = (field: HaccpTextField, value: string, set: (text: string) => void, max: number = HACCP_TEXT_MAX) => (
    <div key={field} className={own.cell}>
      <label htmlFor={boxId(field)} className={own.label}>{t(HACCP_FIELD_TEXT[field])}</label>
      <input
        id={boxId(field)}
        type="text"
        autoComplete="off"
        className={own.input}
        maxLength={max}
        value={value}
        onChange={event => { set(event.target.value); }}
      />
    </div>
  );

  // ⚠️ THE USE-BY DATE AND THE LOT ARE COUNTED FROM THE PREPARED-ON DATE, so its box is there whenever either is printed, even
  // with the prepared-on date itself off the label: a date nobody can see or change must not decide a use-by date.
  const countsFromDay = box('useBy') || box('lot');
  const dayBox = box('preparedOn') || countsFromDay;
  const anyBox = dayBox || DATE_BOXES.some(box) || TEXT_BOXES.some(box);

  return (
    <>
      {anyBox ? (
        <section className={own.boxes} aria-labelledby={`${idBase}-boxes`}>
          <h3 id={`${idBase}-boxes`} className={own.boxesTitle}>{t('haccp.label.valuesTitle')}</h3>
          <p className={own.boxesNote}>{t('haccp.label.valuesNote')}</p>
          {dayBox ? dateBox('preparedOn') : null}
          {dayBox && !box('preparedOn') ? <p className={own.note}>{t('haccp.label.preparedOnNotPrinted')}</p> : null}
          {/* ⚠️ THE USE-BY DATE IS SHOWN, NEVER A BOX: it is a statement about safety, worked out from the date it was
              prepared and the recipe's shelf life, and nobody types over it on a label. */}
          {box('useBy') ? (
            <div className={own.cell}>
              <p className={own.label}>{t(HACCP_FIELD_TEXT.useBy)}</p>
              <p className={own.fixed}>{useBy === null ? '—' : dateText(useBy, lang)}</p>
              {useBy !== null ? null : preparedOn === null
                ? <p className={own.note}>{t('haccp.label.useByNoDate')}</p>
                : <p className={own.note}>{t('haccp.label.useByNoShelfLife')}</p>}
            </div>
          ) : null}
          {box('lot') ? textBox('lot', lot, setLotTyped) : null}
          {box('preparedBy') ? textBox('preparedBy', preparedBy, text => { typedBy.current = true; setPreparedBy(text); }) : null}
          {box('storage') ? textBox('storage', storage, setStorageTyped, HACCP_STORAGE_MAX) : null}
          {box('blastChilledOn') ? dateBox('blastChilledOn') : null}
          {box('frozenOn') ? dateBox('frozenOn') : null}
          {box('openedOn') ? dateBox('openedOn') : null}
          {box('quantity') ? textBox('quantity', quantity, setQuantity) : null}
        </section>
      ) : null}
      {/* ⚠️ THE STATUS REGION IS ALWAYS THERE, EMPTY OR NOT: only a region that already exists announces what is put into it,
          so the screen reader is told when the label becomes ready or is refused. */}
      <div role="status" className={own.live}>{status}</div>
      {showing ? (
        <>
          <canvas
            ref={canvasRef}
            className={own.preview}
            data-size={size}
            data-haccp-label=""
            role="img"
            aria-label={t('haccp.label.previewName', sizeParams)}
          />
          <p className={own.previewNote} hidden={measured === null}>
            {measured === null ? '' : t(measured ? 'label.preview.scaled' : 'label.preview.actualSize', sizeParams)}
          </p>
        </>
      ) : null}
      {showing && printsAllergens ? (
        <div className={styles.caveat}>
          <p className={styles.caveatTitle}>{t('label.caveat.title')}</p>
          <p className={styles.caveatText}>{t('label.caveat.body')}</p>
        </div>
      ) : null}
      {showing ? (
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.printButton}`} disabled={off} onClick={print}>
            <Printer aria-hidden="true" />
            <span>{t('label.print')}</span>
          </button>
          <p className={own.printNote}>{t('haccp.label.printNote', sizeParams)}</p>
        </div>
      ) : null}
    </>
  );
}
