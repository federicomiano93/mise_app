// photo-capture.js — photograph the back of a packet and get its printed ingredient
// list typed into the box on the ingredient's record.
//
// ⚠️ A COPY OF js/catalogue/photo-capture.js, class for class and warning for warning,
// with three differences: every class name is an Orders one (`catalogue.css` is not
// loaded on suppliers.html, and a copied `cat-*` name renders as a bare grey browser
// rectangle with no error anywhere — the `.mgmt-btn` failure this project has now
// shipped twice); its phrases come from `orders.pack.photo.*`; and it hands back TEXT
// rather than a recipe. Written out rather than shared because a feature folder never
// reaches into another's.
//
// ⚠️⚠️ NOTHING HERE EVER SAVES ANYTHING, and nothing here declares an allergen. The
// text goes into the box a person is looking at; the existing matcher then PROPOSES
// tick boxes from it, and no path writes `allergensCheckedAt`. A misread costs a
// correction and can never become a false declaration.
//
// ⚠️ IT IS THE ONLY SCREEN IN THIS PART OF THE APP THAT CANNOT WORK OFFLINE.

import { t, onLanguageChange } from '../i18n.js';
import { el } from './dom.js';
import {
  MAX_EDGE, JPEG_QUALITY, FALLBACK_QUALITY, MAX_PHOTOS, MAX_IMAGE_BYTES,
  fitWithin, base64Of, mediaTypeOf, approxBytes, payloadProblem,
  errorKey, answerKey,
} from '../photo-model.js';
import { readPackFromPhotos } from './firebase-photo.js';

const CAMERA_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>';
const BIN_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>';

// ⚠️ A KEY, NEVER A PHRASE, AND NEVER A t() CALL HERE — this object is built at module
// load, before a venue is open, so a resolved phrase would freeze in whatever language
// the app started in (tests/frozen-phrases.test.mjs).
//
// ⚠️ THE WORDS ARE THIS FEATURE'S OWN and not the Catalogue's: the same code means «no
// recipe in that photograph» there and «no ingredient list on that packet» here.
const BY_KEY = {
  'signed-out': 'orders.pack.photo.err.signedOut',
  'no-location': 'orders.pack.photo.err.failed',
  'no-images': 'orders.pack.photo.err.noImages',
  'too-many-images': 'orders.pack.photo.err.tooMany',
  'image-too-large': 'orders.pack.photo.err.tooLarge',
  'images-too-large': 'orders.pack.photo.err.tooLarge',
  'bad-image': 'orders.pack.photo.err.badImage',
  'not-allowed': 'orders.pack.photo.err.notAllowed',
  'person-limit': 'orders.pack.photo.err.personLimit',
  'venue-limit': 'orders.pack.photo.err.venueLimit',
  'photo-off': 'orders.pack.photo.err.photoOff',
  'read-failed': 'orders.pack.photo.err.failed',
  'too-slow': 'orders.pack.photo.err.tooSlow',
  // Not errors at all — the call worked and the answer was «nothing I can use».
  'nothing-readable': 'orders.pack.photo.err.nothingFound',
  refused: 'orders.pack.photo.err.refused',
  truncated: 'orders.pack.photo.err.tooLong',
  'no-tool': 'orders.pack.photo.err.nothingFound',
  // Raised on the phone, before anything is sent.
  undecodable: 'orders.pack.photo.err.badFormat',
  offline: 'orders.pack.photo.err.offline',
};

// ⚠️ createImageBitmap, NOT FileReader, AND `imageOrientation` IS THE LINE THAT MUST NOT
// BE LOST: a photograph taken in portrait carries its rotation in EXIF, and a canvas
// that ignores it reads a sideways label. It also takes the File directly, so no `blob:`
// URL is ever made — which matters, because the app's Content-Security-Policy allows
// `img-src 'self' data:` and nothing else.
async function shrink(file) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // ⚠️ ALMOST ALWAYS HEIC, off an iPhone, picked from the library rather than taken
    // with the camera. Android cannot decode it at all. There is no fallback path on
    // purpose: a second decoder that works on one platform is a defect that exists only
    // on the other.
    throw new Error('undecodable');
  }
  const { w, h } = fitWithin(bitmap.width, bitmap.height, MAX_EDGE);
  if (!w || !h) { bitmap.close(); throw new Error('undecodable'); }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  let dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  // ⚠️ Quality drops before SIZE does. A softer photograph of small print is still
  // readable; a smaller one is not.
  if (approxBytes(base64Of(dataUrl)) > MAX_IMAGE_BYTES) {
    dataUrl = canvas.toDataURL('image/jpeg', FALLBACK_QUALITY);
  }
  return dataUrl;
}

