import { describe, expect, it, vi } from 'vitest';
import { createDataServices } from './DataContext';
import { createLazyMergeSource } from '../suppliers/merge/lazyMergeSource';

// The wiring of the kitchen owner's merge (slice 2 of the roles work): the merge source learns from the SESSION'S role, asked at
// the moment of each check, whether to ask the Cloud Function instead of reading `products` (refused to the kitchen). A getter that
// stopped answering `owner-kitchen` would leave every other suite green and the kitchen back at «could not check».
vi.mock('../suppliers/merge/lazyMergeSource', () => ({ createLazyMergeSource: vi.fn(() => ({})) }));

describe('createDataServices: the merge knows the kitchen owner', () => {
  it('reads the role at each check and sends the call through the session\'s backend', async () => {
    let role: unknown = 'owner';
    const auth = { createLinkAccount: vi.fn(), callFunction: vi.fn(() => Promise.resolve({ names: [] })) };
    const firestore = vi.fn(() => Promise.reject(new Error('not in this spec')));
    createDataServices(firestore, auth, () => role).merge('bakery');

    const [, locationId, kitchen] = vi.mocked(createLazyMergeSource).mock.calls[0]!;
    expect(locationId).toBe('bakery');
    expect(kitchen.isKitchen()).toBe(false);
    role = 'owner-kitchen';
    expect(kitchen.isKitchen()).toBe(true);
    role = 'owner-sales';
    expect(kitchen.isKitchen()).toBe(false);

    await kitchen.callFunction('productsUsingIngredient', { locationId: 'bakery', ingredientId: 'b' }, 30000);
    expect(auth.callFunction).toHaveBeenCalledWith('productsUsingIngredient', { locationId: 'bakery', ingredientId: 'b' }, 30000);
  });
});
