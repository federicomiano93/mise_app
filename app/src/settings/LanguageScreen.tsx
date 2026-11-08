import { useEffect, useId, useRef, useState } from 'react';
import { canPrintLabel, countryOf, outputLanguage } from '@mise/shared/market';
import { useT } from '../i18n/useT';
import type { Language } from '../i18n/i18n';
import { useSession, useSessionStore } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { useAlert } from '../ui/useAlert';
import { pageReload } from './pageReload';
import { SettingsSubScreen } from './SettingsSubScreen';
import { useSettingsSource } from './useSettingsSource';
import styles from './LanguageScreen.module.css';

// ⚠️ EACH LANGUAGE NAMES ITSELF, IN ITSELF. «Italiano», not «Italian» — somebody looking for their own language is looking for the word
// they would use for it, and that is the one word on this screen that must not be translated, so it is not a message key.
const LANGUAGES: readonly { readonly code: Language; readonly name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'it', name: 'Italiano' },
];

// «App language» (owner, manager and head chef — SettingsSection keeps everybody else out; the Cloud Function refuses them too).
// A port of js/staff/language.js: what everybody who works here reads on screen, chosen from the languages Mise has.
//
// ⚠️⚠️ IT SAYS, EVERY TIME, THAT IT DOES NOT MOVE THE LABELS. An allergen label must be in the language of the country the food is SOLD in
// (retained Reg. 1169/2011), so the label follows the venue's COUNTRY and nothing else. Somebody who set the app to Italian and assumed
// their English labels had followed would be wrong in the one place this app can hurt a person. The sentence is beside the choice, not
// in a footnote, and it NAMES the country: «printed in English because this business sells in the United Kingdom» is a fact somebody can
// check. It is also the only place this screen touches the label: facts about it, never its words (nothing here may import a label-word
// function — label-separation.spec.ts).
//
// ⚠️ AND IT RELOADS. Every screen reads its words while it draws, but dozens are already drawn when the change returns; repainting all of
// them from here is a promise nobody could keep. The source has already made the phone hear of the new language from the SERVER, so the
// reload reads the new venue, not the stale cached one.
export function LanguageScreen() {
  const { t, lang } = useT();
  const { location } = useSession();
  const sessionStore = useSessionStore();
  const source = useSettingsSource();
  const [alert, alertDialog] = useAlert();
  const [saving, setSaving] = useState(false);
  const ids = useId();
  const buttons = useRef(new Map<Language, HTMLButtonElement>());
  // The button that was pressed, owed the focus once a failure has been read and the buttons are enabled again.
  const [refocus, setRefocus] = useState<Language | null>(null);

  useEffect(() => {
    if (refocus === null || saving) return;
    buttons.current.get(refocus)?.focus();
    setRefocus(null);
  }, [refocus, saving]);

  // The language has changed on the server: the session's copy of the venue is read again (so the rest of the app holds the fresh venue)
  // and the page reloads — but only when nobody is typing (pageReload.reloadWhenIdle).
  async function changed(): Promise<void> {
    await sessionStore.refreshLocation();
    pageReload.reloadWhenIdle();
  }

  async function choose(language: Language): Promise<void> {
    setSaving(true);
    try {
      await source.setLanguage(language);
    } catch (err) {
      console.error('Changing the language failed:', err);
      // A failure may still have reached the server (a cold function that outlived the phone's wait): if the venue now speaks
      // the chosen language, the change happened, and the page reloads as it would have.
      const truth = await source.readVenueFromServer().catch(() => null);
      if (truth && truth['language'] === language) { await changed(); return; }
      setSaving(false);
      await alert({ message: t('lang.err.save'), okLabel: t('common.ok') });
      setRefocus(language);
      return;
    }
    // Left saving on purpose: the page is going away, and a button that came back for an instant would invite a second tap.
    await changed();
  }

  return (
    <SettingsSubScreen door="language" title={t('lang.title')} backDisabled={saving}>
      <p className={styles.intro}>{t('lang.intro')}</p>
      <ul className={styles.list}>
        {LANGUAGES.map(({ code, name }) => {
          const inUse = code === lang;
          // ⚠️ THE BUTTON IS NAMED WITH ITS LANGUAGE: «Italiano, Use this», not a bare «Use this» heard while tabbing. Its own visible
          // words stay in the name (WCAG 2.5.3).
          const nameId = `${ids}-${code}-name`;
          const actionId = `${ids}-${code}-action`;
          return (
            <li key={code} className={styles.row}>
              <span id={nameId} className={styles.name} lang={code}>{name}</span>
              <Button
                ref={node => {
                  if (node) buttons.current.set(code, node);
                  else buttons.current.delete(code);
                }}
                variant={inUse ? 'secondary' : 'primary'}
                aria-pressed={inUse}
                aria-labelledby={`${nameId} ${actionId}`}
                isDisabled={inUse || saving}
                onPress={() => { void choose(code); }}
              >
                <span id={actionId}>{inUse ? t('lang.inUse') : t('lang.use')}</span>
              </Button>
            </li>
          );
        })}
      </ul>
      <p className={styles.note}>{labelSentence(location, t)}</p>
      {/* There from the start, so what it says is announced. */}
      <p role="status" className={styles.status}>{saving ? t('lang.saving') : ''}</p>
      {alertDialog}
    </SettingsSubScreen>
  );
}

// What this venue's labels are printed in, and why. A venue with no country prints no label at all (shared market) — saying so here is
// more use than silence, because it is the one thing that stops a label existing.
//
// ⚠️ THE NAMES COME FROM THE INTERFACE, NOT FROM THE LABEL'S WORDS: this sentence is read by whoever is looking at the screen, so
// «inglese» and «Regno Unito» — an Italian sentence with English words dropped into it is the first version's bug.
function labelSentence(location: unknown, t: ReturnType<typeof useT>['t']): string {
  const country = countryOf(location);
  const output = outputLanguage(location);
  if (!canPrintLabel(location) || !country || !output) return t('lang.labels.noCountry');
  return t('lang.labels', {
    country: t(`country.${country}.in`),
    language: t(`language.${output}.inSentence`),
  });
}
