import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Printer } from 'lucide-react';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { measureLikePillow, unsupportedChars } from '@mise/shared/label-image-fonts';
import type { LabelMetrics } from '@mise/shared/label-image-fonts';
import {
  BODY_PX, SMALL_BOLD_PX, S, ingredientWords, layoutLogoLabel, producedOnWord,
} from '@mise/shared/label-image-layout';
import type { LogoLabelInput, LogoLabelLayout } from '@mise/shared/label-image-layout';
import type { Bitmap } from '@mise/shared/label-image-raster';
import { checkLabelText, runsOf } from '@mise/shared/label-text-check';
import type { CheckIssue } from '@mise/shared/label-text-check';
import { normalizeLabelProfile } from '@mise/shared/label-template-model';
import { allergenName, canPrintLabel, outputLanguage } from '@mise/shared/market';
import { canLabel, recipeAllergens } from '@mise/shared/recipe-allergen-model';
import { MAX_IMAGE_COPIES, MAX_JOB_CHARS, imageLabelZpl } from '@mise/shared/zpl-z64';
import { allergensOn } from '@mise/shared/venue-features';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { announceAction } from '../telemetry/usage';
import { copyToClipboard } from '../ui/clipboard';
import { useAllergenTables } from './allergenTables';
import { imageLabelChoice } from './imageLabelData';
import { browserDeflate } from './labelDeflate';
import { bitmapPng, loadLogoImage, paintBitmap, renderLogoLabelBitmap } from './labelCanvas';
import { useLabelFonts } from './labelFonts';
import { labelTextsOf, labelTitleOf } from './labelTexts';
import { closePrintHost, openImagePrintHost } from './printHost';
import { useRecipes } from './RecipesContext';
import { useLabelLogo } from './useLabelLogo';
import { useStillWaiting } from './useStillWaiting';
import styles from './LabelScreen.module.css';
import own from './ImageLabelBody.module.css';

// The label screen for the «with logo» model: the product label, 80 × 60 mm, drawn as an IMAGE (the owner's script,
// ported in shared/src/label-image-*.ts) and put on paper either through the system's print dialog or as the Zebra's own
// code to paste into its setup program. NEW IN MISE 2 (no original in js/).
//
// ⚠️⚠️ WHAT YOU SEE IS WHAT THE PRINTER GETS. The preview is the very 640 × 480 dots the printer receives (and the print
// dialog's picture is a PNG of the same dots), never a second drawing of the same text: the screen cannot show a label
// that the printer would then draw differently.
//
// ⚠️⚠️ TOO LONG, TOO WIDE OR WITH A LETTER THE FONTS DO NOT HOLD IS REFUSED, NEVER SHRUNK AND NEVER CUT: the layout says so
// (`refused`), the screen names every reason in one sentence, draws nothing and offers no Copy and no Print. The
// ingredients are printed at the smallest size the law allows; a label with less is not a label.
//
// ⚠️⚠️ THE FOOD WORDS ARE THE COUNTRY'S (`outputLanguage`, declared once in each of the two components, read while
// drawing), the sentences that tell somebody what to tap are the interface's (`t()`). The text CHECK reads Italian only
// (the owner's lists are Italian): any other language gets a plain note, never an Italian check pretending to read
// English. It does not replace the HACCP consultant, and the caveat below says so on every label.
//
// ⚠️ ERRORS STOP THE PRINTING, WARNINGS DO NOT. An allergen in small letters, a beer without ORZO, a lecithin of unsaid
// origin, an allergen Mise knows the recipe holds that the text never names: Copy and Print are off, beside the sentence
// that says why. Wine, chocolate and margarine only ask to be verified. When Mise does not hold the recipe's allergens
// fully declared there is nothing to compare with, and the screen says so as a warning — it is not a block.

// 80 mm in CSS pixels (96 to the inch): the width the preview has when the screen is wide enough to show it real size.
const ACTUAL_PX = (80 * 96) / 25.4;

// A note under the buttons: the key and its words, translated while drawing so a language switch is followed.
type Note = { readonly key: MessageKey; readonly params?: Readonly<Record<string, string | number>> } | null;

