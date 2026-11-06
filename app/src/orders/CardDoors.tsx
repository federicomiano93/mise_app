import { createContext, useContext } from 'react';
import { kindOf } from '@mise/shared/ingredient-kind';
import type { RecordsTab } from '@mise/shared/records-link';
import type { TripTarget } from './cardTrip';

// A door from «Orders» to a card of «Ingredients & suppliers» (step 3f-8b): the address to push, the state that tells the Suppliers
// section how Back steps up (shared/src/records-link.ts), and what was pressed (cardTrip.ts).
export interface CardDoor {
  readonly address: string;
  readonly state: object;
  readonly target: TripTarget;
  // The flat view's search text and frozen set, when the door is pressed there: they come back with the person.
  readonly flat?: { readonly query: string; readonly only: readonly string[] | null };
}

export interface CardDoors {
  // ⚠️ THE VERY GATE OF THE SUPPLIERS SECTION (mayEditRecords): a door is drawn only where it says yes, so it never bounces. Asked on
  // every render of the section, so it follows the venue's switch live.
  readonly may: boolean;
  // Writes the place down (cardTrip.ts) and pushes the card. Orders' own data is sent by the section closing (O2).
  open(door: CardDoor): void;
}

const NONE: CardDoors = { may: false, open() { /* no section around: no door */ } };

const CardDoorsContext = createContext<CardDoors>(NONE);
export const CardDoorsProvider = CardDoorsContext.Provider;

export function useCardDoors(): CardDoors {
  return useContext(CardDoorsContext);
}

// The Suppliers tab a line's card sits on: packaging beside packaging, every other line with the ingredients.
export const tabOfLine = (ingredient: unknown): RecordsTab => (kindOf(ingredient) === 'packaging' ? 'packaging' : 'ingredients');
