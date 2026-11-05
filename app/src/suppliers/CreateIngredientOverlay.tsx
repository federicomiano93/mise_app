import { useEffect, useMemo, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { ingredientDisplayName } from '@mise/shared/ingredient-name';
import { outputLanguage } from '@mise/shared/market';
import { packChoices, categoryChoices } from '@mise/shared/record-choices';
import { useT } from '../i18n/useT';
import { IngredientCard } from '../records/IngredientCard';
import type { ItemLike } from '../records/ingredientCardModel';
import { useSession } from '../session/SessionContext';
import { useMoney } from '../session/useMoney';
import { announceAction } from '../telemetry/usage';
import { FormDialog } from '../ui/FormDialog';
import { useStatusMessage } from '../ui/StatusMessage';
import { SupplierCard } from './SupplierCard';
import { useSuppliersStore } from './SuppliersContext';
import { useMayWritePrices } from './useMayWritePrices';

// The one thing another section may import from this folder (docs/architecture.md): the Recipe catalogue's «+ Add "…" as an
// ingredient» opens the SAME ingredient card as «Ingredients & suppliers», above its recipe editor.
export { CreateIngredientProvider } from './SuppliersWrites';

type Props = {
  // The name typed in the recipe row: the card starts with it.
  name: string;
  open: boolean;
  // Closed: the ingredient that was saved (its id and the name the app will show), or null (backed out, or refused).
  onDone(made: { id: string; name: string } | null): void;
  // The ingredients and suppliers the host already watches (no prices in them): the card's menus, and the words in use.
  ingredients: readonly ItemLike[];
  suppliers: readonly ItemLike[];
  // The card's own Back, kept here while it is on screen: the host calls it when the person leaves by another road (the
  // browser's Back), and it asks «Discard changes?» if something was typed.
  backRef: MutableRefObject<(() => void) | null>;
  onDirty?: (dirty: boolean) => void;
};

// A NEW ingredient made from inside another section (T15; the current app's openIngredientCreate). A dialog on a scrim from
// 700px, the whole screen below it.
//
// ⚠️ NO MONEY IS READ HERE. The store this talks to was never started (SuppliersWritesProvider): saving an ingredient only calls
// the source, and a NEW ingredient has no price to show. The price section is drawn only for whoever may write one.
// ⚠️ THE CATEGORIES COME FROM THE DEFAULTS AND THE WORDS IN USE, never from config/orders, which a venue with the Recipe
// catalogue alone may not read (the current app passes none either).
// ⚠️ IT ASKS NO PERMISSION: the door that opens it is drawn only where mayEditRecords says yes; the rules decide the save (P2).
export function CreateIngredientOverlay({ name, open, onDone, ingredients, suppliers, backRef, onDirty }: Props) {
  const { t } = useT();
  const store = useSuppliersStore();
  const say = useStatusMessage();
  const { location } = useSession();
  const mayPrice = useMayWritePrices();
  const money = useMoney();
  const title = useRef<HTMLHeadingElement>(null);
  const noTitle = useRef<HTMLHeadingElement>(null);
  const made = useRef<{ id: string; name: string } | null>(null);
  const language = outputLanguage(location) ?? 'en';
  const categories = useMemo(
    () => categoryChoices({ stored: undefined, ingredients, language }),
    [ingredients, language],
  );
  const packs = useMemo(() => packChoices({ ingredients, language }), [ingredients, language]);
  const host = useMemo(() => ({ backRef, onDirty: (dirty: boolean) => { onDirty?.(dirty); } }), [backRef, onDirty]);

  // The cursor starts on the card's title, as it does when the same card opens on its own screen.
  useEffect(() => {
    if (open) title.current?.focus();
  }, [open]);

  if (!open) return null;
  return (
    <FormDialog label={t('sup.newIngredient')} phoneFull>
      <IngredientCard
        item={null}
        presetName={name}
        host={host}
        kind="ingredient"
        preset={null}
        suppliers={suppliers}
        categories={categories}
        packs={packs}
        language={language}
        mayPrice={mayPrice}
        country={location?.country}
        money={money}
        readHistory={async () => []}
        titleRef={title}
        onSave={(payload, options) => {
          // A recipe row may only be linked to FOOD: a packaging result is refused, nothing is written.
          if (payload.kind === 'packaging') return;
          const saved = store.saveIngredient(null, payload, {
            unitChangedFrom: options.unitChangedFrom,
            ...(mayPrice && options.price ? { price: options.price } : {}),
          });
          announceAction('ingredient-saved');
          if (saved.priceRecorded) announceAction('price-saved');
          say(t('sup.ingredientSaved'));
          made.current = { id: saved.id, name: ingredientDisplayName(payload) };
        }}
        onLeave={() => { onDone(made.current); }}
        renderNewSupplier={supplierHost => <SupplierCard id={null} supplier={null} titleRef={noTitle} host={supplierHost} />}
        watchRefusedSupplier={listener => store.onMessage(message => {
          if (message.kind === 'supplier-not-saved') listener(message.name);
        })}
      />
    </FormDialog>
  );
}
