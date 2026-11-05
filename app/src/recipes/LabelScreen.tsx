import { useId, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Printer, Send } from 'lucide-react';
import { normalizeShelfLifeDays } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { dateText, normalizeLabelProfile, resolveLabel, sizeIdFor, useByDate } from '@mise/shared/label-template-model';
import type { ResolvedLabel } from '@mise/shared/label-template-model';
import { toZpl, zplFits } from '@mise/shared/label-zpl';
import { canPrintLabel, countryOf, outputLanguage } from '@mise/shared/market';
import type { Country, OutputLanguage } from '@mise/shared/market';
import { buildJob, printerPresence } from '@mise/shared/print-queue-model';
import { roadsFor, whyNoRoad } from '@mise/shared/print-roads';
import type { RoadContext } from '@mise/shared/print-roads';
import { buildLabel, declarationText, LABEL_SHOWS } from '@mise/shared/recipe-label-model';
import type { LabelShows } from '@mise/shared/recipe-label-model';
import { allergensOn } from '@mise/shared/venue-features';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { announceAction } from '../telemetry/usage';
import { FormBar } from '../ui/FormBar';
import { copyToClipboard } from '../ui/clipboard';
import { useSendSheet } from '../ui/SendSheet';
import { useAllergenTables } from './allergenTables';
import { LabelCard } from './LabelCard';
import { LabelSheet } from './LabelSheet';
import type { SheetSource } from './LabelSheet';
import { useLabelFontPreload } from './labelFontPreload';
import { openPrintHost, closePrintHost } from './printHost';
import { useRecipes, useRecipesStore } from './RecipesContext';
import { useLabelShows } from './labelShows';
import { usePresenceClock } from './usePresenceClock';
import { useSheetFit } from './useSheetFit';
import { useStillWaiting } from './useStillWaiting';
import styles from './LabelScreen.module.css';

// What each button of the switch says. KEYS, resolved while drawing: a constant holding the words would freeze the
// language the page booted in (the v1.57.0 defect), and no venue is open when a module is first evaluated.
const SHOW_KEYS: Readonly<Record<LabelShows, MessageKey>> = {
  allergens: 'label.shows.allergens',
  nutrition: 'label.shows.nutrition',
  both: 'label.shows.both',
};

// The language and the country in the sentence that explains why the label is in that language. Both are the
// INTERFACE's words (the sentence is addressed to the person making the label), so they come from the dictionary,
// never from market.ts: an Italian sentence with English words dropped into it is the mistake this avoids.
const LANGUAGE_IN: Readonly<Record<OutputLanguage, MessageKey>> = {
  en: 'language.en.inSentence',
  it: 'language.it.inSentence',
};
const COUNTRY_IN: Readonly<Record<Country, MessageKey>> = { GB: 'country.GB.in', IT: 'country.IT.in' };

type Props = {
  recipe: CatalogueRecipe;
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// The label screen: Back and the recipe's name, then the body. One level below the recipe it was opened from.
export function LabelScreen({ recipe, titleRef, onBack }: Props) {
  const { t } = useT();
  const titleId = useId();
  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={onBack}
        title={recipe.name === '' ? t('cat.label') : recipe.name}
        titleId={titleId}
        titleRef={titleRef}
        sub={<span className={styles.sub}>{t('cat.label')}</span>}
      />
      <LabelBody recipe={recipe} />
    </section>
  );
}

// A resolved label that could be laid out (the other answer is «no paper», which is not «no screen»).
type Laid = Extract<ResolvedLabel, { ok: true }>;

// Millimetres as somebody writes them: «76», not «76.0», and «76.5» when it is.
const fmtMm = (n: number): string => String(Math.round(n * 10) / 10);

