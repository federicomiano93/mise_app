import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { useLocation, useNavigate, useNavigationType } from 'react-router';
import { MAX_PHOTOS, base64Of, mediaTypeOf, payloadProblem } from '@mise/shared/photo-model';
import { noRecipeKey, photoErrorKey } from '@mise/shared/catalogue-photo-model';
import { useDataServices } from '../data/DataContext';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS } from '../shell/Page';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { useStatusMessage } from '../ui/StatusMessage';
import { workingFromDraft } from './editorModel';
import { NEW_OPENER, useHandBack } from './handBack';
import { PhotoImageError, shrinkPhoto } from './photoImage';
import { cameFromEditor, carryOwner, handOver } from './photoCarry';
import { NEW_PATH, RECIPES_PATH } from './recipesPath';
import { useLeave } from './recipesNav';
import styles from './PhotoScreen.module.css';

// Reading a recipe from photographs (a port of js/catalogue/photo-capture.js): up to five photographs, shrunk on the phone,
// sent to the reader, and the answer opened in the ORDINARY new-recipe editor as a working copy.
//
// ⚠️⚠️ NOTHING HERE EVER SAVES ANYTHING. A machine reading handwriting is sometimes confidently wrong, and 100 g read as
// 1000 g looks exactly like a number somebody typed. Every value goes to the editor as a working copy (it starts dirty)
// and waits for the same Save, and the same «Save these changes?», as a recipe typed by hand.
//
// ⚠️ IT IS THE ONLY SCREEN IN THE APP THAT CANNOT WORK OFFLINE: the reader lives somewhere else. So it says so plainly, and
// it never blames the connection for anything but a missing one (the shared model's table).
//
// ⚠️ A READ IN THE AIR IS PAID FOR: the app's `markBusy` is held until the call settles, even if the screen is left, so a
// reload the app starts by itself waits. An answer that lands after the screen has gone opens nothing and sets nothing.

type Photo = { readonly id: number; readonly dataUrl: string };
type Status = { readonly key: MessageKey; readonly kind: 'bad' | 'busy' } | null;

// What the shared model names are keys of the Catalogue's table; the dictionary is the app's, so a key not in it is a
// failing spec (photoKeys.spec.ts), never a blank sentence.
const asKey = (key: string): MessageKey => key as MessageKey;

let nextPhotoId = 0;

