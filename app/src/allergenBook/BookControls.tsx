import { Component, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { FROM_BOOK } from './allergenBookNav';
import { CHOOSE_PATH } from './allergenBookPath';
import { bookEntryOf, bookSheetWords } from './bookEntry';
import { BookBand } from './BookBand';
import { printBook } from './bookPrintHost';
import { BookSheet } from './BookSheet';
import type { SheetGroup } from './BookSheet';
import { layOut } from './bookShelf';
import { useBook } from './useBook';

// The title band's controls and the print question, for whoever runs the place. NOT a label file: the paper's words come from bookEntry.ts.
//
// ⚠️ IT WORKS THE BOOK OUT FOR ITSELF (useBook) AND SITS IN A QuietBoundary: one malformed recipe that throws while the book is worked
// out must not take the section down, and must not leave a box of error text in the title line — the buttons are simply not there (the
// book's own screen, in its PartBoundary, says what happened).
class QuietBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

type Plan = 'complete' | 'all';

export function BookControls() {
  return (
    <QuietBoundary>
      <Controls />
    </QuietBoundary>
  );
}

function Controls() {
  const { t } = useT();
  const navigate = useNavigate();
  const { location } = useSession();
  const book = useBook();
  const [asking, setAsking] = useState(false);

  const completeCount = book.groups.reduce((sum, group) => sum + group.recipes.length, 0);
  // Print waits for the recipes, and is refused with the label's own refusals and for an empty book.
  const canPrint = book.block === null && book.loaded && book.count > 0;

  // The paper: the complete products alone, or all of them with the incomplete ones put back in their own category (boxed, in paper
  // mode). Every word of it is composed by bookEntry.ts in the venue's country's language.
  const print = (plan: Plan) => {
    const words = bookSheetWords(location, new Date());
    if (words === null) return;
    const shelved = plan === 'all'
      ? layOut<CatalogueRecipe>([...book.groups.flatMap(group => group.recipes), ...book.incomplete], book.categories, book.locale)
      : book.groups;
    const groups: SheetGroup[] = shelved.map(group => ({
      category: group.category,
      entries: group.recipes.map(recipe => bookEntryOf(recipe, book.tables, location)),
    }));
    const venue = typeof location?.name === 'string' ? location.name : '';
    printBook(<BookSheet venue={venue} words={words} groups={groups} />);
  };

  const onPrint = () => {
    if (!canPrint) return;
    if (book.incomplete.length > 0) setAsking(true);
    else print('all');
  };
  const choose = (plan: Plan) => {
    setAsking(false);
    print(plan);
  };

  // The names the book itself shows (a hand-typed label name wins over the recipe's).
  const incompleteNames = asking ? book.incomplete.map(recipe => bookEntryOf(recipe, book.tables, location).name) : [];

  return (
    <>
      <BookBand
        canPrint={canPrint}
        onChoose={() => { void navigate(CHOOSE_PATH, { state: FROM_BOOK }); }}
        onPrint={onPrint}
      />
      <Dialog
        isOpen={asking}
        role="alertdialog"
        title={t('allergenBook.print.title')}
        message={[
          t('allergenBook.print.message', { n: book.incomplete.length, names: incompleteNames.join(', ') }),
          t('allergenBook.print.boxNote'),
        ]}
        onClose={() => { setAsking(false); }}
        actions={(
          <>
            <Button autoFocus onPress={() => { setAsking(false); }}>{t('common.cancel')}</Button>
            {completeCount > 0 ? (
              <Button onPress={() => { choose('complete'); }}>{t('allergenBook.print.onlyComplete', { n: completeCount })}</Button>
            ) : null}
            <Button variant="primary" onPress={() => { choose('all'); }}>
              {t('allergenBook.print.all', { n: book.count })}
            </Button>
          </>
        )}
      />
    </>
  );
}
