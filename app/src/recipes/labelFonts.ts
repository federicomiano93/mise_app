import { useEffect, useState } from 'react';
import type { LabelFont } from '@mise/shared/label-image-layout';
import sans from '../assets/fonts/label-sans.woff2?url';
import sansBold from '../assets/fonts/label-sans-bold.woff2?url';
import title from '../assets/fonts/label-title.woff2?url';

// The three faces of the IMAGE label (see assets/fonts/LABEL-FONTS.md), loaded from script ONLY when the image label
// screen asks: there is no @font-face in any stylesheet, so no other screen ever downloads them.
//
// ⚠️ A FONT THAT IS NOT LOADED YET DRAWS IN ANOTHER FONT, SILENTLY. A canvas never waits for a font: drawn too early, the
// label would carry the browser's default face while every position was measured for the real one. The screen draws
// only once `useLabelFonts` says «ready».

export const LABEL_FONT_CSS: Readonly<Record<LabelFont, (px: number) => string>> = {
  regular: px => `400 ${px}px "Mise Label Sans"`,
  bold: px => `700 ${px}px "Mise Label Sans"`,
  title: px => `700 ${px}px "Mise Label Title"`,
};

const FACES: readonly { readonly family: string; readonly weight: string; readonly href: string }[] = [
  { family: 'Mise Label Sans', weight: '400', href: sans },
  { family: 'Mise Label Sans', weight: '700', href: sansBold },
  { family: 'Mise Label Title', weight: '700', href: title },
];

let loading: Promise<void> | null = null;

// ⚠️ MEMOISED, BUT A FAILURE IS FORGOTTEN: the next opening of the screen tries again (a tablet that lost its connection
// for a second must not stay without the label until the page is reloaded).
export function loadLabelFonts(): Promise<void> {
  if (loading !== null) return loading;
  const attempt = (async () => {
    if (typeof FontFace !== 'function') throw new Error('no-fontface');
    const faces = FACES.map(f => new FontFace(f.family, `url(${f.href})`, { weight: f.weight, style: 'normal' }));
    await Promise.all(faces.map(face => face.load()));
    faces.forEach(face => { document.fonts.add(face); });
  })();
  loading = attempt;
  attempt.catch(() => { if (loading === attempt) loading = null; });
  return attempt;
}

export function useLabelFonts(): 'loading' | 'ready' | 'failed' {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');
  useEffect(() => {
    let alive = true;
    loadLabelFonts().then(
      () => { if (alive) setState('ready'); },
      () => { if (alive) setState('failed'); },
    );
    return () => { alive = false; };
  }, []);
  return state;
}
