import { createContext, useContext } from 'react';

// Where a section's title goes from 700px: an empty cell at the left of the top bar, owned by AppShell. `Page` draws its title and its
// gear into it through a portal, so the section's title and the venue and connection share ONE white bar.
//
// ⚠️ `null` is a real value: outside the shell (a spec rendering a bare Page) and before the bar has mounted there is no slot, and the
// Page then draws its title in the page as it does on a phone.
export const TitleSlotContext = createContext<HTMLElement | null>(null);

export function useTitleSlot(): HTMLElement | null {
  return useContext(TitleSlotContext);
}