// Copies, whole and from 1 to the print queue's limit. Never NaN: anything that is not a number is one copy.
export function clampCopies(text: string): number {
  const n = Math.floor(Number(text));
  return Number.isFinite(n) ? Math.min(MAX_IMAGE_COPIES, Math.max(1, n)) : 1;
}

// The characters of the label's texts that its fonts cannot print, each once and in the order they first appear. The
// size does not change WHICH characters are missing, only that the size is in the table, so each face is asked at a size
// the layout really uses.
function missingChars(metrics: LabelMetrics, input: LogoLabelInput, layout: LogoLabelLayout): string[] {
  const found: string[] = [];
  const add = (list: string[]) => { for (const ch of list) if (!found.includes(ch)) found.push(ch); };
  for (const line of layout.titleLines) add(unsupportedChars(metrics, line, 'title', layout.titleSize * S));
  for (const line of input.header) add(unsupportedChars(metrics, line.normalize('NFC').trim(), 'regular', BODY_PX));
  for (const word of ingredientWords(input.ingredients.normalize('NFC'))) {
    for (const run of runsOf(word)) add(unsupportedChars(metrics, run.text, run.bold ? 'bold' : 'regular', BODY_PX));
  }
  add(unsupportedChars(metrics, input.producedOn, 'bold', SMALL_BOLD_PX));
  return found;
}

// The width table is large (every character at every size), so it is fetched when this screen first needs it and is in
// no other screen's bundle.
function useLabelMetrics(): LabelMetrics | 'failed' | null {
  const [metrics, setMetrics] = useState<LabelMetrics | 'failed' | null>(null);
  useEffect(() => {
    let alive = true;
    import('@mise/shared/label-image-metrics').then(
      module => { if (alive) setMetrics(module.labelMetrics()); },
      () => { if (alive) setMetrics('failed'); },
    );
    return () => { alive = false; };
  }, []);
  return metrics;
}

const blocked = (title: string, sentences: readonly string[]): ReactNode => (
  <div className={styles.blocked}>
    <p className={styles.blockedTitle}>{title}</p>
    {sentences.map(sentence => <p key={sentence} className={styles.blockedText}>{sentence}</p>)}
  </div>
);

