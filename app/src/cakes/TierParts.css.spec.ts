import { describe, expect, it } from 'vitest';
import css from './TierParts.module.css?raw';

// ⚠️ At 296px a recipe card has about 144px inside it. The grams box shared a line with the name, ✓ and ✕ and came out 26px wide, where
// «9999» does not fit. The rule that gives the box a whole line of its own is pinned here, as a browser is the only other place it shows.
describe('TierParts narrow rows', () => {
  const narrow = css.slice(css.indexOf('@media (max-width: 360px)'));
  const areas = [...narrow.matchAll(/grid-template-areas:\s*([^;]+);/g)].map(m => m[1] ?? '');

  it('has a narrow rule for both kinds of row', () => {
    expect(areas).toHaveLength(2);
  });

  it('puts the grams box on a row where nothing else stands', () => {
    for (const rule of areas) {
      const rows = [...rule.matchAll(/"([^"]+)"/g)].map(m => (m[1] ?? '').split(/\s+/));
      const own = rows.find(row => row.includes('qty'));
      expect(own).toBeDefined();
      expect(own?.every(cell => cell === 'qty')).toBe(true);
    }
  });
});
