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
// ⚠️ AGAIN WHEN SOMETHING THAT CHANGES THE ANSWER CHANGES: the label or the paper (`signature`), the window
// (resize, a tablet turned round), and the typeface (the sheet is set in Manrope, which may arrive after the first
// measurement — a measurement taken in the fallback face would be about another label).

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

export function useSheetFit(source: Source | null, signature: string) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef(source);
  const signatureRef = useRef(signature);
  const [fit, setFit] = useState<SheetFit | null>(null);

  useLayoutEffect(() => {
    sourceRef.current = source;
    signatureRef.current = signature;
  });

  const measure = useCallback(() => {
    const host = hostRef.current;
    const sheet = sheetRef.current;
    const resolved = sourceRef.current;
    if (!host || !sheet || !resolved) return;

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

  // Once the sheet is in the document, and again whenever the label or the paper changes.
  useLayoutEffect(() => {
    measure();
  }, [signature, measure]);

  // The window turned or resized; the typeface arrived.
  useEffect(() => {
    window.addEventListener('resize', measure);
    const fonts = typeof document === 'undefined' ? undefined : document.fonts;
    fonts?.addEventListener?.('loadingdone', measure);
    return () => {
      window.removeEventListener('resize', measure);
      fonts?.removeEventListener?.('loadingdone', measure);
    };
  }, [measure]);

  return { hostRef, sheetRef, fit: fit !== null && fit.signature === signature ? fit : null };
}