// ⚠️⚠️ IT IS A DRAFT FOR A HUMAN TO CHECK, AND THE SCREEN SAYS SO ONCE, PLAINLY, AND NEVER SCROLLS IT AWAY. The app
// knows what it was told about its ingredients. It does not know what else was on the bench this morning, what was
// substituted when the van did not come, or that a supplier quietly changed a recipe. A screen that looks like a
// finished label without saying that is the one way this feature can do harm. (The caveat is on every label
// that is drawn.)
//
// ⚠️ THE SWITCH DECIDES WHAT IS WORKED OUT, not merely what is displayed (buildLabel): asking for allergens only does
// not compute a nutrition table that is then hidden, so an ingredient with no nutrition cannot block an allergen label.
//
// ⚠️ FOUR REFUSALS, EACH WITH A TITLE AND ONE SENTENCE, in this order: allergens off; no country (or one the app does
// not support) — deliberately NOT a fallback to English, an English allergen label in Italy is not «a bit off», it is
// non-compliant; the recipe is not fully declared (a REAL plural over how many ingredients, never `n === 1 ?`, which
// is English's rule written into the code); nothing has a weight. Each is read while drawing, so a switch thrown on
// another phone, or a declaration lost there, shows on the next draw instead of a stale label.
//
// ⚠️ THE FOOD WORDS ARE THE VENUE'S COUNTRY'S (`outputLanguage`, read here while drawing) and everything that tells
// somebody what to tap is the interface's (`t()`). What is copied and sent is `declarationText` WITH the nutrition
// table, in the country's language: a copy in English pasted onto Italian packaging is the defect that rule prevents.
//
// ⚠️ UNTIL THE INGREDIENTS HAVE ARRIVED there is no label and no verdict, only a neutral line (every linked row would
// read «not declared» only because nothing had come yet). UNTIL THE PAPER IS KNOWN (`labelConfigKnown`) the card, Copy
// and Send work, the preview says the size has not arrived, and Print is off: a label laid out on the default paper
// could be the wrong paper, and nothing says so on the paper that comes out.
function LabelBody({ recipe }: { recipe: CatalogueRecipe }) {
  const { t } = useT();
  const { location, locationId, user } = useSession();
  const store = useRecipesStore();
  const { recipes, ingredients, ingredientsLoaded, labelConfig, labelConfigKnown, printAgents } = useRecipes();
  const tables = useAllergenTables(recipes, ingredients);
  const [shows, setShows] = useLabelShows();
  const [send, sendSheet] = useSendSheet();
  const [note, setNote] = useState<MessageKey | null>(null);
  // A job is on its way to the shop computer: Print is dead until it has landed or failed. The ref is the real
  // guard (two taps in one frame both see the state as it was); the state only draws the button off.
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const reasonId = useId();
  const stillWaiting = useStillWaiting(!ingredientsLoaded);
  useLabelFontPreload();

  const lang = outputLanguage(location);
  const allergens = allergensOn(location);
  const printable = canPrintLabel(location) && lang !== null;
  const profile = useMemo(() => normalizeLabelProfile(labelConfig), [labelConfig]);

  const label = useMemo(() => buildLabel(recipe, tables, { shows }), [recipe, tables, shows]);

  // ⚠️ THE DATE IS WORKED OUT FROM TODAY, EVERY TIME THIS SCREEN DRAWS. The recipe knows how long the food keeps;
  // only the morning knows when it was made. A date stored on the recipe would be yesterday's the moment somebody
  // came in. And a recipe with no shelf life produces NO date at all, never today's (useByDate refuses a missing
  // one rather than reading it as zero days, which would print today as a USE BY on food that keeps for a week).
  const due = useByDate(normalizeShelfLifeDays(recipe.shelfLifeDays));
  const dateLine = due !== null && lang !== null ? dateText(due, lang) : '';
  const netWeightG = recipe.netWeightG;

  const laid: ResolvedLabel | null = useMemo(() => {
    if (!label.ok || lang === null || !labelConfigKnown || !allergens || !printable) return null;
    return resolveLabel(label, profile, { netWeightG, dateText: dateLine }, lang);
  }, [label, lang, labelConfigKnown, allergens, printable, profile, netWeightG, dateLine]);
  const sheet: Laid | null = laid !== null && laid.ok ? laid : null;
  // Everything the fit depends on, as one string: the measurement is taken again when it changes, not on every draw.
  const signature = useMemo(() => JSON.stringify(sheet), [sheet]);
  const { hostRef, sheetRef, face, fit } = useSheetFit(sheet, signature);

  // ⚠️ THREE ROADS, DECIDED BY THE SHARED PORT (print-roads.ts) from what is true RIGHT NOW. `printerReady` is the
  // shop computer's heartbeat judged against a clock that moves while this screen is open (usePresenceClock); it
  // is never stored by the app. Firestore's own offline cache can replay the last print-agents document to a phone
  // that opened offline, and the 12-minute stale limit in printerPresence bounds how long that is believed.
  // `zplFits` is the ZPL writer's own estimate (no browser can measure the printer's paper). What the DEVICE can do
  // is asked at draw time, never cached: a road offered that is not there is a button that fails on tap.
  const isZebra = sheet !== null && sheet.printerLanguage === 'zpl';
  const { now, refresh: refreshClock } = usePresenceClock(isZebra);
  const roadContext: RoadContext = {
    printerReady: printerPresence(printAgents, now).ready,
    zplFits: resolved => zplFits(resolved as ResolvedLabel),
    device: { canPrint: typeof window.print === 'function', hasClipboard: typeof navigator !== 'undefined' && !!navigator.clipboard },
  };
  const roads = sheet !== null ? roadsFor(sheet, roadContext) : [];
  // ⚠️ WHEN THE ROAD CHANGES, THE LAST ANSWER GOES. «Copied — paste it onto the printer» beside a button that now
  // says Print, or «Sent to the shop computer» beside «the shop computer is not answering», describes a road that is
  // no longer the one on offer (driven 14 Oct 2026). Cleared while drawing, the React way to follow a changed input.
  const firstRoad = roads[0]?.id ?? null;
  // The first road as of the latest draw, for an answer that arrives after an await (see press()).
  const firstRoadRef = useRef(firstRoad);
  firstRoadRef.current = firstRoad;
  const [noteRoad, setNoteRoad] = useState(firstRoad);
  if (noteRoad !== firstRoad) {
    setNoteRoad(firstRoad);
    if (note !== null) setNote(null);
  }

  const copyText = (): string => (label.ok && lang !== null ? declarationText(label, lang) : '');

  const copy = async () => {
    const ok = await copyToClipboard(copyText());
    setNote(ok ? 'label.copied' : 'label.copyFailed');
  };

  // Put the sheet on paper through the system's dialog.
  //
  // ⚠️ THE HOST IS BUILT NOW AND IS NOT THIS SCREEN'S (printHost.tsx): a direct child of <body> (label-print.css hides
  // everything else with one derived rule), at the size the MEASUREMENT chose, taken away once the print is over AND
  // the person is back in the page. On Android Chrome window.print() returns at once and the dialog stays up while
  // the page carries on; a host that went with this screen would print a blank page. It is NOT called `.preview-overlay`: that class holds back a
  // compulsory update for as long as it exists in the current app, and the habit is kept.
  const print = () => {
    if (sheet === null || fit === null || !fit.measured || !fit.fits || roads[0]?.id !== 'os-print') return;
    openPrintHost(sheet as SheetSource, fit.fontMm, sizeIdFor(profile));
    try {
      window.print();
      announceAction('label-printed');
    } catch {
      closePrintHost();
    }
  };

  // The agent road: the label's ZPL goes into the queue the shop computer reads.
  //
  // ⚠️ IT CAN ONLY EVER SAY «SENT», NEVER «PRINTED»: raw bytes to a printer come back with nothing, so the app cannot
  // know the paper came out and must not imply it. And it is NOT local-first (the source awaits the write): a tap
  // that reported success without the job having reached the database would leave somebody standing at a printer
  // that never moves. `createdBy` is the signed-in account and `bakery` the open venue, both read at tap time —
  // the rules check them against the account and against the folder the job lands in.
  const sendToShopComputer = async (resolved: Laid): Promise<boolean> => {
    const payload = toZpl(resolved, { copies: 1 });
    const job = payload === '' ? null : buildJob({ payload, copies: 1, createdBy: user?.uid, bakery: locationId, now: Date.now() });
    if (job === null) return false;
    try {
      await store.queuePrintJob(job as unknown as Record<string, unknown>);
      return true;
    } catch {
      return false;
    }
  };

  // The ZPL road: the printer's own language to the clipboard, to be dropped onto the printer on the shop computer.
  // ⚠️ copyToClipboard, never navigator.clipboard.writeText: the write can hang when the page loses focus.
  const copyPrinterCode = async (resolved: Laid): Promise<boolean> => {
    const payload = toZpl(resolved, { copies: 1 });
    return payload !== '' && await copyToClipboard(payload);
  };

  // The Print button, by the road it is showing. Still needs a measured fit that fits, as the system's dialog does.
  const press = async () => {
    const road = roads[0];
    if (sheet === null || fit === null || !fit.measured || !fit.fits || road === undefined) return;
    if (road.id === 'os-print') {
      print();
      return;
    }
    // ⚠️ ONLY A SECOND AGENT SEND IS REFUSED while one is in flight: queueing is a network round trip, two taps are
    // two labels, and the second one is the one nobody wanted. The guard is on the agent road ALONE because a send
    // that never lands (an offline phone: addDoc never resolves, no timeout, by decision) must not also kill the
    // clipboard fallback the screen offers once the heartbeat has gone stale.
    if (road.id === 'agent' && sendingRef.current) return;
    if (road.id === 'agent') {
      // ⚠️ RE-JUDGED AT TAP TIME: the 30 s clock may be behind (a phone woken from sleep whose interval has not
      // fired yet). A job queued for a computer that stopped answering is a tap that looks like it worked. Queue
      // nothing, and re-read the clock so the screen redraws with the true road and the «not answering» sentence.
      if (!printerPresence(printAgents, Date.now()).ready) {
        refreshClock();
        return;
      }
      sendingRef.current = true;
      setSending(true);
    }
    // The old sentence goes first, so an answer is never mistaken for the one before it.
    setNote(null);
    let ok = false;
    try {
      ok = road.id === 'agent' ? await sendToShopComputer(sheet) : await copyPrinterCode(sheet);
    } finally {
      if (road.id === 'agent') {
        sendingRef.current = false;
        setSending(false);
      }
    }
    if (ok) announceAction('label-printed');
    // ⚠️ AN ANSWER FOR A ROAD THAT IS NO LONGER ON OFFER IS NOT SHOWN: the note is cleared when the road changes
    // (above), and a send that lands afterwards would put «Sent to the shop computer» back beside «not answering».
    if (firstRoadRef.current !== road.id) return;
    if (road.id === 'agent') setNote(ok ? 'label.print.queued' : 'label.print.queueFailed');
    else setNote(ok ? 'label.print.zplCopied' : 'label.copyFailed');
  };

  const blocked = (sentence: string) => (
    <div className={styles.blocked}>
      <p className={styles.blockedTitle}>{t('label.blocked')}</p>
      <p className={styles.blockedText}>{sentence}</p>
    </div>
  );

  let content;
  if (!allergens) {
    content = blocked(t('label.blocked.allergensOff'));
  } else if (lang === null || !printable) {
    content = blocked(t('label.blocked.noCountry'));
  } else if (!ingredientsLoaded) {
    content = (
      <div>
        <p className={styles.checking} aria-busy="true">{t('recipes.allergensChecking')}</p>
        {stillWaiting ? <p className={styles.checking}>{t('recipes.allergensStillWaiting')}</p> : null}
      </div>
    );
  } else if (!label.ok) {
    content = blocked(
      label.reason === 'no-ingredients'
        ? t('label.blocked.noWeights')
        : t('label.blocked.notDeclared', { n: label.gaps.length }),
    );
  } else {
    const width = sheet === null ? '' : fmtMm(sheet.widthMm);
    const height = sheet === null ? '' : fmtMm(sheet.heightMm);
    const tooBig = sheet === null ? '' : t('label.print.tooBig', { w: width, h: height });

    // ⚠️ FOUR REASONS, FOUR SENTENCES, IN THIS ORDER. «It will not fit» sends somebody to buy bigger labels; «the shop
    // computer is not answering» sends them to switch it on; «this device cannot reach a printer» sends them to a
    // computer that can. One sentence for all of them sends most people to the wrong place. And the venue's printer
    // decides which roads exist, not only the device. A fallback road may replace the road; never the explanation.
    let why: string | null = null;
    if (sheet !== null) {
      const reason = whyNoRoad(sheet, roadContext);
      if (face === 'failed') why = t('label.preview.fontMissing');
      else if (fit !== null && fit.measured && !fit.fits) why = tooBig;
      else if (reason === 'too-big-for-printer') why = tooBig;
      else if (sheet.printerLanguage === 'zpl' && roadContext.printerReady !== true) why = t('label.print.printerOffline');
      else if (roads.length === 0) why = t('label.print.noRoad');
    }

    // ⚠️ DISABLED, NOT HIDDEN: a missing button is a feature somebody goes looking for; a disabled one beside the
    // sentence explaining it is an answer. And it is the MEASUREMENT that enables it — never the estimate, and
    // never an answer from a node nothing could measure.
    const canPress = sheet !== null && fit !== null && fit.measured && fit.fits && roads.length > 0;
    // ⚠️ THE BUTTON SAYS WHAT IT WILL DO: on a Zebra it queues or copies instead of opening a dialog, and a button
    // called «Print» that silently copies is a button nobody trusts twice. The road carries its own words (a KEY).
    const reasonIds = [labelConfigKnown ? null : `${reasonId}-paper`, why === null ? null : `${reasonId}-why`]
      .filter((id): id is string => id !== null).join(' ');
    const printWords: MessageKey = roads[0] === undefined ? 'label.print' : roads[0].labelKey as MessageKey;
    const measured = fit !== null && fit.measured && sheet !== null ? fit : null;

    content = (
      <>
        {sheet !== null ? (
          <div className="lab-preview" ref={hostRef}>
            <LabelSheet ref={sheetRef} resolved={sheet as SheetSource} fontMm={fit?.fontMm ?? sheet.fontMm} />
          </div>
        ) : null}
        {sheet !== null ? (
          <p className="lab-preview-note" hidden={measured === null}>
            {measured === null ? '' : t(measured.factor < 1 ? 'label.preview.scaled' : 'label.preview.actualSize', { w: width, h: height })}
          </p>
        ) : null}
        {/* ⚠️ THE WHY IS A POLITE LIVE REGION, AND THE REGION IS ALWAYS THERE: the sentence inside it comes and goes (a
            resize, the typeface arriving), and only a region that already exists announces what is put into it — once,
            not on every draw. The Print button points at the sentence when it is off for a reason. */}
        <div role="status">
          {labelConfigKnown ? null : <p className="lab-nofit" id={`${reasonId}-paper`}>{t('label.preview.paperUnknown')}</p>}
          {why === null ? null : <p className="lab-nofit" id={`${reasonId}-why`}>{why}</p>}
        </div>

        <LabelCard label={label} shows={shows} />

        <div className={styles.language}>
          <p className={styles.languageLine}>
            {t('label.languageNote', {
              language: t(LANGUAGE_IN[lang]),
              country: countryWords(t, countryOf(location)),
            })}
          </p>
          <p className={styles.languageLine}>{t('label.ingredientNamesNote')}</p>
        </div>

        <div className={styles.caveat}>
          <p className={styles.caveatTitle}>{t('label.caveat.title')}</p>
          <p className={styles.caveatText}>{t('label.caveat.body')}</p>
        </div>

        <div className={styles.actions}>
          {/* A paper that could not be laid out has no Print button at all (no paper is not no screen); an unknown
              paper has one, off. */}
          {laid !== null && !laid.ok ? null : (
            <button
              type="button"
              className={`${styles.button} ${styles.printButton}`}
              disabled={!canPress || (sending && roads[0]?.id === 'agent')}
              aria-describedby={!canPress && reasonIds !== '' ? reasonIds : undefined}
              onClick={() => { void press(); }}
            >
              <Printer aria-hidden="true" />
              <span>{t(printWords)}</span>
            </button>
          )}
          <button type="button" className={styles.button} onClick={() => { void copy(); }}>
            <span>{t('label.copy')}</span>
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => { send({ subject: label.name || '', text: copyText() }); }}
          >
            <Send aria-hidden="true" />
            <span>{t('ui.send')}</span>
          </button>
          <span role="status" className={styles.status}>{note === null ? '' : t(note)}</span>
        </div>
        {/* The mail road OPENS the mail app, it does not send: the sheet says so where it is read. */}
        {sendSheet}
      </>
    );
  }

  return (
    <div className={styles.body}>
      <div className={styles.switch} role="group" aria-label={t('label.whatItShows')}>
        {LABEL_SHOWS.map(key => (
          <button
            key={key}
            type="button"
            className={key === shows ? `${styles.switchButton} ${styles.switchOn}` : styles.switchButton}
            aria-pressed={key === shows}
            onClick={() => { setShows(key); }}
          >
            {t(SHOW_KEYS[key])}
          </button>
        ))}
      </div>
      {content}
    </div>
  );
}

// «in the United Kingdom» / «in Italy»: the whole phrase per country, because Italian takes the article for one and
// not the other. A venue with no country never reaches this (the screen has refused already).
function countryWords(t: (key: MessageKey) => string, country: Country | null): string {
  return country === null ? '' : t(COUNTRY_IN[country]);
}
