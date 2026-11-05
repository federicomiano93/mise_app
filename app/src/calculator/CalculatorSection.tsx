import { useEffect, useId, useLayoutEffect } from 'react';
import { ClipboardList, Settings } from 'lucide-react';
import { Navigate, useLocation, useNavigate, useNavigationType } from 'react-router';
import { calculatorEmptyReason, getVisibleRecipes } from '@mise/shared/calculator-config';
import type { EmptyReason } from '@mise/shared/calculator-config';
import { PartBoundary } from '../errors/PartBoundary';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { KEEP_FOCUS, Page } from '../shell/Page';
import { StatusMessageProvider, useStatusMessage } from '../ui/StatusMessage';
import { CalculatorProvider, useCalculator, useCalculatorStore } from './CalculatorContext';
import {
  CALCULATOR_PATH, LOG_PATH, SETTINGS_PATH, newRecipePath, recipePath, recipesPath, resolveCalculatorPath,
} from './calculatorPath';
import { messageText } from './calculatorMessages';
import {
  ADD_RECIPE_OPENER, CHOOSE_RECIPES_OPENER, DOUGH_HISTORY_OPENER, HandBackProvider, SETTINGS_OPENER, useHandBack,
  useHandBackState,
} from './handBack';
import { DoughHistory } from './DoughHistory';
import { OpenButton } from './OpenButton';
import { RecipePanel } from './RecipePanel';
import { RecipeTabs } from './RecipeTabs';
import { SettingsScreens } from './SettingsScreens';
import { TabStateProvider } from './TabStateContext';
import styles from './CalculatorSection.module.css';

// The Calculator: the work view (the recipes as tabs, and under the chosen one its entries and the scaled recipe,
// beside them from 1000px) and, one level down, its Dough history and its Settings. Loaded only when somebody opens it (shell/sectionScreens.ts), and only for a
// person the venue shows it to (SectionRoute).
//
// Its data lives exactly as long as it is on screen: CalculatorProvider starts the listeners on mount and
// stops them on unmount (P14).
export default function CalculatorSection() {
  return (
    <CalculatorProvider>
      <TabStateProvider>
        <StatusMessageProvider>
          <StoreMessages />
          <CalculatorScreen />
        </StatusMessageProvider>
      </TabStateProvider>
    </CalculatorProvider>
  );
}

// What the store reports (a dough the database refused, a log that is full) goes to the status message.
function StoreMessages() {
  const { t } = useT();
  const store = useCalculatorStore();
  const say = useStatusMessage();
  useEffect(() => store.onMessage(message => {
    const text = messageText(t, message);
    if (text !== null) say(text);
  }), [store, say, t]);
  return null;
}

function CalculatorScreen() {
  const { t } = useT();
  const { pathname, state } = useLocation();
  const navigationType = useNavigationType();
  const { config } = useCalculator();
  const handBack = useHandBackState();
  const recipes = getVisibleRecipes(config);
  // The address as it is written, not React Router's «*»: a recipe id is split before it is decoded.
  const resolved = resolveCalculatorPath(pathname.slice(CALCULATOR_PATH.length), recipes.map(recipe => recipe.id));

  // ⚠️ THE REDIRECT MUST KEEP THE MEANING OF THE MOVE THAT CAUSED IT (see FoodcostSection): on a POP the app is
  // arranging itself, so KEEP_FOCUS; on any other move the state of the address being replaced is passed on.
  if ('redirect' in resolved) {
    return <Navigate to={resolved.redirect} replace state={navigationType === 'POP' ? KEEP_FOCUS : state} />;
  }

  return (
    <HandBackProvider value={handBack}>
      <Page title={t('section.calculator')}>
        {'settings' in resolved ? (
          <PartBoundary resetKey={pathname}>
            <SettingsScreens view={resolved.settings} />
          </PartBoundary>
        ) : 'log' in resolved ? (
          <PartBoundary resetKey={pathname}>
            <DoughHistory view={resolved.log} />
          </PartBoundary>
        ) : (
          <PartBoundary resetKey={resolved.active ?? ''}>
            <WorkView active={resolved.active} />
          </PartBoundary>
        )}
      </Page>
    </HandBackProvider>
  );
}

type EmptyCopy = { title: MessageKey; sub?: MessageKey };

