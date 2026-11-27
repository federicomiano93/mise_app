import type { BookEntry, BookSheetWords } from './bookEntry';
import { BookProduct } from './BookProduct';
import './allergen-book-print.css';

// The allergen book as a sheet of paper, drawn into the print host (bookPrintHost.tsx), never on screen. NOT a label file: the venue's
// name, the sheet's words and every product's strings arrive already composed (bookEntry.ts).
//
// ⚠️ PLAIN CLASS NAMES FROM A GLOBAL STYLESHEET (allergen-book-print.css), like the booking slip: the host lives outside the app's tree.
export type SheetGroup = { readonly category: string; readonly entries: readonly BookEntry[] };

type Props = { venue: string; words: BookSheetWords; groups: readonly SheetGroup[] };

export function BookSheet({ venue, words, groups }: Props) {
  return (
    <div className="book-sheet" translate="no">
      {venue === '' ? null : <p className="book-venue">{venue}</p>}
      <h1 className="book-title">{words.title}</h1>
      <p className="book-updated">{words.updated}</p>
      <p className="book-legend">{words.legend}</p>
      {groups.map(group => (
        <section key={group.category}>
          <h2 className="book-category">{group.category === '' ? words.noCategory : group.category}</h2>
          {group.entries.map(entry => <BookProduct key={entry.id} entry={entry} words={words} />)}
        </section>
      ))}
    </div>
  );
}