// The screen's first half: the refusals that need no logo and no font. Everything that loads (the logo, the typeface,
// the width table) belongs to the second half, so a venue that cannot print this label downloads none of it.
export function ImageLabelBody({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const { location } = useSession();
  const { ingredientsLoaded } = useRecipes();
  const stillWaiting = useStillWaiting(!ingredientsLoaded);

  const lang = outputLanguage(location);
  const allergens = allergensOn(location);
  const printable = canPrintLabel(location) && lang !== null;
  const typed = labelTextsOf(recipe).labelIngredientsText;

  let content: ReactNode;
  if (!allergens) {
    content = blocked(t('label.blocked'), [t('label.blocked.allergensOff')]);
  } else if (lang === null || !printable) {
    content = blocked(t('label.blocked'), [t('label.blocked.noCountry')]);
  } else if (!ingredientsLoaded) {
    content = (
      <div>
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
        {stillWaiting ? <p className={styles.checking}>{t('recipes.allergensStillWaiting')}</p> : null}
      </div>
    );
  } else if (typed.trim() === '') {
    content = blocked(t('label.blocked'), [t('label.image.noText')]);
  } else {
    content = <ImageLabelReady recipe={recipe} typed={typed} />;
  }
  return <div className={styles.body}>{content}</div>;
}

function ImageLabelReady({ recipe, typed }: { recipe: CatalogueRecipe; typed: string }) {
  const { t } = useT();
  const { location } = useSession();
  const { recipes, ingredients, labelConfig } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const logo = useLabelLogo();
  const fonts = useLabelFonts();
  const metrics = useLabelMetrics();
  const checkId = useId();
  const copiesId = useId();
  const copiesNoteId = useId();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // `layout` and `logoPng` say WHAT the drawing was made from, so a drawing made from something else can be told apart.
  const [drawn, setDrawn] = useState<{
    readonly bitmap: Bitmap; readonly png: string; readonly layout: LogoLabelLayout; readonly logoPng: string;
  } | null>(null);
  const [drawFailed, setDrawFailed] = useState(false);
  const [shownWidth, setShownWidth] = useState<number | null>(null);
  const [copiesText, setCopiesText] = useState('1');
  const [note, setNote] = useState<Note>(null);

  const lang = outputLanguage(location);
  const profile = useMemo(() => normalizeLabelProfile(labelConfig), [labelConfig]);
  const choice = imageLabelChoice(labelConfig);
  const logoData = logo.status === 'ready' ? logo.logo : null;
  const usable = metrics !== null && metrics !== 'failed' ? metrics : null;

  // ⚠️⚠️ THE DRAWING DEPENDS ON PLAIN VALUES, NEVER ON THE OBJECTS THEY CAME IN. Every Firestore snapshot (the watches ask
  // for metadata changes too, so one arrives when the server confirms a write nobody changed) hands down NEW objects for
  // the recipe, the label settings and the logo. Keyed on those objects, the layout would be made again, the drawing
  // thrown away and drawn again, and the picture, Print, Copy and the Copies box would vanish and come back — the Copies
  // box losing what was being typed, Print going from under the finger. Strings and numbers are equal when nothing changed.
  const title = labelTitleOf(recipe);
  const businessName = profile.businessName;
  const businessAddress = profile.businessAddress;
  const logoPng = logoData === null ? null : logoData.png;
  const logoWidth = logoData === null ? 0 : logoData.width;
  const logoHeight = logoData === null ? 0 : logoData.height;

  const input: LogoLabelInput | null = useMemo(() => {
    if (logoPng === null) return null;
    return {
      title,
      ingredients: typed,
      header: [businessName, businessAddress],
      logo: { width: logoWidth, height: logoHeight },
      producedOn: producedOnWord(lang),
    };
  }, [title, typed, businessName, businessAddress, logoPng, logoWidth, logoHeight, lang]);

  const layout: LogoLabelLayout | null = useMemo(() => {
    if (input === null || usable === null) return null;
    return layoutLogoLabel(input, (text, font, px) => measureLikePillow(usable, text, font, px));
  }, [input, usable]);

  // The dots, drawn once the logo, the typeface, the widths and a layout that may be printed are all there. A result that
  // arrives after any of them changed is dropped.
  // ⚠️ THE PREVIOUS DRAWING STAYS ON SCREEN WHILE THE NEW ONE IS MADE (Print and Copy off meanwhile, see `drawing`) and is
  // replaced when the new one lands: clearing it first made the whole screen blink on every change. It is cleared only
  // when the inputs no longer make a label that may be printed.
  useEffect(() => {
    setDrawFailed(false);
    if (layout === null || layout.refused || usable === null || logoPng === null || fonts !== 'ready') {
      setDrawn(null);
      return undefined;
    }
    let alive = true;
    void (async () => {
      try {
        const image = await loadLogoImage(logoPng);
        const bitmap = renderLogoLabelBitmap(layout, usable, image);
        const png = bitmapPng(bitmap);
        // ⚠️ DECODED BEFORE PRINT IS PRESSED: window.print() does not wait for a picture that is still being decoded, and
        // a label printed blank is a wasted label. The result is not used; it only warms the browser's own copy.
        await loadLogoImage(png).catch(() => undefined);
        if (alive) setDrawn({ bitmap, png, layout, logoPng });
      } catch {
        if (alive) setDrawFailed(true);
      }
    })();
    return () => { alive = false; };
  }, [layout, usable, logoPng, fonts]);

  // A label that may be printed, drawn from exactly what is in the screen now. Anything else is either not there
  // (refused, or still to load) or a drawing from before the last change, which stays visible but cannot be used.
  const mayDraw = layout !== null && !layout.refused && logoPng !== null && fonts === 'ready';
  const drawing = mayDraw && drawn !== null && (drawn.layout !== layout || drawn.logoPng !== logoPng);
  const current = drawn !== null && !drawing && mayDraw ? drawn : null;

  useEffect(() => {
    if (drawn === null || canvasRef.current === null) return;
    try {
      paintBitmap(canvasRef.current, drawn.bitmap);
    } catch {
      setDrawFailed(true);
    }
  }, [drawn]);

  // Is the preview shown at its real 80 mm, or smaller to fit a narrow screen? Measured, never assumed.
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

  // What the recipe is known to contain, when Mise holds it FULLY declared; else nothing to compare with.
  const declaredCodes = useMemo(() => {
    const result = recipeAllergens(recipe, tables);
    return canLabel(result) ? result.allergens : null;
  }, [recipe, tables]);
  const check = useMemo(() => checkLabelText(typed, { lang, declared: declaredCodes }), [typed, lang, declaredCodes]);
  const hasErrors = check.errors.length > 0;

  const issueText = (issue: CheckIssue): string => {
    switch (issue.kind) {
      case 'lowercase': return t('label.image.issue.lowercase', { word: issue.word });
      case 'hidden': return t('label.image.issue.hidden', { word: issue.word });
      case 'lecithin': return t('label.image.issue.lecithin');
      // The allergen's name is a FOOD word: the label's language, so `lang` is its last argument.
      case 'declared-missing': return t('label.image.issue.declaredMissing', { allergen: allergenName(issue.code, lang) });
      case 'sulphites': return t('label.image.issue.sulphites');
      case 'chocolate': return t('label.image.issue.chocolate');
      case 'margarine': return t('label.image.issue.margarine');
    }
  };

  const copyZpl = async () => {
    if (current === null || hasErrors) return;
    setNote(null);
    let zpl: string;
    try {
      zpl = await imageLabelZpl(current.bitmap, { copies: clampCopies(copiesText), rotate180: choice.rotate180 }, browserDeflate);
    } catch (error) {
      setNote({ key: error instanceof Error && error.message === 'no-compression' ? 'label.image.noCompression' : 'label.copyFailed' });
      return;
    }
    // ⚠️ A JOB THE QUEUE WOULD REFUSE IS STOPPED HERE, in words, before anything is copied: pasted into the printer's setup
    // program it would not be refused by anything and the label would simply not come out right.
    if (zpl.length > MAX_JOB_CHARS) {
      setNote({ key: 'label.image.zplTooLong', params: { n: zpl.length, max: MAX_JOB_CHARS } });
      return;
    }
    const ok = await copyToClipboard(zpl);
    if (ok) announceAction('label-printed');
    setNote({ key: ok ? 'label.image.zplCopied' : 'label.copyFailed' });
  };

  // ⚠️ THE HOST IS THE PRINT'S, NOT THIS SCREEN'S (printHost.tsx explains why it outlives the screen).
  const print = () => {
    if (current === null || hasErrors) return;
    openImagePrintHost(current.png);
    try {
      window.print();
      announceAction('label-printed');
    } catch {
      closePrintHost();
    }
  };

  const neutral = (key: MessageKey): ReactNode => <p className={styles.checking} aria-busy="true">{t(key)}</p>;

  // Missing parts, in the order somebody can fix them: the text is checked by the first half, then the logo, the typeface
  // and the widths.
  let content: ReactNode;
  if (logo.status === 'none' || logo.status === 'unreadable') {
    content = blocked(t('label.blocked'), [t('label.image.noLogo')]);
  } else if (logo.status === 'loading') {
    content = neutral('label.image.logoLoading');
  } else if (logo.status === 'failed') {
    content = blocked(t('label.blocked'), [t('label.image.logoFailed')]);
  } else if (fonts === 'failed') {
    content = blocked(t('label.blocked'), [t('label.preview.fontMissing')]);
  } else if (metrics === 'failed') {
    content = blocked(t('label.blocked'), [t('label.image.metricsFailed')]);
  } else if (fonts === 'loading' || usable === null || layout === null) {
    content = neutral('label.image.preparing');
  } else if (layout.refused) {
    const reasons: string[] = [];
    if (layout.tooLong) reasons.push(t('label.image.tooLong'));
    if (layout.tooWide.includes('header')) reasons.push(t('label.image.headerTooWide'));
    if (layout.tooWide.includes('title')) reasons.push(t('label.image.titleTooWide'));
    if (layout.tooWide.includes('word')) reasons.push(t('label.image.wordTooWide'));
    if (layout.unmeasurable && input !== null) {
      reasons.push(t('label.image.unsupportedChars', { chars: missingChars(usable, input, layout).join(' ') }));
    }
    content = blocked(t('label.image.refused'), reasons);
  } else if (drawFailed) {
    content = blocked(t('label.blocked'), [t('label.image.drawFailed')]);
  } else if (drawn === null) {
    content = neutral('label.image.preparing');
  }

  const measured = shownWidth === null ? null : shownWidth < ACTUAL_PX - 1;
  const mm = { w: '80', h: '60' };
  const picture = showing ? (
    <>
      <canvas ref={canvasRef} className={own.preview} data-image-label="" role="img" aria-label={t('label.image.previewName', mm)} />
      <p className={own.previewNote} hidden={measured === null}>
        {measured === null ? '' : t(measured ? 'label.preview.scaled' : 'label.preview.actualSize', mm)}
      </p>
    </>
  ) : null;

  // The check is shown whenever the label is (or would be) drawn, refused or not: a text that cannot be printed still has
  // mistakes worth knowing about.
  const checkCard = layout !== null ? (
    <section id={checkId} className={own.checkCard} aria-labelledby={`${checkId}-title`}>
      <h3 id={`${checkId}-title`} className={own.checkTitle}>{t('label.image.checkTitle')}</h3>
      {!check.available ? <p className={own.checkNote}>{t('label.image.checkOnlyItalian')}</p> : null}
      {check.available && hasErrors ? (
        <div className={`${own.issues} ${own.errors}`}>
          <p className={own.issuesTitle}>{t('label.image.errorsTitle')}</p>
          <ul className={own.issueList}>
            {check.errors.map((issue, index) => <li key={index}>{issueText(issue)}</li>)}
          </ul>
          <p className={own.fixFirst}>{t('label.image.fixErrors')}</p>
        </div>
      ) : null}
      {check.available && (check.warnings.length > 0 || declaredCodes === null) ? (
        <div className={`${own.issues} ${own.warnings}`}>
          <p className={own.issuesTitle}>{t('label.image.warningsTitle')}</p>
          <ul className={own.issueList}>
            {check.warnings.map((issue, index) => <li key={index}>{issueText(issue)}</li>)}
            {declaredCodes === null ? <li>{t('label.image.notDeclared')}</li> : null}
          </ul>
        </div>
      ) : null}
      {check.available && !hasErrors && check.warnings.length === 0 && declaredCodes !== null ? (
        <p className={own.checkNote}>{t('label.image.checkClean')}</p>
      ) : null}
    </section>
  ) : null;

  // Off while the drawing on screen is from before the last change (it is being replaced), and while the text has errors.
  const off = !showing || drawing || hasErrors;
  const why = hasErrors ? checkId : undefined;

  return (
    <>
      {/* ⚠️ THE STATUS REGION IS ALWAYS THERE, EMPTY OR NOT: only a region that already exists announces what is put into
          it, so the screen reader is told when the label becomes ready or is refused, as the label screen's why-sentence is. */}
      <div role="status" className={own.live}>{content}</div>
      {picture}
      {checkCard}
      {showing ? (
        <div className={styles.caveat}>
          <p className={styles.caveatTitle}>{t('label.caveat.title')}</p>
          <p className={styles.caveatText}>{t('label.caveat.body')}</p>
        </div>
      ) : null}
      {showing ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={`${styles.button} ${styles.printButton}`}
            disabled={off}
            aria-describedby={why}
            onClick={print}
          >
            <Printer aria-hidden="true" />
            <span>{t('label.print')}</span>
          </button>
          <div className={own.zplGroup}>
            <div className={own.copies}>
              <label htmlFor={copiesId}>{t('label.image.copies')}</label>
              <input
                id={copiesId}
                aria-describedby={copiesNoteId}
                type="number"
                min="1"
                max={MAX_IMAGE_COPIES}
                step="1"
                inputMode="numeric"
                className={own.copiesInput}
                value={copiesText}
                onChange={event => { setCopiesText(event.target.value); }}
                onBlur={() => { setCopiesText(String(clampCopies(copiesText))); }}
              />
            </div>
            <p id={copiesNoteId} className={own.copiesNote}>{t('label.image.copiesNote')}</p>
            <button
              type="button"
              className={styles.button}
              disabled={off}
              aria-describedby={why}
              onClick={() => { void copyZpl(); }}
            >
              <span>{t('label.image.copyZpl')}</span>
            </button>
          </div>
          <span role="status" className={styles.status}>{note === null ? '' : t(note.key, note.params)}</span>
        </div>
      ) : null}
    </>
  );
}