export function PhotoScreen() {
  const { t } = useT();
  const { locationId, user } = useSession();
  const services = useDataServices();
  const say = useStatusMessage();
  const handBack = useHandBack();
  const navigate = useNavigate();
  const { state } = useLocation();
  const navigationType = useNavigationType();
  const titleId = useId();
  const title = useRef<HTMLHeadingElement>(null);
  const source = useMemo(() => services.photo(locationId as string), [services, locationId]);

  const [photos, setPhotos] = useState<readonly Photo[]>([]);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [ring, setRing] = useState(false);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // Back is the browser's Back when the screen was opened from the editor (its entry is the one behind), else the list.
  const fromEditor = cameFromEditor(state);
  const leave = useLeave(RECIPES_PATH, () => { handBack.expect(NEW_OPENER); }, cameFromEditor);

  // Opened by a tap the page leaves the focus alone (KEEP_FOCUS): it goes to this title. Not on a POP.
  useEffect(() => {
    if (navigationType !== 'POP') title.current?.focus();
  }, []);

  const full = photos.length >= MAX_PHOTOS;
  const cannotAdd = busy || full;

  async function onChoose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const chosen = Array.from(input.files ?? []);
    // The picker is reset at once so choosing the SAME file twice still fires.
    input.value = '';
    if (chosen.length === 0 || busyRef.current) return;

    const room = MAX_PHOTOS - photos.length;
    setStatus(chosen.length > room ? { key: 'cat.photo.err.tooMany', kind: 'bad' } : null);

    for (const file of chosen.slice(0, Math.max(0, room))) {
      try {
        const dataUrl = await shrinkPhoto(file);
        // A late answer must not refill a closed screen, nor go past the cap when two choices overlap.
        if (!mounted.current) return;
        setPhotos(held => (held.length >= MAX_PHOTOS ? held : [...held, { id: ++nextPhotoId, dataUrl }]));
      } catch (error) {
        if (!mounted.current) return;
        const code = error instanceof PhotoImageError ? error.code : 'bad-image';
        setStatus({ key: asKey(photoErrorKey({ details: { key: code } })), kind: 'bad' });
      }
    }
  }

  async function read() {
    if (busyRef.current || photos.length === 0) return;

    const images = photos.map(photo => ({ mediaType: mediaTypeOf(photo.dataUrl), data: base64Of(photo.dataUrl) }));
    // Checked here as well as on the server, so somebody on a slow connection is told in an instant rather than after a
    // two-megabyte upload.
    const local = payloadProblem(images);
    if (local) {
      setStatus({ key: asKey(photoErrorKey({ details: { key: local } })), kind: 'bad' });
      return;
    }
    // ⚠️ Asked BEFORE the call, because `unavailable` from a callable is also what a broken function looks like — and this
    // is the one case where «check your connection» is the truth rather than a wrong guess.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setStatus({ key: 'cat.photo.err.offline', kind: 'bad' });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setStatus({ key: 'cat.photo.working', kind: 'busy' });
    // ⚠️ HELD BY THE CALL, NOT BY THE SCREEN: released when the call settles, whether or not the screen is still here.
    const release = markBusy();
    let answer: unknown;
    let failure: unknown = null;
    let failed = false;
    try {
      answer = await source.readRecipe(images);
    } catch (error) {
      failed = true;
      failure = error;
    } finally {
      release();
      busyRef.current = false;
    }
    if (!mounted.current) return;
    setBusy(false);

    if (failed) {
      setStatus({ key: asKey(photoErrorKey(failure)), kind: 'bad' });
      return;
    }
    const result = (typeof answer === 'object' && answer !== null ? answer : {}) as {
      ok?: unknown; recipe?: unknown; notes?: { rowsCapped?: unknown } | null; reason?: unknown;
    };
    if (result.ok !== true) {
      // ⚠️ NOT A FAILURE. The call worked; there was no recipe to find. Saying «something went wrong» here is what teaches
      // somebody to stop believing the app when it does work.
      setStatus({ key: asKey(noRecipeKey(result.reason)), kind: 'bad' });
      return;
    }

    // Nothing is saved: the draft is the working copy of a NEW recipe, handed to the editor that opens next.
    handOver(workingFromDraft(result.recipe), carryOwner(user?.uid, locationId));
    if (result.notes?.rowsCapped === true) say(t('cat.photo.capped'));
    if (fromEditor) {
      // The editor's own entry is the one behind this screen: stepping back onto it leaves ONE editor entry in the history,
      // holding the draft (the typed copy it carried is replaced by it).
      void navigate(-1);
    } else {
      void navigate(NEW_PATH, { replace: true, state: KEEP_FOCUS });
    }
  }

  const statusText = status === null ? '' : t(status.key);
  return (
    <section className={styles.screen} aria-labelledby={titleId} aria-busy={busy ? true : undefined}>
      <FormBar backLabel={t('ui.back')} onBack={leave} title={t('cat.photo.title')} titleId={titleId} titleRef={title} />

      <div className={styles.body}>
        <p className={styles.lead}>{t('cat.photo.lead')}</p>

        {photos.length > 0 ? (
          <ul className={styles.thumbs}>
            {photos.map(photo => (
              <li key={photo.id} className={styles.thumb}>
                <img src={photo.dataUrl} alt={t('cat.photo.thumbAlt')} className={styles.image} />
                <Button
                  variant="bare"
                  className={styles.remove}
                  aria-label={t('cat.photo.remove')}
                  isDisabled={busy}
                  onPress={() => { setPhotos(held => held.filter(candidate => candidate.id !== photo.id)); }}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {/* Empty it takes no room; it is on the page before it speaks. */}
        <p
          role="status"
          className={`${styles.status} ${status?.kind === 'bad' ? styles.statusBad : status?.kind === 'busy' ? styles.statusBusy : ''}`}
        >
          {statusText}
        </p>

        <div className={styles.actions}>
          {/* The real file input, inside the label that looks like a button: the camera on a phone, the picker elsewhere. */}
          <label className={styles.take} data-focus-visible={ring ? 'true' : undefined} data-disabled={cannotAdd ? 'true' : undefined}>
            <Camera aria-hidden="true" />
            <span>{t(photos.length > 0 ? 'cat.photo.addAnother' : 'cat.photo.take')}</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              multiple
              disabled={cannotAdd}
              className="visually-hidden"
              onChange={event => { void onChoose(event); }}
              onFocus={event => { setRing(isFocusVisible(event.currentTarget)); }}
              onBlur={() => { setRing(false); }}
            />
          </label>
          <Button variant="primary" isDisabled={busy || photos.length === 0} onPress={() => { void read(); }}>
            {t(busy ? 'cat.photo.reading' : 'cat.photo.read')}
          </Button>
        </div>

        <p className={styles.note}>{t('cat.photo.note')}</p>
      </div>
    </section>
  );
}

// Whether the browser would draw a focus ring on this element (a keyboard reached it, not a tap).
function isFocusVisible(node: HTMLElement): boolean {
  try {
    return node.matches(':focus-visible');
  } catch {
    return true;
  }
}
