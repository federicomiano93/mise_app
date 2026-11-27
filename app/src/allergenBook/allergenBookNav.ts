import { KEEP_FOCUS } from '../shell/Page';

// What the book puts in the navigation `state` when it opens the pencil screen: «you came from the book, so Back is the browser's Back».
// KEEP_FOCUS comes with it: the page then leaves the focus alone, and the pencil screen puts it on its own title.
export const FROM_BOOK = { ...KEEP_FOCUS, fromBook: true } as const;

export function cameFromBook(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'fromBook' in state;
}
