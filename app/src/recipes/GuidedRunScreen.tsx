import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { isResumable } from '@mise/shared/guided-model';
import { useT } from '../i18n/useT';
import { useStatusMessage } from '../ui/StatusMessage';
import { COPY_WAIT_MS } from './RecipeEditorScreen';
import { GuidedRun } from './GuidedRun';
import { clearSession, readSession } from './guidedSession';
import type { GuidedSession } from './guidedSession';
import { useRecipes } from './RecipesContext';
import { cameFromRecipe, useLeave } from './recipesNav';
import { recipePath } from './recipesPath';
import styles from './GuidedRun.module.css';

// Nothing to do when the screen is left: the recipe steps back to the list's focus by itself.
const NOTHING = (): void => undefined;

// The guided mix's own screen, at /recipes/<id>/mix.
//
// ⚠️ THE RUN ALWAYS GOES ON FROM THE SAVED SESSION, never from the recipe's button alone: the button writes a fresh session
// and then comes here, so a reload in the middle of a mix lands on the same address and picks it up where it was — it never
// starts over. This screen decides, from what the phone has saved for THIS recipe:
//   · a whole, recent session of a recipe still held → the run;
//   · nothing saved for it (an address typed, a mix of another recipe) → the recipe, by replacing this entry;
//   · a session that has aged out (older than 24 hours, a clock that went backwards, a step that no longer exists) or whose
//     recipe was deleted → «That mix is no longer available — start it again.», the session cleared, and the recipe. Never a
//     silent fresh run: a button that said «resume» must not quietly start at step 1, which looks the same and is another dough.
//
// The recipe is looked for in the phone's copy first; only when it is not there does the screen wait for the server's word (or
// COPY_WAIT_MS with no signal) before it calls the mix stale, because the copy can be a partial one. The run itself needs no
// recipe: it works from its snapshot.
export function GuidedRunScreen({ id }: { id: string }) {
  const { t } = useT();
  const say = useStatusMessage();
  const { recipes, recipesFromServer, streamBroken } = useRecipes();
  const leave = useLeave(recipePath(id), NOTHING, cameFromRecipe);

  // What was saved when this screen opened, and when: read once. A mix just started on a phone whose storage refused it comes
  // with the move (ProcedureCard) and wins over what storage holds, unless storage holds that very mix (same start).
  const location = useLocation();
  const [opened] = useState(() => {
    const stored = readSession();
    const fresh = freshMixOf(location.state);
    const saved = fresh !== null && (stored === null || stored.startedAt !== fresh.startedAt) ? fresh : stored;
    return { saved, at: Date.now() };
  });
  const saved = opened.saved !== null && opened.saved.recipeId === id ? opened.saved : null;
  const whole = saved !== null && isResumable(saved, opened.at);
  const held = recipes.some(candidate => candidate.id === id);

  const settled = recipesFromServer || streamBroken;
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    if (held || settled || patienceOver) return undefined;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setPatienceOver(true);
      return undefined;
    }
    const timer = window.setTimeout(() => { setPatienceOver(true); }, COPY_WAIT_MS);
    return () => { window.clearTimeout(timer); };
  }, [held, settled, patienceOver]);

  const verdict: 'run' | 'none' | 'stale' | 'wait' =
    saved === null ? 'none'
      : !whole ? 'stale'
        : held ? 'run'
          : settled || patienceOver ? 'stale' : 'wait';

  // Once the run has begun the recipe list no longer matters to it (a recipe deleted elsewhere does not stop a mix in progress).
  const [session, setSession] = useState<GuidedSession | null>(null);
  if (verdict === 'run' && session === null) setSession(saved);

  // ⚠️ ONCE: under StrictMode every effect runs twice, and a second leave() would step back past the recipe.
  const decided = useRef(false);
  useEffect(() => {
    if (session !== null || decided.current) return;
    if (verdict === 'stale') {
      decided.current = true;
      clearSession();
      say(t('cat.thatMixIsNo'));
      leave();
    } else if (verdict === 'none') {
      decided.current = true;
      leave();
    }
  }, [verdict]);

  if (session === null) {
    return (
      <section className={styles.waiting} aria-busy="true">
        <p className={styles.loading}>{t('session.loading')}</p>
      </section>
    );
  }
  return <GuidedRun id={id} session={session} />;
}

// The fresh mix carried by the move from the card, when storage would not keep it.
function freshMixOf(state: unknown): GuidedSession | null {
  const fresh = (state as { freshMix?: unknown } | null)?.freshMix;
  return fresh !== null && typeof fresh === 'object' ? (fresh as GuidedSession) : null;
}