// `onText(text, notes)` is called once, with what the reader wrote out. It is never
// called for a refusal, a limit or an empty answer — each of those is said on screen
// here, in its own words.
export function renderPackPhotoCapture({ onText }) {
  // The working set. Each entry is { dataUrl } — one string, used twice.
  const photos = [];
  let busy = false;

  // ⚠️ NO CLASS OF ITS OWN BEYOND reg-page. A hook nothing styles is a class name
  // that reads as styling and is not — which is the family of defect this screen's
  // own guard exists to catch. `alg-photo-busy` below is added at RUNTIME and is a
  // selector for js/update-gate.js, not a style.
  const root = el('div', { class: 'reg-page' });

  // ⚠️ EVERY PHRASE IS SET IN paint(), NEVER ONCE AT BUILD TIME, and that is not
  // tidiness. The interface language comes from the VENUE and arrives a moment AFTER
  // the page has drawn itself — so a string written once, here, is frozen in whatever
  // language the app started in.
  const lead = el('p', { class: 'alg-photo-lead' });
  const note = el('p', { class: 'alg-photo-note' });

  const strip = el('div', { class: 'alg-photo-strip' });
  const status = el('p', { class: 'alg-photo-status', role: 'status' });

  const input = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    capture: 'environment',
    multiple: 'multiple',
    class: 'alg-photo-input',
    'aria-hidden': 'true',
    tabindex: '-1',
  });

  // Held in a variable rather than found by a class: the label is written on every
  // paint, and a class nothing styles would be a lie about what it is for.
  const addLabel = el('span', {});
  const addBtn = el('button', {
    class: 'btn-secondary alg-photo-add', type: 'button',
    icon: CAMERA_ICON,
  }, [addLabel]);
  addBtn.addEventListener('click', () => { if (!busy) input.click(); });

  const readBtn = el('button', { class: 'btn-primary alg-photo-read', type: 'button' });
  readBtn.addEventListener('click', () => read());

  function setStatus(key, kind = 'info') {
    status.textContent = key ? t(key) : '';
    status.className = `alg-photo-status alg-photo-status--${kind}`;
  }

  function paint() {
    lead.textContent = t('orders.pack.photo.lead');
    note.textContent = t('orders.pack.photo.note');
    strip.replaceChildren();
    photos.forEach((photo, index) => {
      const thumb = el('div', { class: 'alg-photo-thumb' }, [
        el('img', { src: photo.dataUrl, alt: t('orders.pack.photo.thumbAlt') }),
      ]);
      const remove = el('button', {
        class: 'alg-photo-remove', type: 'button',
        'aria-label': t('orders.pack.photo.remove'),
        icon: BIN_ICON,
      });
      remove.addEventListener('click', () => { if (!busy) { photos.splice(index, 1); paint(); } });
      thumb.appendChild(remove);
      strip.appendChild(thumb);
    });
    strip.hidden = photos.length === 0;

    addLabel.textContent =
      photos.length ? t('orders.pack.photo.addAnother') : t('orders.pack.photo.take');
    addBtn.disabled = busy || photos.length >= MAX_PHOTOS;

    readBtn.textContent = busy ? t('orders.pack.photo.reading') : t('orders.pack.photo.read');
    readBtn.disabled = busy || photos.length === 0;
    readBtn.hidden = photos.length === 0;
  }

  input.addEventListener('change', async () => {
    const chosen = Array.from(input.files || []);
    // The picker is reset immediately so choosing the SAME file twice still fires.
    input.value = '';
    if (!chosen.length) return;

    const room = MAX_PHOTOS - photos.length;
    if (chosen.length > room) setStatus('orders.pack.photo.err.tooMany', 'bad');
    else setStatus('');

    for (const file of chosen.slice(0, room)) {
      try {
        photos.push({ dataUrl: await shrink(file) });
      } catch (err) {
        setStatus(errorKey(err.message === 'undecodable'
          ? { details: { key: 'undecodable' } } : err, BY_KEY), 'bad');
      }
    }
    paint();
  });

  async function read() {
    if (busy || !photos.length) return;

    const images = photos.map(p => ({ mediaType: mediaTypeOf(p.dataUrl), data: base64Of(p.dataUrl) }));
    // Checked here as well as on the server, so somebody on a slow connection is told
    // in an instant rather than after a two-megabyte upload.
    const local = payloadProblem(images);
    if (local) { setStatus(errorKey({ details: { key: local } }, BY_KEY), 'bad'); return; }

    // ⚠️ Asked BEFORE the call, because `unavailable` from a callable is also what a
    // broken function looks like — and this is the one case where «check your
    // connection» is the truth rather than a wrong guess.
    if (navigator.onLine === false) {
      setStatus('orders.pack.photo.err.offline', 'bad');
      return;
    }

    busy = true;
    // ⚠️ THE MARKER THE UPDATE GATE WATCHES. A compulsory update reloading the page now
    // would throw away a read that has already been paid for. It goes on only while the
    // call is in flight, which is the rule js/update-gate.js states.
    root.classList.add('alg-photo-busy');
    setStatus('orders.pack.photo.working', 'busy');
    paint();

    try {
      const answer = await readPackFromPhotos(images);
      if (!answer || !answer.ok) {
        // ⚠️ NOT A FAILURE. The call worked; there was no ingredient list to find.
        // Saying «something went wrong» here is what teaches somebody to stop believing
        // the app when it does work.
        setStatus(answerKey(answer && answer.reason, BY_KEY), 'bad');
        return;
      }
      onText(answer.text, answer.notes);
    } catch (err) {
      setStatus(errorKey(err, BY_KEY), 'bad');
    } finally {
      busy = false;
      root.classList.remove('alg-photo-busy');
      paint();
    }
  }

  // ⚠️ AND THE SAME FOR A LANGUAGE THAT ARRIVES WHILE THIS SCREEN IS OPEN. The overlay
  // is removed with no teardown hook, so a listener registered here outlives the view;
  // `root.isConnected` is the guard. Repainting a detached node is harmless but
  // pointless.
  onLanguageChange(() => { if (root.isConnected) paint(); });

  paint();
  root.append(lead, strip, status, addBtn, readBtn, input, note);
  return { root };
}
