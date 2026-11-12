import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Pencil } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import { currentProduct, productionCost } from '@mise/shared/foodcost-model';
import type { CostTables, Product } from '@mise/shared/foodcost-model';
import { countryOf } from '@mise/shared/market';
import { useT } from '../i18n/useT';
import { useSession } from '../session/SessionContext';
import { Button } from '../ui/Button';
import { FormBar } from '../ui/FormBar';
import { SPLIT_QUERY } from '../ui/split';
import { useStatusMessage } from '../ui/StatusMessage';
import { useConfirm } from '../ui/useConfirm';
import { useMediaQuery } from '../ui/useMediaQuery';
import { useFoodcost, useFoodcostStore } from './FoodcostContext';
import { CardSection, CardStack } from './CardSection';
import { historyPath } from './foodcostPath';
import type { Origin } from './foodcostPath';
import { FROM_PRODUCT, pushDepth } from './foodcostNav';
import { LabEntry } from './lab/LabEntry';
import { LabMode } from './lab/LabMode';
import { PerKgBlock } from './PerKgBlock';
import { ProductActions } from './ProductActions';
import { SuggestedPrice } from './SuggestedPrice';
import { workingFrom } from './productEditorModel';
import { ProductSummary } from './ProductSummary';
import { ReadLabour, ReadMadeOf, ReadPackaging, ReadPrice, ReadProduct, ReadCooking } from './ReadSections';
import { useProductExit } from './useProductExit';
import shell from './ProductEditor.module.css';

type Props = {
  id: string;
  // The product as the list holds it now — or, once it has left the list, the last version seen (`gone`).
  product: Product;
  // The product was deleted elsewhere while this screen was open: say so and leave.
  gone: boolean;
  origin: Origin;
  titleRef: Ref<HTMLHeadingElement>;
  // The pencil: the SAME product, as the form.
  onEdit: () => void;
  // The form may not open yet (a product saved before the switch, ProductEditor): the pencil is held and a sentence under the
  // name says why — 'coming' while the server's recipes may still arrive; 'failed' when the recipes stream died with a recipe of
  // the product's lines missing from this phone (only a new visit to Food cost listens again, so «once they arrive» would be a lie).
  editWaits?: 'coming' | 'failed' | null;
};

// Whether the summary has anything to show: something is costed. A fault in the cost model counts as «nothing».
export function summaryShows(product: unknown, tables: CostTables): boolean {
  try {
    return productionCost(product, tables).batchCost !== null;
  } catch {
    return false;
  }
}

