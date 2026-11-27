import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { RecipesProvider, useRecipesStore } from '../recipes/RecipesContext';
import { messageText } from '../recipes/recipesMessages';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { bookEntryOf, bookSheetWords } from './bookEntry';
import { BookBand } from './BookBand';
import { printBook } from './bookPrintHost';
import { BookScreen } from './BookScreen';
import { BookSheet } from './BookSheet';
import type { SheetGroup } from './BookSheet';
import { layOut } from './bookShelf';
import { ChooseScreen } from './ChooseScreen';
import { ALLERGEN_BOOK_PATH, CHOOSE_PATH, parseAllergenBookPath } from './allergenBookPath';
import { FROM_BOOK } from './allergenBookNav';
import { useBook } from './useBook';
import styles from './AllergenBookSection.module.css';

// The «Allergen book» («Libro allergeni», 27 Nov 2026): the products a venue sells loose, with their allergens, in one printable
// book kept at the counter. Two screens:
//
//   /allergen-book         the book: what is in it, ready to print (anybody who is shown it can read it)
//   /allergen-book/choose  «Prodotti nel libro»: the pencil screen where whoever runs the place ticks the products (canManage only;
//                          the rules are the guard, the redirect a courtesy)
//
// ⚠️ ONE RecipesProvider AROUND BOTH SCREENS, so the store — and with it the choices the database refused (D7, refusedBookChoices) —
// survives going book → pencil → book. It is listened to only while this section is on screen (P14).
//
// Shown to exactly whoever is shown Recipes (session/visibility.ts): the same gate, the same card.
export default function AllergenBookSection() {
  const { pathname } = useLocation();
  const { canManage } = useSession();
  const view = parseAllergenBookPath(pathname.slice(ALLERGEN_BOOK_PATH.length));
  // A junk address goes back to the book, as the other sections send theirs back to their first screen; so does the pencil screen
  // for somebody who may not use it.
  if (view.kind === 'unknown' || (view.kind === 'choose' && !canManage)) {
    return <Navigate to={ALLERGEN_BOOK_PATH} replace state={KEEP_FOCUS} />;
  }
  return (
    <RecipesProvider>
      <StatusMessageProvider>
        <StoreMessages />
        <Screens choosing={view.kind === 'choose'} canManage={canManage} />
      </StatusMessageProvider>
    </RecipesProvider>
  );
}

// What the store reports (the feed broken, the book not saved) is said in the status message.
function StoreMessages() {
  const { t } = useT();
  const store = useRecipesStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => { say(messageText(t, message)); }), [store, say, t]);
  return null;
}

type Plan = 'complete' | 'all';

function Screens({ choosing, canManage }: { choosing: boolean; canManage: boolean }) {
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

  const band = !choosing && canManage ? (
    <BookBand
      canPrint={canPrint}
      onChoose={() => { void navigate(CHOOSE_PATH, { state: FROM_BOOK }); }}
      onPrint={onPrint}
    />
  ) : undefined;

  return (
    <Page title={t('allergenBook.title')} band={band}>
      <div className={styles.column}>
        <PartBoundary resetKey={choosing ? 'choose' : 'book'}>
          {choosing ? <ChooseScreen /> : <BookScreen book={book} canManage={canManage} />}
        </PartBoundary>
      </div>
      <Dialog
        isOpen={asking}
        role="alertdialog"
        title={t('allergenBook.print.title')}
        message={[
          t('allergenBook.print.message', { n: book.incomplete.length, names: book.incomplete.map(recipe => recipe.name).join(', ') }),
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
    </Page>
  );
}
