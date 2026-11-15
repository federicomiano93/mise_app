import { screen, waitFor } from '@testing-library/react';

// The alerts that are SAYING something. The join form keeps its alert region in the page, empty, before it speaks (a live
// region inserted already filled is not announced reliably), so «the alert» is the one with words in it.
export const spokenAlerts = (): HTMLElement[] => screen.queryAllByRole('alert').filter(region => (region.textContent ?? '').trim() !== '');

export const findSpokenAlert = (): Promise<HTMLElement> => waitFor(() => {
  const found = spokenAlerts();
  if (found.length !== 1) throw new Error(`Expected one alert with words, found ${found.length}.`);
  return found[0] as HTMLElement;
});