// A product opened to READ (Federico, 7 Nov 2026; current app 18679a38): the summary, then the sections — Product, Made of, Baking,
// Packaging, Work, Price — as plain text, then a closed «Cost breakdown»; the pencil in the bar turns the same product into the form.
// Since 11 Nov 2026 there is no «Full card» box around them: every section sits right under the summary, and each explains itself
// behind its «?».
//
// ⚠️ IT FOLLOWS THE STORED PRODUCT, LIVE (f8770132): a read view holds nothing typed, so a price, a recipe or the product itself
// changing elsewhere simply redraws it — no copy, no question. A product deleted elsewhere closes it, on a phone and on the
// split alike.
// ⚠️ NOTHING IN IT IS A CONTROL BUT THE BAR'S BUTTONS, THE «?» OF EACH SECTION, «DETAILS», «WHICH?», «COST BREAKDOWN», HISTORY AND
// DELETE: a box sneaking in would be a form that looks like text.
export function ProductRead({ id, product: stored, gone, origin, titleRef, onEdit, editWaits = null }: Props) {
  const { t } = useT();
  const store = useFoodcostStore();
  const snap = useFoodcost();
  const { canManage, location } = useSession();
  const say = useStatusMessage();
  const navigate = useNavigate();
  const { state } = useLocation();
  const split = useMediaQuery(SPLIT_QUERY);
  const [confirm, confirmDialog] = useConfirm();
  // Lab mode on screen (Food cost plan step 5). It opens from the SAVED product, so the read view — which holds no edits — is its only door.
  const [labOpen, setLabOpen] = useState(false);
  const { leave, goBack } = useProductExit(id, origin);
  const titleId = useId();
  const waitId = useId();
  const country = countryOf(location);
  const waitNote = editWaits === 'failed' ? t('fc.editRecipesFailed') : editWaits === 'coming' ? t('fc.editWaitsForRecipes') : '';

  // ⚠️ THE CURRENT PRODUCT (model 3): one saved before holds finished kilos on its recipe lines; every section below reads the
  // converted one, so the lines show raw kilos, as the form will after the pencil. ProductEditor opens it only on recipes and
  // prices it can trust (waitsForTables).
  const product = useMemo(() => currentProduct(stored, snap.tables) ?? stored, [stored, snap.tables]);
  // The product as the form would open it: it gives each line the name and the note the form shows under it.
  const working = useMemo(() => workingFrom(product, country), [product, country]);
  const loaded = { recipes: snap.recipesLoaded, ingredients: snap.ingredientsLoaded };
  const leaving = useRef(false);
  const asking = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // ⚠️ A PRODUCT THAT LEFT BECAUSE ITS OWN FIRST SAVE WAS REFUSED was not deleted: the store has already said (or is about to say)
  // «… wasn't saved», and «Product deleted.» would overwrite it; the person still lands on the list, like the current app. While that
  // save is still in the air the product may only be missing from a stale snapshot: wait, the next one puts it back.
  const firstSave = store.firstSave(id);
  useEffect(() => {
    if (!gone || leaving.current || firstSave === 'sending') return;
    leaving.current = true;
    if (firstSave === null) say(t('fc.productDeleted'));
    leave();
  }, [gone, say, t, leave, firstSave]);

  async function remove() {
    if (asking.current || leaving.current) return;
    asking.current = true;
    try {
      const ok = await confirm({
        title: t('fc.deleteProduct'),
        message: t('fc.deleteProductQ', { name: product.name || t('fc.thisProduct') }),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok || !mounted.current) return;
    } finally {
      asking.current = false;
    }
    leaving.current = true;
    store.deleteProduct(id);
    say(t('fc.productDeleted'));
    leave();
  }

  // Minutes typed but no rate to turn them into money: say where the rate is set — and only to somebody who can set it.
  const labourNeedsRate = (product.labourMinutes ?? 0) > 0 && canManage && snap.settingsLoaded && !(Number(snap.tables.labourCostPerHour) > 0);

  return (
    <section className={shell.editor} aria-labelledby={titleId}>
      <FormBar
        backLabel={t('ui.back')}
        onBack={goBack}
        title={product.name || t('fc.untitledProduct')}
        titleId={titleId}
        titleRef={titleRef}
        sub={waitNote ? <p id={waitId} className={shell.sub}>{waitNote}</p> : undefined}
        action={
          // ⚠️ HELD WITH aria-disabled, NEVER THE disabled ATTRIBUTE (spec and third code review, 11 Nov 2026): browsers send a
          // tap's pointer events to a disabled button, and React Aria starts a press on them that no click ever ends — the first
          // tap once the pencil was free went into finishing that press and opened nothing; and a disabled button drops the focus.
          // Held, it stays where it was, says why under the name and, tapped, in the status line (ProductEditor refuses it too).
          <Button
            variant="primary"
            aria-label={t('fc.editProduct')}
            aria-describedby={waitNote ? waitId : undefined}
            aria-disabled={waitNote !== ''}
            onPress={waitNote ? () => say(waitNote) : onEdit}
          >
            <Pencil aria-hidden="true" />
          </Button>
        }
      />

      <div className={shell.body}>
        <ProductSummary product={product} tables={snap.tables} />
        <LabEntry productId={id} held={waitNote} onHeld={() => say(waitNote)} onOpen={() => { setLabOpen(true); }} />
        <CardSection title={t('fc.section.product')} help={t('fc.help.prod')}>
          <ReadProduct product={product} working={working} />
        </CardSection>
        <CardSection title={t('fc.madeOf')} help={t('fc.help.madeRead')}>
          <ReadMadeOf product={product} working={working} tables={snap.tables} loaded={loaded} />
        </CardSection>
        {/* ⚠️ WHENEVER THERE IS ANYTHING TO WEIGH OR A WEIGHT STORED (step 2b): a converted product whose recipe line was replaced
            by an ingredient still holds a cooked weight, and a card that needed a recipe line hid it from the person who must
            re-weigh it. */}
        {product.components.length > 0 || product.rawGrams !== null || product.cookedGrams !== null ? (
          <CardSection title={t('fc.cooking.title')} help={t('fc.help.bakeRead')}>
            <ReadCooking product={product} tables={snap.tables} />
          </CardSection>
        ) : null}
        <CardSection title={t('fc.packaging')} help={t('fc.help.pack')}>
          <ReadPackaging product={product} working={working} tables={snap.tables} loaded={loaded} />
        </CardSection>
        <CardSection title={t('fc.labour')} help={t('fc.help.workRead')}>
          <ReadLabour product={product} note={labourNeedsRate ? t('fc.labourSetRate') : ''} />
        </CardSection>
        <CardSection title={t('fc.section.price')} help={t('fc.help.price')}>
          <CardStack>
            <ReadPrice product={product} />
            <SuggestedPrice product={product} tables={snap.tables} sellingPrice={product.sellingPrice} onUse={null} />
          </CardStack>
        </CardSection>
        <PerKgBlock product={product} tables={snap.tables} />
        <ProductActions
          onHistory={() => {
            // On the split the history takes the product's place (so the list's rows still mean «replace what is open»); on a
            // phone it is one level down and Back is the browser's.
            void navigate(historyPath(id, origin), split ? { replace: true, state } : { state: { ...FROM_PRODUCT, ...pushDepth(state) } });
          }}
          onDelete={canManage ? () => { void remove(); } : null}
        />
      </div>
      {confirmDialog}
      {labOpen ? <LabMode productId={id} onClose={() => { setLabOpen(false); }} /> : null}
    </section>
  );
}
