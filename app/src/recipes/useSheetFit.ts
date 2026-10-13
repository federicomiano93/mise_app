import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fitFont, fitWidthFactor, scaledHostHeightPx } from '@mise/shared/label-sheet';

// The measurement half of the label's preview: the DOM half that `label-print.js` called fitSheet() and
// fitPreviewWidth(), over the shared decisions (`fitFont`, `fitWidthFactor`) in shared/src/label-sheet.ts.
//
// ⚠️⚠️ THE MEASUREMENT IS THE GATE, NOT THE ESTIMATE. The model works out a starting size under Node, where nothing
// can measure text; here the sheet is on the screen and is asked whether it overflowed. Only that answer lets the
// Print button live. And an answer that was never taken is NOT «it fits»: a node that is not in the document, or
// that has no width, reports every height as zero, and zero against zero reads as fitting — for every label ever
// made, including the ones that do not fit. `fitFont` never lets an unmeasured sheet fit; this file reports
// `measured: false` for exactly those cases. (jsdom has no layout: every sheet there is unmeasured, which the specs
// rely on.)
//
// ⚠️ MEASURED FIRST, SCALED SECOND. The fit is taken on the untouched sheet (any scale from the last pass is taken
// off first); only then is the preview shrunk to the room there is. The sheet keeps its true millimetres: the print
// builds its own copy and never sees the scale.
//
// ⚠️ AGAIN WHEN SOMETHING THAT CHANGES THE ANSWER CHANGES: the label or the paper (`signature`) and the window
// (resize, a tablet turned round).
//
// ⚠️⚠️ NEVER MEASURED IN THE FALLBACK TYPEFACE. The sheet is set in Manrope with font-display: swap, so for a moment
// it is drawn in a narrower system face. A size chosen then would fit on screen and spill on paper, the last lines
// («Contains») clipped. Until Manrope is ready the sheet is UNMEASURED (Print stays off); the measurement is taken when
// `document.fonts.load()` resolves (which also resolves when the face was loaded long before this screen listened) or
// `loadingdone` fires. If the face cannot be loaded at all the answer is `face: 'failed'` and Print stays off for good:
// the screen says why. Where `document.fonts` does not exist (an old browser, jsdom) the sheet behaves as before.

export interface SheetFit {
  // What `signature` this answer was taken for: an answer for another label or paper is not one for this.
  readonly signature: string;
  readonly fontMm: number;
  readonly fits: boolean;
  readonly measured: boolean;
  // The factor the preview was shrunk by (1 = actual size).
  readonly factor: number;
}

interface Source {
  readonly fontMm: number;
  readonly minFontMm: number;
}

// The weights the sheet is drawn in (label-print.css: regular, the bold name and «Contains», the allergen at 800).
const WEIGHTS = ['400', '700', '800'] as const;
const faceQuery = (weight: string): string => `${weight} 1em Manrope`;

export type Face = 'waiting' | 'ready' | 'failed';

// Is the face already usable, right now, without waiting for anything?
function faceIsReady(fonts: FontFaceSet | undefined): boolean {
  if (!fonts) return true;
  if (fonts.status === 'loading') return false;
  if (typeof fonts.check !== 'function') return true;
  try {
    return WEIGHTS.every(weight => fonts.check(faceQuery(weight)));
  } catch {
    return false;
  }
}

const fontSet = (): FontFaceSet | undefined => (typeof document === 'undefined' ? undefined : document.fonts);

export function useSheetFit(source: Source | null, signature: string) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(source);
  const signatureRef = useRef(signature);
  const [fit, setFit] = useState<SheetFit | null>(null);
  const [face, setFace] = useState<Face>(() => (faceIsReady(fontSet()) ? 'ready' : 'waiting'));
  const faceRef = useRef(face);

  useLayoutEffect(() => {
    sourceRef.current = source;
    signatureRef.current = signature;
    faceRef.current = face;
  });

  const measure = useCallback(() => {
    const host = hostRef.current;
    const sheet = sheetRef.current;
    const resolved = sourceRef.current;
    if (!host || !sheet || !resolved) return;
    // ⚠️ NO MEASUREMENT IN THE FALLBACK FACE (see the head of this file): no answer at all, which is not «it fits».
    if (faceRef.current !== 'ready') return;

    // The untouched sheet at the size the model chose, no scale on it.
    sheet.style.transform = '';
    host.style.height = '';
    sheet.style.fontSize = `${resolved.fontMm}mm`;

    const result = fitFont(resolved, (fontMm) => {
      if (!host.isConnected || host.clientWidth <= 0) return null;
      sheet.style.fontSize = `${fontMm}mm`;
      // The sheet clips (overflow: hidden) so that scrollHeight still reports the full height of what did not fit.
      return sheet.scrollHeight - sheet.clientHeight;
    });

    let factor = 1;
    if (result.measured) {
      // ⚠️ THE OVERFLOW IS STOPPED BEFORE THE ROOM IS MEASURED: a sheet wider than its box widens the page's own
      // scrollable area, which widens the box, and the room asked for while overflowing exists only because of
      // the overflow. Both axes: with only one set, CSS computes the other as `auto` and a scrollbar clips the edge.
      host.style.overflowX = 'hidden';
      host.style.overflowY = 'hidden';
      factor = fitWidthFactor(sheet.offsetWidth, () => host.clientWidth, (next) => {
        // top CENTRE, not top left: the layout box is centred in the host, and scaling towards a corner that is
        // already off-screen would move the sheet further off.
        sheet.style.transformOrigin = 'top center';
        sheet.style.transform = `scale(${next})`;
        // The layout box has not changed size, only its painting: without this the host keeps a gap under a
        // sheet that no longer reaches the bottom of it.
        host.style.height = `${scaledHostHeightPx(sheet.offsetHeight, next)}px`;
      });
      if (factor === 1) {
        host.style.overflowX = '';
        host.style.overflowY = '';
        host.style.height = '';
      }
    }

    const next: SheetFit = {
      signature: signatureRef.current,
      fontMm: result.fontMm,
      fits: result.fits,
      measured: result.measured,
      factor,
    };
    setFit(before => (
      before !== null && before.signature === next.signature && before.fontMm === next.fontMm
      && before.fits === next.fits && before.measured === next.measured && before.factor === next.factor
        ? before : next
    ));
  }, []);

  // Once the sheet is in the document, and again whenever the label, the paper or the typeface's state changes.
  useLayoutEffect(() => {
    measure();
  }, [signature, face, measure]);

  // The window turned or resized.
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => { window.removeEventListener('resize', measure); };
  }, [measure]);

  // The typeface. `load()` is asked for every weight the sheet uses: it resolves with the faces (empty when none is
  // declared) and rejects when the file cannot be fetched. `loadingdone` covers a later change (another subset).
  useEffect(() => {
    const fonts = fontSet();
    if (!fonts) return undefined;
    let alive = true;
    const settle = () => {
      if (!alive) return;
      if (faceIsReady(fonts)) setFace('ready');
      measure();
    };
    fonts.addEventListener?.('loadingdone', settle);
    if (typeof fonts.load === 'function') {
      Promise.all(WEIGHTS.map(weight => fonts.load(faceQuery(weight)))).then(
        loaded => {
          if (!alive) return;
          setFace(loaded.every(list => list.length === 0) ? 'failed' : 'ready');
        },
        () => { if (alive) setFace('failed'); },
      );
    }
    return () => {
      alive = false;
      fonts.removeEventListener?.('loadingdone', settle);
    };
  }, [measure]);

  return { hostRef, sheetRef, face, fit: fit !== null && fit.signature === signature ? fit : null };
}
