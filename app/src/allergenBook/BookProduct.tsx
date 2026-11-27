import type { BookEntry, BookSheetWords } from './bookEntry';
import styles from './BookProduct.module.css';

// One product of the allergen book, on the screen or on the paper. NOT a label file: it only draws the strings its entry already holds
// (bookEntry.ts composed them in the venue's country's words).
//
// ⚠️ translate="no": every word here is in the COUNTRY'S language, which is often not the device's (LabelCard's reason): a browser's
// machine translation must never rewrite an allergen name.
//
// Screen: the name, then the ingredients with the allergens in bold, then «Contains» and «May contain». Paper (`words` given): the
// same, but with the sheet's own global classes (allergen-book-print.css), and an INCOMPLETE product shows the boxed «to be checked»
// line in the place of «Contains» and «May contain».
type Props = { entry: BookEntry; words?: BookSheetWords };

export function BookProduct({ entry, words }: Props) {
  const paper = words !== undefined;
  const line = (
    <>
      {`${entry.ingredientsWord}: `}
      {entry.runs.map((run, index) => (run.bold
        ? <strong key={index} className={paper ? 'book-allergen' : styles.allergen}>{run.text}</strong>
        : run.text))}
    </>
  );
  if (paper) {
    return (
      <article className="book-product" translate="no">
        <p className="book-product-name">{entry.name}</p>
        <p>{line}</p>
        {entry.complete ? (
          <>
            {entry.contains === '' ? null : <p className="book-contains">{entry.contains}</p>}
            {entry.mayContain === '' ? null : <p>{entry.mayContain}</p>}
          </>
        ) : <p className="book-verify">{words.verify}</p>}
      </article>
    );
  }
  return (
    <article className={styles.product} translate="no">
      <p className={styles.name}>{entry.name}</p>
      <p className={styles.ingredients}>{line}</p>
      {entry.contains === '' ? null : <p className={styles.contains}>{entry.contains}</p>}
      {entry.mayContain === '' ? null : <p className={styles.traces}>{entry.mayContain}</p>}
    </article>
  );
}
