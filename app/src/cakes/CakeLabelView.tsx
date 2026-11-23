import { useEffect, useId, useMemo, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cakeLabelDiameters } from '@mise/shared/cake-label-model';
import type { CakeLabelAnswer, CakeLabelBlock, CakeLabelCard } from '@mise/shared/cake-label-model';
import type { Cake, CakePart } from '@mise/shared/cake-model';
import { localNumber } from '@mise/shared/currency';
import { PartBoundary } from '../errors/PartBoundary';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { LabelBody } from '../recipes/LabelBody';
import { LabelShowsProvider } from '../recipes/labelShows';
import { RecipesProvider } from '../recipes/RecipesContext';
import { useMoney } from '../session/useMoney';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { STEP_PARTS } from './cakeStepsModel';
import { useCakeHeadingLevel } from './headingLevel';
import { useCakeLabel } from './useCakeLabel';
import styles from './CakeLabelView.module.css';

type Props = {
  // The cake as it is on screen now: the working copy, saved or not.
  cake: Cake;
  onBack: () => void;
  // «Open the ingredient» / «Open in Recipes»: given only to somebody who may open that section (the rules are the real guard).
  onOpenIngredient?: (ingredientId: string) => void;
  onOpenRecipe?: (recipeId: string) => void;
};

// The whole cake's label, as a full-screen view INSIDE the editor (state, not a route: the editor's unsaved work stays mounted behind it).
// Back and Escape close it. The body is the recipe label's own (recipes/LabelBody): the switch, the paper at real size, the card, the
// three print roads, copy and send — handed ONE synthetic recipe made of the cake (shared/cake-label-model), so the label law is the
// same code that guards a recipe's label.
//
// ⚠️ THE RECIPES' STORE IS STARTED HERE AND ONLY WHILE THIS VIEW IS OPEN (P14): the label settings, the paper and the shop computer's
// heartbeat are the Recipes' own listeners. What the cake is JUDGED by is the recipes and the ingredients Food cost already holds.
export function CakeLabelView({ cake, onBack, onOpenIngredient, onOpenRecipe }: Props) {
  const { t } = useT();
  const level = useCakeHeadingLevel();
  const titleId = useId();
  const titleRef = useRef<HTMLHeadingElement>(null);
  // The view opens with the focus on its title (the screen's name), as every screen one level down does.
  useEffect(() => { titleRef.current?.focus(); }, []);

  // Escape closes the view — unless a dialog opened from it (Send) took the key: it stops it from reaching here.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !event.defaultPrevented) onBack();
  };

  return (
    <section className={styles.view} aria-labelledby={titleId} onKeyDown={onKeyDown}>
      <FormBar
        level={level}
        backLabel={t('ui.back')}
        onBack={onBack}
        title={cake.name.trim() === '' ? t('cakes.untitled') : cake.name.trim()}
        titleId={titleId}
        titleRef={titleRef}
        sub={<span className={styles.sub}>{t('cakes.label.title')}</span>}
      />
      <PartBoundary>
        <RecipesProvider>
          <LabelShowsProvider>
            <Body cake={cake} level={level} onOpenIngredient={onOpenIngredient} onOpenRecipe={onOpenRecipe} />
          </LabelShowsProvider>
        </RecipesProvider>
      </PartBoundary>
    </section>
  );
}

function Body({ cake, level, onOpenIngredient, onOpenRecipe }: { cake: Cake; level: 1 | 2; onOpenIngredient: Props['onOpenIngredient']; onOpenRecipe: Props['onOpenRecipe'] }) {
  const { t, locale } = useT();
  const { answer, tables, loaded, unreadable } = useCakeLabel(cake);
  const source = useMemo(() => ({ tables, loaded, unreadable }), [tables, loaded, unreadable]);
  const build = answer.build;
  const Heading = level === 1 ? 'h2' : 'h3';

  const intro = answer.state === 'empty' ? null : (
    <p className={styles.intro}>
      {t('cakes.label.wholeLead')}{' '}
      <strong>
        {[
          t('cakes.label.tiers', { n: cake.tiers, d: cakeLabelDiameters(cake).join(' / ') }),
          t('cakes.label.cards', { n: build.cards.length }),
          t('cakes.label.kg', { kg: new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(build.totalGrams / 1000) }),
        ].join(', ')}
      </strong>
      . {t('cakes.label.wholeHow')}
    </p>
  );

  const refusal = answer.state === 'ready' ? null : (
    <Refusal answer={answer} onOpenIngredient={onOpenIngredient} onOpenRecipe={onOpenRecipe} />
  );

  return (
    <LabelBody
      recipe={build.recipe}
      netWeightG={build.totalGrams}
      source={source}
      intro={intro}
      refusal={refusal}
      afterCard={answer.state === 'ready' ? <FromCards cards={build.cards} cake={cake} total={build.totalGrams} Heading={Heading} /> : null}
    />
  );
}

