import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LineRow } from './LineRow';
import type { LineKind } from './LineRow';

// The row itself (step 4, POST-SWITCH): ONLY an ingredient line draws the supplier it is handed, under the name, as the name
// button's description. A recipe or a packaging line draws none even when a caller hands one over; '' draws nothing at all.
function row(kind: LineKind, supplier?: string) {
  return render(
    <ul>
      <LineRow
        rowKey="k1"
        kind={kind}
        name={{ text: 'Flour', missing: false }}
        supplier={supplier}
        cost=""
        note=""
        qty="500"
        unit={kind === 'packaging' ? undefined : 'g'}
        units={['g', 'kg']}
        registerQty={vi.fn()}
        onPick={vi.fn()}
        onQty={vi.fn()}
        onUnit={vi.fn()}
        onRecipeUnit={vi.fn()}
        onRemove={vi.fn()}
      />
    </ul>,
  );
}

const nameButton = () => screen.getByRole('button', { name: 'Change: Flour' });

describe('LineRow names the supplier under an ingredient line only', () => {
  it('an ingredient line: under the name, before the amount, and the name button’s description', () => {
    const { container } = row('ingredient', 'Molino Rossi');
    const supplier = screen.getByText('Molino Rossi');
    expect(supplier.tagName).toBe('P');
    expect(nameButton()).toHaveAccessibleDescription('Molino Rossi');
    const line = container.querySelector('li') as HTMLElement;
    expect(Array.from(line.children).indexOf(supplier)).toBe(1);
  });

  it.each(['recipe', 'packaging'] as const)('a %s line draws none, even when handed one', kind => {
    const { container } = row(kind, 'Molino Rossi');
    expect(screen.queryByText('Molino Rossi')).not.toBeInTheDocument();
    expect(nameButton()).not.toHaveAttribute('aria-describedby');
    expect(container.querySelectorAll('p')).toHaveLength(0);
  });

  it.each([[''], [undefined]])('an ingredient line with no supplier (%j) draws nothing and describes nothing', supplier => {
    const { container } = row('ingredient', supplier);
    expect(container.querySelectorAll('p')).toHaveLength(0);
    expect(nameButton()).not.toHaveAttribute('aria-describedby');
  });
});
