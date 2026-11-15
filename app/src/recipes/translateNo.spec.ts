import { describe, expect, it } from 'vitest';
import cardSource from './LabelCard.tsx?raw';
import declarationSource from './DeclarationCard.tsx?raw';
import sheetSource from './LabelSheet.tsx?raw';

// ⚠️⚠️ THE LABEL'S WORDS ARE NEVER MACHINE-TRANSLATED. Found on the lab tablet (13 Oct 2026): Chrome offered to
// translate the page because the app's language was not the tablet's, and a yes would have rewritten the allergen
// names on screen and on the printed sheet. The country decides these words (the i18n-labels rule), so every element
// that holds them carries translate="no" — and the headings and caveats addressed to the reader do not.
// The printed sheet is also pinned byte for byte against the current app's in LabelSheet.spec.tsx.
const withoutComments = (src: string): string => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

describe('translate="no" on the label and the declaration', () => {
  it('marks the printed sheet', () => {
    expect(withoutComments(sheetSource)).toMatch(/className="lab-sheet"\s+translate="no"/);
  });

  it('marks the readable label card', () => {
    expect(withoutComments(cardSource)).toMatch(/<div className=\{styles\.card\} translate="no">/);
  });

  it('marks the declaration\'s list, «Contains» and traces — and not its caveat', () => {
    const src = withoutComments(declarationSource);
    for (const part of ['list', 'contains', 'traces']) {
      expect(src).toMatch(new RegExp(`<p className=\\{styles\\.${part}\\} translate="no">`));
    }
    expect(src).toMatch(/<p className=\{styles\.caveat\}>/);
  });
});
