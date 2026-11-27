import { useId, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { FROM_LIST } from '../recipes/recipesNav';
import { recipePath } from '../recipes/recipesPath';
import { useSession } from '../session/SessionContext';
import { bookEntryOf } from './bookEntry';
import type { BookEntry } from './bookEntry';
import { BookProduct } from './BookProduct';
import type { BookView } from './useBook';
import styles from './BookScreen.module.css';

// The book as the staff read it: the products that are in it, with their allergens, laid out as the paper will be (the Recipe book's
// order). NOT a label file: every food word arrives composed in the entries (bookEntry.ts), in the venue's COUNTRY'S language.
//
// Order of what can be on screen, the first that applies: allergens switched off and no country are the LABEL'S OWN refusals (the
// same title and sentences), then «Loading…», then the empty book (said differently to whoever can fill it), then the book. The
// products whose allergens cannot be declared yet stand in a red block at the TOP, each a button to its recipe, and are not repeated
// below: a book that looked finished with a product missing from it would be the one way this screen can do harm.
export function BookScreen({ book, canManage }: { book: BookView; canManage: boolean }) {
  const { t } = useT();
  const navigate = useNavigate();
  const { location } = useSession();
  const todoId = useId();
  const { block, loaded, tables, groups, incomplete, count } = book;

  const entries = useMemo(() => {
    const byId = new Map<string, BookEntry>();
    for (const recipe of [...incomplete, ...groups.flatMap(group => group.recipes)]) {
      byId.set(recipe.id, bookEntryOf(recipe, tables, location));
    }
    return byId;
  }, [incomplete, groups, tables, location]);

  if (block !== null) {
    return (
      <div className={styles.blocked}>
        <p className={styles.blockedTitle}>{t('label.blocked')}</p>
        <p className={styles.blockedText}>{t(block === 'allergens-off' ? 'label.blocked.allergensOff' : 'label.blocked.noCountry')}</p>
      </div>
    );
  }
  if (!loaded) return <p className={styles.quiet} aria-busy="true">{t('session.loading')}</p>;
  if (count === 0) return <p className={styles.quiet}>{t(canManage ? 'allergenBook.empty.manager' : 'allergenBook.empty.staff')}</p>;

  const reasonText = (entry: BookEntry): string => (entry.reason?.kind === 'not-declared'
    ? t('label.blocked.notDeclared', { n: entry.reason.gaps })
    : t('label.blocked.noWeights'));

  return (
    <div className={styles.book}>
      {incomplete.length > 0 ? (
        <section className={styles.todo} aria-labelledby={todoId}>
          <h2 id={todoId} className={styles.todoTitle}>{t('allergenBook.incomplete.title', { n: incomplete.length })}</h2>
          <ul className={styles.todoRows}>
            {incomplete.map(recipe => {
              const entry = entries.get(recipe.id);
              if (!entry) return null;
              return (
                <li key={recipe.id}>
                  <button
                    type="button"
                    className={styles.todoRow}
                    onClick={() => { void navigate(recipePath(recipe.id), { state: FROM_LIST }); }}
                  >
                    <span className={styles.todoText} translate="no">
                      <span className={styles.todoName}>{entry.name}</span>
                      <span className={styles.todoReason}>{reasonText(entry)}</span>
                    </span>
                    <ChevronRight aria-hidden="true" className={styles.chevron} />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <p className={styles.count}>{t('allergenBook.count', { n: count })}</p>

      {groups.map(group => (
        <PartBoundary key={group.category}>
          <section className={styles.group}>
            {group.category !== '' || groups.length > 1 ? (
              <h2 className={styles.category} translate="no">{group.category === '' ? t('cat.shelf.noCategory') : group.category}</h2>
            ) : null}
            <div className={styles.products}>
              {group.recipes.map(recipe => {
                const entry = entries.get(recipe.id);
                if (!entry) return null;
                return (
                  <div key={recipe.id}>
                    <BookProduct entry={entry} />
                    {entry.typedText === 'refused' ? <p className={styles.refused}>{t('allergenBook.typedRefused')}</p> : null}
                  </div>
                );
              })}
            </div>
          </section>
        </PartBoundary>
      ))}
    </div>
  );
}
