import { screen, within } from '@testing-library/react';
import type { renderApp } from './renderApp';

type User = ReturnType<typeof renderApp>['user'];

// The booking form's product window, driven as the counter does (bookings rebuild step 2): «Add a product», then the product
// (its favourite tile, else «Search all products» and its tile, else the name typed as a product of its own), then the weight
// when asked (a tile such as «1.5 kg», or «Other weight…» typed, or «No weight» for a typed name), then «Add» when the window
// asks for changes. Leaves the window closed and one card more on the form.
export async function addProduct(
  user: User,
  name: string,
  { weight, otherWeight }: { weight?: string; otherWeight?: string } = {},
): Promise<void> {
  await user.click(screen.getByRole('button', { name: 'Add a product' }));
  const win = await screen.findByRole('dialog', { name: 'Add a product' });
  const tileNamed = () => within(win).queryAllByRole('button').find(button => button.querySelector('span')?.textContent === name);
  let tile = tileNamed();
  if (tile === undefined) {
    const search = within(win).queryByRole('button', { name: 'Search all products' });
    if (search !== null) await user.click(search);
    await user.type(within(win).getByLabelText('Search the price list'), name);
    tile = tileNamed() ?? within(win).getByRole('button', { name: `Add “${name}” (not on the price list)` });
  }
  await user.click(tile);
  if (within(win).queryByRole('heading', { name: 'Choose the weight' }) !== null) {
    if (weight !== undefined) {
      await user.click(within(win).getAllByRole('button').find(button => button.querySelector('span')?.textContent === weight) as HTMLElement);
    } else if (otherWeight !== undefined) {
      await user.click(within(win).getByRole('button', { name: 'Other weight…' }));
      await user.type(within(win).getByLabelText('Weight'), otherWeight);
      await user.click(within(win).getByRole('button', { name: 'Use this weight' }));
    } else {
      await user.click(within(win).getByRole('button', { name: 'No weight (by the piece)' }));
    }
  }
  const add = screen.queryByRole('dialog', { name: 'Add a product' }) === null
    ? null
    : within(win).queryByRole('button', { name: 'Add' });
  if (add !== null) await user.click(add);
}