const EMPTY_TEXT: Readonly<Record<EmptyReason, EmptyCopy>> = {
  loading: { title: 'calc.loading', sub: 'calc.fetchingTheRecipes' },
  'no-recipes': { title: 'calc.noRecipesYet', sub: 'calc.empty.noRecipes.sub' },
  'hidden-recipes': { title: 'calc.noRecipeIsShown', sub: 'calc.empty.noneShown.sub' },
};

// ⚠️ A stream that failed with nothing on this phone to show would sit on «Loading…» for ever: it says so.
const FAILED_TEXT: EmptyCopy = { title: 'calc.couldNotLoad' };

function WorkView({ active }: { active: string | null }) {
  const { t } = useT();
  const navigate = useNavigate();
  const handBack = useHandBack();
  const { config, configAnswered, configFailed } = useCalculator();
  const base = useId();
  const recipes = getVisibleRecipes(config);
  const current = recipes.find(recipe => recipe.id === active);

  // Back from Settings (or the phone's back gesture) lands here: the button that opened it takes the focus. The
  // work view is the bottom of the stack, so whatever else was expected is forgotten.
  useLayoutEffect(() => { handBack.deliver(true); }, [handBack]);

  if (!current) {
    // Nothing to draw: the three states of an empty Calculator, three sentences. ⚠️ NEUTRAL, NOT AN ALARM — a
    // venue that has just been bought is not broken.
    //
    // ⚠️ «LOADING» HAS NO BUTTON AT ALL, not even Settings. Offering «Add a recipe» while the answer is on its way
    // invites somebody to write one they already have, and a door to Settings would be a promise it cannot keep
    // yet (a stream that failed with nothing on this phone to show is the same state). The other two states have
    // the Settings door, and a button to the screen that fixes THEM.
    const reason = calculatorEmptyReason(config, configAnswered) ?? 'loading';
    const copy = configFailed && reason === 'loading' ? FAILED_TEXT : EMPTY_TEXT[reason];
    return (
      <div className={styles.view}>
        {reason === 'loading' ? null : <Doors />}
        <div className={styles.empty}>
          <p className={styles.emptyTitle}>{t(copy.title)}</p>
          {copy.sub ? <p className={styles.emptySub}>{t(copy.sub)}</p> : null}
          {reason === 'no-recipes' ? (
            <OpenButton variant="primary" opener={ADD_RECIPE_OPENER} to={newRecipePath}>{t('calc.addARecipe')}</OpenButton>
          ) : null}
          {reason === 'hidden-recipes' ? (
            <OpenButton variant="primary" opener={CHOOSE_RECIPES_OPENER} to={recipesPath}>
              {t('calc.chooseWhichToShow')}
            </OpenButton>
          ) : null}
        </div>
      </div>
    );
  }

  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;
  const tabs = recipes.length > 1;

  return (
    <div className={styles.view}>
      <Doors />
      <RecipeTabs
        recipes={recipes}
        active={current.id}
        // A tab is an address (Back and a shared link land on the same tab), but picking one REPLACES the
        // entry: four tabs must not pile four steps onto Back. KEEP_FOCUS: the focus stays on the tab pressed.
        onPick={id => { void navigate(recipePath(id), { replace: true, state: KEEP_FOCUS }); }}
        tabId={tabId}
        panelId={panelId}
      />
      {/* Keyed on the recipe: another tab starts with its own divisor and its own note. */}
      <RecipePanel
        key={current.id}
        recipe={current}
        panelProps={tabs ? { role: 'tabpanel', id: panelId, 'aria-labelledby': tabId(current.id) } : {}}
      />
    </div>
  );
}

// The doors to the Dough history and to Settings, at the top of the work view and of every empty state but
// «loading».
function Doors() {
  const { t } = useT();
  return (
    <div className={styles.top}>
      <OpenButton opener={DOUGH_HISTORY_OPENER} to={LOG_PATH}>
        <ClipboardList aria-hidden="true" />
        {t('ui.log')}
      </OpenButton>
      <OpenButton opener={SETTINGS_OPENER} to={SETTINGS_PATH}>
        <Settings aria-hidden="true" />
        {t('ui.settings')}
      </OpenButton>
    </div>
  );
}
