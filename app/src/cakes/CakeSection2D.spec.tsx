import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { cakeGeometry } from '@mise/shared/cake-model';
import type { Cake, CakePart } from '@mise/shared/cake-model';
import { CakeStage } from './CakeStage';
import type { StageLabels } from './CakeStage';

const REF = { diameterCm: 22, discs: 3, discHeightCm: 3, baseG: 300, soakG: 90, fillingG: 280, coatingG: 450, decorationG: 200 };
const CAKE: Cake = {
  id: 'c1', name: 'Two tiers', diameterCm: 24, tiers: 2, discs: 3, slices: 12,
  lines: [
    { tier: 0, part: 'base', productId: 'SPONGE', grams: null },
    { tier: 0, part: 'soak', productId: 'SYRUP', grams: null },
    { tier: 0, part: 'filling', productId: 'CREAM', grams: null },
    { tier: 0, part: 'filling', productId: 'FRUIT', grams: null },
    { tier: 0, part: 'coating', productId: 'WHIP', grams: null },
    { tier: 1, part: 'base', productId: 'SPONGE', grams: null },
    { tier: 1, part: 'decoration', productId: 'FRUIT', grams: null },
  ],
  packaging: [], assemblyMinutes: null, sellingPrice: null, vatRate: null, foodCostTarget: null, categoryId: null, ref: REF, model: 1,
};

const NAMES: Record<string, string> = { SPONGE: 'Sponge', SYRUP: 'Syrup', CREAM: 'Cream', FRUIT: 'Fruit', WHIP: 'Whipped cream' };
const LABELS: StageLabels = {
  summary: 'Section drawing of the cake: 2 tiers.',
  part: { decoration: 'Decoration', coating: 'Coating', filling: 'Filling', soak: 'Soak', base: 'Base' } as Record<CakePart, string>,
  cardName: id => NAMES[id] ?? '',
  grams: grams => `${grams} g`,
  diameter: d => `Ø ${d}`,
};

const draw = (tier = 0, selected: { tier: number; part: CakePart } | null = null, onSelect = vi.fn()) => {
  render(<CakeStage geometry={cakeGeometry(CAKE)} selected={selected} tier={tier} onSelect={onSelect} labels={LABELS} />);
  return onSelect;
};

describe('the section drawing', () => {
  it('is one image with a summary for a screen reader', () => {
    draw();
    expect(screen.getByRole('img', { name: 'Section drawing of the cake: 2 tiers.' })).toBeInTheDocument();
  });

  it('names the diameter of every tier and, for the chosen tier, each part with its grams and cards', () => {
    draw(0);
    expect(screen.getByText('Ø 24')).toBeInTheDocument();
    expect(screen.getByText('Ø 18')).toBeInTheDocument();
    // 24 cm, 3 discs, 300/90/280/450 g at 22 cm: base 1071 g, soak 321 g, filling 666 g (two cards of 333), coating 508 g.
    expect(screen.getByText('Base · 1071 g')).toBeInTheDocument();
    expect(screen.getByText('Filling · 666 g')).toBeInTheDocument();
    expect(screen.getByText('Cream + Fruit')).toBeInTheDocument();
    expect(screen.getByText('Whipped cream')).toBeInTheDocument();
    expect(screen.queryByText(/^Decoration/)).not.toBeInTheDocument();
  });

  it('names the other tier’s parts when that tier is the chosen one', () => {
    draw(1);
    expect(screen.getByText(/^Decoration · /)).toBeInTheDocument();
    expect(screen.queryByText(/^Coating/)).not.toBeInTheDocument();
  });

  it('lists the names top to bottom, so the lines never cross', () => {
    draw(0);
    const order = screen.getAllByText(/ · \d+ g$/).map(node => node.textContent?.split(' · ')[0]);
    expect(order).toEqual(['Soak', 'Filling', 'Coating', 'Base']);
  });

  it('selects the part whose name is tapped, in its tier', () => {
    const onSelect = draw(0);
    fireEvent.click(screen.getByText('Filling · 666 g'));
    expect(onSelect).toHaveBeenCalledWith({ tier: 0, part: 'filling' });
  });

  it('marks the chosen part’s name', () => {
    draw(0, { tier: 0, part: 'base' });
    expect(screen.getByText('Base · 1071 g')).toHaveAttribute('data-chosen', 'true');
    expect(screen.getByText('Filling · 666 g')).toHaveAttribute('data-chosen', 'false');
  });

  it('draws nothing for a cake with no tier', () => {
    const { container } = render(<CakeStage geometry={{ tiers: [] }} selected={null} tier={0} onSelect={vi.fn()} labels={LABELS} />);
    expect(container).toBeEmptyDOMElement();
  });
});