// Why the label cannot be made: one sentence, then a row per card in the way, naming the ingredient or the recipe and offering the door to it.
function Refusal({ answer, onOpenIngredient, onOpenRecipe }: { answer: CakeLabelAnswer; onOpenIngredient: Props['onOpenIngredient']; onOpenRecipe: Props['onOpenRecipe'] }) {
  const { t } = useT();
  const rows = answer.blocks.filter(block => block.kind !== 'no-weights');
  let lead: string;
  if (answer.state === 'empty') lead = t('cakes.label.empty');
  else if (rows.length > 0) lead = t('cakes.label.blockedLead', { n: answer.blockedCards });
  else lead = t('cakes.label.noWeights');

  return (
    <div className={styles.blocked}>
      <p className={styles.blockedTitle}>{t('cakes.label.cannotYet')}</p>
      <p className={styles.blockedText}>{lead}</p>
      {rows.length === 0 ? null : (
        <ul className={styles.rows}>
          {rows.map((block, index) => {
            const view = describe(block, t);
            return (
              <li key={`${index}-${view.title}`} className={styles.row}>
                <div className={styles.rowText}>
                  <p className={styles.rowName}>{view.title}</p>
                  <p className={styles.rowReason}>{view.text}</p>
                </div>
                {view.door === 'ingredient' && onOpenIngredient !== undefined ? (
                  <Button onPress={() => { onOpenIngredient(view.id); }}>{t('cakes.label.openIngredient')}</Button>
                ) : null}
                {view.door === 'recipe' && onOpenRecipe !== undefined ? (
                  <Button onPress={() => { onOpenRecipe(view.id); }}>{t('cakes.label.openRecipe')}</Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type RowView = { title: string; text: string; door: 'ingredient' | 'recipe' | null; id: string };

const CARD_REASON: Readonly<Record<'card-gone' | 'card-no-weights' | 'too-deep' | 'loop', MessageKey>> = {
  'card-gone': 'cakes.label.row.cardGone',
  'card-no-weights': 'cakes.label.row.cardNoWeights',
  'too-deep': 'cakes.label.row.tooDeep',
  loop: 'cakes.label.row.loop',
};

// One refused row in words. The names are the venue's own (the card, the ingredient, the recipe); the sentences are the interface's.
function describe(block: CakeLabelBlock, t: (key: MessageKey, params?: Record<string, string | number>) => string): RowView {
  if (block.kind === 'card') {
    return { title: block.name || t('cakes.label.row.unknownCard'), text: t(CARD_REASON[block.reason]), door: null, id: '' };
  }
  if (block.kind === 'ingredient') {
    const title = block.cardName || t('cakes.label.row.unknownCard');
    if (block.reason === 'missing-ingredient') return { title, text: t('cakes.label.row.ingredientGone'), door: null, id: '' };
    return { title, text: t('cakes.label.row.ingredient', { name: block.name }), door: 'ingredient', id: block.refId };
  }
  if (block.kind === 'recipe') {
    const title = block.cardName || t('cakes.label.row.unknownCard');
    if (block.reason === 'missing-recipe') return { title, text: t('cakes.label.row.recipeGone'), door: null, id: '' };
    if (block.reason === 'cycle') return { title, text: t('cakes.label.row.recipeLoop', { name: block.name }), door: 'recipe', id: block.refId };
    if (block.reason === 'too-deep') return { title, text: t('cakes.label.row.recipeDeep', { name: block.name }), door: 'recipe', id: block.refId };
    return { title, text: t('cakes.label.row.recipe', { name: block.name }), door: 'recipe', id: block.refId };
  }
  return { title: '', text: '', door: null, id: '' };
}

// «Where»: each part the card is in, with the tiers when the cake has more than one — «Base (bottom, top)».
function whereText(card: CakeLabelCard, tiers: number, t: (key: MessageKey, params?: Record<string, string | number>) => string): string {
  const byPart = new Map<CakePart, number[]>();
  for (const spot of card.where) byPart.set(spot.part, [...(byPart.get(spot.part) ?? []), spot.tier]);
  return STEP_PARTS.filter(part => byPart.has(part)).map(part => {
    const name = t(`cakes.part.${part}`);
    if (tiers <= 1) return name;
    const names = [...(byPart.get(part) ?? [])].sort((a, b) => a - b)
      .map(tier => t(tier === 0 ? 'cakes.label.tierBottom' : tier === tiers - 1 ? 'cakes.label.tierTop' : 'cakes.label.tierMiddle'));
    return t('cakes.label.where', { part: name, tiers: names.join(', ') });
  }).join(' · ');
}

// «From which cards»: under the label, the cards it was made from, where each one sits and how many grams of it are in the cake.
function FromCards({ cards, cake, total, Heading }: { cards: readonly CakeLabelCard[]; cake: Cake; total: number; Heading: 'h2' | 'h3' }): ReactNode {
  const { t } = useT();
  const money = useMoney();
  const grams = (g: number) => t('cakes.grams', { g: localNumber(String(Math.round(g)), money) });
  return (
    <section className={styles.from}>
      <Heading className={styles.fromTitle}>{t('cakes.label.fromTitle')}</Heading>
      <p className={styles.fromNote}>{t('cakes.label.fromNote')}</p>
      <div className={styles.scroll} role="region" tabIndex={0} aria-label={t('cakes.label.fromTitle')}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">{t('cakes.label.colCard')}</th>
              <th scope="col">{t('cakes.label.colWhere')}</th>
              <th scope="col" className={styles.r}>{t('cakes.label.colGrams')}</th>
            </tr>
          </thead>
          <tbody>
            {cards.map(card => (
              <tr key={card.productId}>
                <th scope="row"><span aria-hidden="true" className={styles.tick}>✓</span> {card.name}</th>
                <td>{whereText(card, cake.tiers, t)}</td>
                <td className={styles.r}>{grams(card.grams)}</td>
              </tr>
            ))}
            <tr className={styles.total}>
              <th scope="row">{t('cat.total')}</th>
              <td />
              <td className={styles.r}>{grams(total)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
