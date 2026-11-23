import { screen, within } from '@testing-library/react';
import type { UserEvent } from '@testing-library/user-event';

// A SAVED cake opens with its Measures card folded to one line: a spec that types in the name or a measure opens it first.
// (A new cake opens with it open, and this then does nothing.)
export async function openMeasures(user: UserEvent): Promise<void> {
  const heading = await screen.findByRole('heading', { level: 3, name: /^(Measures|Misure)/ });
  const fold = within(heading).getByRole('button');
  if (fold.getAttribute('aria-expanded') === 'false') await user.click(fold);
}
