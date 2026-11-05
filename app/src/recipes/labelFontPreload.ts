import { useEffect } from 'react';
import latin from '../assets/fonts/manrope-latin.woff2?url';
import latinExt from '../assets/fonts/manrope-latin-ext.woff2?url';

// Asks the browser for the label's typeface as soon as the label screen opens, instead of when the sheet is first
// drawn: Print stays off until Manrope is ready (useSheetFit.ts), so the sooner it arrives, the sooner it works.
//
// The URLs are the SAME assets label-print.css names in its @font-face (Vite hashes by content, so one file has one
// address): a preload for a different address would download the font twice. `crossorigin` is required even for a
// same-origin font, or the browser fetches it twice (fonts are always fetched in CORS mode).
//
// The links belong to the screen: added on mount, removed on unmount. They carry no style, so the page's CSP
// (`style-src 'self'`) has nothing to refuse.
export function useLabelFontPreload(): void {
  useEffect(() => {
    const links = [latin, latinExt].map(href => {
      const link = document.createElement('link');
      link.setAttribute('rel', 'preload');
      link.setAttribute('as', 'font');
      link.setAttribute('type', 'font/woff2');
      link.setAttribute('crossorigin', 'anonymous');
      link.setAttribute('href', href);
      document.head.appendChild(link);
      return link;
    });
    return () => { links.forEach(link => { link.remove(); }); };
  }, []);
}
