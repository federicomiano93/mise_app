import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { LABEL_CORPUS, MADE_ON_PARTS, TEMPLATE_PROFILES } from '@mise/shared/fixtures/label-corpus';
import { dateText, resolveLabel, useByDate } from '@mise/shared/label-template-model';
import { outputLanguage } from '@mise/shared/market';
import { buildLabel } from '@mise/shared/recipe-label-model';
import { LabelSheet } from './LabelSheet';
import type { SheetSource } from './LabelSheet';

// The printed sheet, drawn by React, against the CURRENT app's `buildSheet()` (parity doc item 110c).
//
// ⚠️ THE TWO MUST BE BYTE-EQUAL as outerHTML: the same elements, the same class names, the same style properties in the
// same order, the same text. The preview and the paper of one app are one node; this proves the two APPS draw the
// same node, so the label that comes out of a printer does not change the day Mise 2 replaces the current app.
//
// The original is loaded through `import.meta.glob` (a file outside this package, lazily, typed by hand): importing
// a .js file straight would need `allowJs` for the whole app.
type LegacySheet = { buildSheet: (resolved: unknown, fontMm?: number) => HTMLElement };
const [loadLegacy] = Object.values(import.meta.glob<LegacySheet>('../../../js/catalogue/label-print.js'));
if (!loadLegacy) throw new Error('js/catalogue/label-print.js is not where the spec looks for it');

const MADE_ON = new Date(...MADE_ON_PARTS);
const VENUES = { GB: { country: 'GB' }, IT: { country: 'IT' } } as const;

describe('LabelSheet', () => {
  it('draws exactly the markup of the current app\'s buildSheet(), for the whole label corpus × the three profiles × GB and IT', async () => {
    const { buildSheet } = await loadLegacy();
    let compared = 0;
    for (const entry of LABEL_CORPUS) {
      const label = buildLabel(entry.recipe, entry.tables, { shows: 'both' });
      if (!label.ok) continue;
      for (const [profileName, profile] of Object.entries(TEMPLATE_PROFILES)) {
        for (const [venueName, location] of Object.entries(VENUES)) {
          const lang = outputLanguage(location);
          const extras = {
            netWeightG: 1200,
            dateText: dateText(useByDate(3, MADE_ON), lang),
          };
          const resolved = resolveLabel(label, profile, extras, lang);
          if (!resolved.ok) continue;
          // The starting size, and a step the fit loop would have taken.
          for (const fontMm of [resolved.fontMm, Math.round((resolved.fontMm - 0.35) * 100) / 100]) {
            const { container, unmount } = render(<LabelSheet resolved={resolved as SheetSource} fontMm={fontMm} />);
            const ours = (container.firstElementChild as HTMLElement).outerHTML;
            const theirs = buildSheet(resolved, fontMm).outerHTML;
            expect(ours, `${entry.id} · ${profileName} · ${venueName} · ${fontMm} mm`).toBe(theirs);
            compared += 1;
            unmount();
          }
        }
      }
    }
    // A comparison that compared nothing would pass for ever.
    expect(compared).toBeGreaterThan(100);
  });

  it('shows the resolved font size when none is passed', async () => {
    const { buildSheet } = await loadLegacy();
    const entry = LABEL_CORPUS.find(candidate => buildLabel(candidate.recipe, candidate.tables).ok);
    if (!entry) throw new Error('the corpus has no label that can be built');
    const label = buildLabel(entry.recipe, entry.tables);
    const resolved = resolveLabel(label, TEMPLATE_PROFILES.default, {}, 'en');
    if (!resolved.ok) throw new Error('the default paper could not be laid out');
    const { container } = render(<LabelSheet resolved={resolved as SheetSource} />);
    expect((container.firstElementChild as HTMLElement).outerHTML).toBe(buildSheet(resolved).outerHTML);
  });

  it('draws an allergen in bold on a print-dialog printer and in CAPITALS, with no bold, on a Zebra', () => {
    const entry = LABEL_CORPUS.find(candidate => {
      const label = buildLabel(candidate.recipe, candidate.tables);
      return label.ok && label.ingredients.some(item => item.emphasise);
    });
    if (!entry) throw new Error('the corpus has no recipe with an allergen');
    const label = buildLabel(entry.recipe, entry.tables);
    const os = resolveLabel(label, TEMPLATE_PROFILES.default, {}, 'en');
    const zebra = resolveLabel(label, TEMPLATE_PROFILES['zpl-57x32'], {}, 'en');
    if (!os.ok || !zebra.ok) throw new Error('could not lay the label out');
    const osView = render(<LabelSheet resolved={os as SheetSource} />);
    expect(osView.container.querySelectorAll('.lab-sheet-ing--allergen').length).toBeGreaterThan(0);
    osView.unmount();
    const zebraView = render(<LabelSheet resolved={zebra as SheetSource} />);
    expect(zebraView.container.querySelectorAll('.lab-sheet-ing--allergen')).toHaveLength(0);
  });
});
