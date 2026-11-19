import { useState } from 'react';
import type { PriceItem } from '@mise/shared/price-list';
import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { priceListOf } from '../testing/fakeBookingsSource';
import { renderWithSession } from '../testing/renderWithSession';
import { ProductCard } from './ProductCard';
import { ProductPicker } from './ProductPicker';
import { LIMITS, blankLine, effectiveUnit, linePrice } from './bookingModel';
import type { DraftLine } from './bookingModel';

// The review fixes of the product window and the card (bookings rebuild step 2, 19 Nov 2026). ⚠️ Fake products only.

const LIST = priceListOf([
  { productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg', favourite: true, weights: [1], removable: ['cipolla'] },
  { productId: 'pP', name: 'Panettone', price: 25, per: 'piece', favourite: true },
]).items;
const NO_FAVOURITES = LIST.map(item => ({ ...item, favourite: false }));

const noop = () => undefined;
const picker = (items: typeof LIST, extras: readonly string[] = []) => (
  <ProductPicker items={items} extras={extras} unavailable={false} loaded onClose={noop} onAdd={noop} />
);

// A window whose list arrives later, as the price list does: the button stands for the answer.
function LateList() {
  const [items, setItems] = useState<readonly PriceItem[]>(NO_FAVOURITES);
  return (
    <>
      <button type="button" onClick={() => { setItems(LIST); }}>list arrives</button>
      {picker(items)}
    </>
  );
}

describe('favourites that arrive after the window opened', () => {
  it('switch the untouched window from the search to the favourites tiles', async () => {
    const { user } = renderWithSession(<LateList />);
    const win = await screen.findByRole('dialog');
    expect(within(win).getByLabelText('Search the price list')).toBeInTheDocument();
    await user.click(screen.getByText('list arrives'));
    expect(within(win).queryByLabelText('Search the price list')).toBeNull();
    expect(within(win).getByRole('button', { name: 'Search all products' })).toBeInTheDocument();
  });

  it('leave a window the person has typed in alone', async () => {
    const { user } = renderWithSession(<LateList />);
    const win = await screen.findByRole('dialog');
    await user.type(within(win).getByLabelText('Search the price list'), 'pan');
    await user.click(screen.getByText('list arrives'));
    expect(within(win).getByLabelText('Search the price list')).toHaveValue('pan');
  });
});

describe('the step counter counts the steps that will be asked', () => {
  it('«1 of 3» before a product, and still «2 of 3» for a kilo product with weights and changes', async () => {
    const { user } = renderWithSession(picker(LIST));
    const win = await screen.findByRole('dialog');
    expect(win).toHaveTextContent('1 of 3');
    await user.click(within(win).getByRole('button', { name: /^Scacciata broccoli/ }));
    expect(win).toHaveTextContent('2 of 3');
  });

  it('a kilo product with nothing to change: «2 of 2» for the weight', async () => {
    const bare = LIST.map(item => ({ ...item, removable: [] }));
    const { user } = renderWithSession(picker(bare));
    const win = await screen.findByRole('dialog');
    await user.click(within(win).getByRole('button', { name: /^Scacciata broccoli/ }));
    expect(win).toHaveTextContent('2 of 2');
  });

  it('a piece with changes to offer skips the weight: «2 of 2» for the changes', async () => {
    const { user } = renderWithSession(picker(LIST, ['provola']));
    const win = await screen.findByRole('dialog');
    await user.click(within(win).getByRole('button', { name: /^Panettone/ }));
    expect(win).toHaveTextContent('2 of 2');
  });
});

describe('a note that is too long', () => {
  it('disables «Add» and says why, never cutting the note', async () => {
    const extras = Array.from({ length: 6 }, (_, i) => `${String(i)}${'x'.repeat(60)}`);
    const { user } = renderWithSession(picker(LIST, extras));
    const win = await screen.findByRole('dialog');
    await user.click(within(win).getByRole('button', { name: /^Panettone/ }));
    const add = within(win).getByRole('button', { name: 'Add' });
    expect(add).toBeEnabled();
    for (const extra of extras.slice(0, 4)) await user.click(within(win).getByRole('button', { name: new RegExp(`^${extra}`) }));
    expect(add).toBeEnabled();
    for (const extra of extras.slice(4)) await user.click(within(win).getByRole('button', { name: new RegExp(`^${extra}`) }));
    expect(add).toBeDisabled();
    expect(within(win).getByText(`Too many changes: the note is over ${String(LIMITS.lineNote)} characters`)).toBeInTheDocument();
    for (const extra of extras.slice(4)) await user.click(within(win).getByRole('button', { name: new RegExp(`^${extra}`) }));
    expect(add).toBeEnabled();
  });
});

describe('the card counts in the unit that will be saved', () => {
  it('a free-name line typed as pieces, then the list says kg: the card shows kilos', () => {
    const line: DraftLine = { ...blankLine(1), name: 'Scacciata broccoli', qty: '2', unit: 'pcs' };
    const kilo = priceListOf([{ productId: 'pS', name: 'Scacciata broccoli', price: 16, per: 'kg' }]).items;
    const price = linePrice(line, kilo);
    expect(effectiveUnit(line, price)).toBe('kg');
    renderWithSession(
      <ProductCard
        index={0} line={line} price={price} amount={32} cardId="c" qtyId="q" nameError={null} qtyError={null}
        onChange={noop} onRemove={noop}
      />,
    );
    const card = screen.getByRole('group');
    expect(card).toHaveTextContent('kg');
    expect(card).toHaveTextContent('per kg');
  });
});
