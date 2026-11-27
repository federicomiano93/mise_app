import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router';
import { PartBoundary } from '../errors/PartBoundary';
import { useT } from '../i18n/useT';
import { RecipesProvider, useRecipesStore } from '../recipes/RecipesContext';
import { messageText } from '../recipes/recipesMessages';
import { useSession } from '../session/SessionContext';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { BookScreen } from './BookScreen';
import { BookControls } from './BookControls';
import { ChooseScreen } from './ChooseScreen';
import { ALLERGEN_BOOK_PATH, parseAllergenBookPath } from './allergenBookPath';
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

function Screens({ choosing, canManage }: { choosing: boolean; canManage: boolean }) {
  const { t } = useT();
  return (
    <Page title={t('allergenBook.title')} band={!choosing && canManage ? <BookControls /> : undefined}>
      <div className={styles.column}>
        <PartBoundary resetKey={choosing ? 'choose' : 'book'}>
          {choosing ? <ChooseScreen /> : <BookScreen canManage={canManage} />}
        </PartBoundary>
      </div>
    </Page>
  );
}
