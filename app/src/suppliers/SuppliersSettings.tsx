import { useEffect, useId, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Trash2 } from 'lucide-react';
import { outputLanguage } from '@mise/shared/market';
import { allergensOn, nutritionOn } from '@mise/shared/venue-features';
import { useT } from '../i18n/useT';
import { markBusy } from '../session/busy';
import { useSession, useSessionStore } from '../session/SessionContext';
import { FormBar } from '../ui/FormBar';
import { SettingSwitch } from '../ui/SettingSwitch';
import { useAlert } from '../ui/useAlert';
import { useConfirm } from '../ui/useConfirm';
import { useSuppliers, useSuppliersStore } from './SuppliersContext';
import type { PanelKey } from './suppliersSource';
import styles from './SuppliersSettings.module.css';

// How long «Saved ✓» stays beside what was just saved (the current app's number).
export const SAVED_MS = 2000;

type Props = {
  titleRef: Ref<HTMLHeadingElement>;
  onBack: () => void;
};

// Settings of «Ingredients & suppliers», for whoever runs the place (the section decides who gets here): whether this venue
// tracks allergens and nutrition, and the ingredient categories. A port of js/orders/registry-settings.js. The pack-photo
// switch is the third of the current app's and arrives with the pack photo (step 3e-8).
//
// ⚠️ IT LIVES ON THIS SCREEN, NOT THE RECIPE CATALOGUE'S: a venue can have Orders and no Catalogue, and switching allergens
// off must be possible there (parity S105).
export function SuppliersSettings({ titleRef, onBack }: Props) {
  const { t } = useT();
  const titleId = useId();
  return (
    <section className={styles.screen} aria-labelledby={titleId}>
      <FormBar backLabel={t('ui.back')} onBack={onBack} title={t('ui.settings')} titleId={titleId} titleRef={titleRef} />
      <div className={styles.body}>
        <IngredientCard />
        <CategoriesCard />
      </div>
    </section>
  );
}

// «Saved ✓», said where it happened. Its live region is on the page, empty, before it speaks.
function useSavedChip(): readonly [boolean, () => void] {
  const [shown, setShown] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  const show = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    setShown(true);
    timer.current = setTimeout(() => { timer.current = null; setShown(false); }, SAVED_MS);
  };
  return [shown, show];
}

function IngredientCard() {
  const { t } = useT();
  const headId = useId();
  return (
    <section className={styles.card} aria-labelledby={headId}>
      <div className={styles.head}>
        <h3 id={headId} className={styles.headTitle}>{t('sup.settings.ingredientCard')}</h3>
        <p className={styles.note}>{t('sup.settings.cardNote')}</p>
      </div>
      <PanelRow panel="showAllergens" asksBeforeOff />
      <PanelRow panel="showNutrition" />
    </section>
  );
}

// One of the venue's two panel switches. The venue document is read when the venue opens and does not follow a write made
// afterwards, so the switch is drawn from what the SESSION says and moves when the server has done it.
//
// ⚠️ ASKED ON THE WAY OUT, NEVER ON THE WAY IN (allergens only). Switching a safety feature ON needs no permission;
// switching it off takes the allergen card, the sheet and the label away from everybody in the venue, and that is worth one
// sentence. Nutrition asks neither way (parity S103). A cancelled question leaves the switch exactly as it was.
//
// ⚠️ THE ANSWER IS HELD HERE UNTIL THE SESSION SHOWS IT (the current app's override): the session is read again after the
// write, and if that read could not reach the server the switch still tells the truth about what was just done. A refusal
// holds nothing, so the switch is back at what is stored; the screen says so in a dialog.
function PanelRow({ panel, asksBeforeOff = false }: { panel: PanelKey; asksBeforeOff?: boolean }) {
  const { t } = useT();
  const store = useSuppliersStore();
  const { location } = useSession();
  const sessionStore = useSessionStore();
  const [confirm, confirmDialog] = useConfirm();
  const [alert, alertDialog] = useAlert();
  const ids = useId();
  const row = useRef<HTMLDivElement>(null);

  const fromSession = panel === 'showAllergens' ? allergensOn(location) : nutritionOn(location);
  const [held, setHeld] = useState<boolean | null>(null);
  useEffect(() => { if (held !== null && held === fromSession) setHeld(null); }, [held, fromSession]);
  const on = held ?? fromSession;

  const [running, setRunning] = useState(false);
  // In a ref as well: a second tap while the question is open or the call is in the air must be ignored at once.
  const working = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const [saved, showSaved] = useSavedChip();

  // ⚠️ A SWITCH THAT IS DISABLED WHILE THE CALL RUNS LOSES THE FOCUS: it goes back to it when the call is over.
  const refocus = useRef(false);
  useEffect(() => {
    if (running || !refocus.current) return;
    refocus.current = false;
    row.current?.querySelector('input')?.focus();
  }, [running]);

  const label = t(panel === 'showAllergens' ? 'sup.settings.showAllergens' : 'sup.settings.showNutrition');
  const note = t(panel === 'showAllergens' ? 'sup.settings.showAllergensNote' : 'sup.settings.showNutritionNote');

  async function change(next: boolean): Promise<void> {
    if (working.current) return;
    working.current = true;
    try {
      if (asksBeforeOff && !next) {
        const ok = await confirm({
          title: t('sup.settings.offTitle'),
          message: t('sup.settings.offBody'),
          okLabel: t('sup.settings.turnOff'),
          cancelLabel: t('common.cancel'),
          danger: true,
        });
        if (!ok || !mounted.current) return;
      }
      setRunning(true);
      refocus.current = true;
      // ⚠️ HELD BY THE CALL, NOT BY THE SCREEN: the store holds the busy marker until the server answers, even if Settings is
      // left meanwhile. The venue is read again only after the server has written.
      const release = markBusy();
      try {
        await store.setIngredientPanel(panel, next);
        await sessionStore.refreshLocation();
        if (mounted.current) {
          setHeld(next);
          showSaved();
        }
      } catch (error) {
        console.error(`Ingredient panel ${panel} not saved:`, error);
        if (mounted.current) await alert({ message: t('sup.notSaved', { name: label }), okLabel: t('common.ok') });
      } finally {
        release();
        if (mounted.current) setRunning(false);
      }
    } finally {
      working.current = false;
    }
  }

  return (
    <>
    <div ref={row} className={styles.row} aria-busy={running ? true : undefined}>
      <span className={styles.text}>
        <span id={`${ids}-title`} className={styles.title}>{label}</span>
        <span id={`${ids}-sub`} className={styles.sub}>{note}</span>
      </span>
      <span role="status" className={saved ? styles.saved : styles.quiet}>{saved ? t('settings.saved') : ''}</span>
      <SettingSwitch
        selected={on}
        onChange={next => { void change(next); }}
        labelledBy={`${ids}-title`}
        describedBy={`${ids}-sub`}
        isDisabled={running}
      />
    </div>
    {confirmDialog}
    {alertDialog}
    </>
  );
}

// The categories an ingredient can be filed under, one row each with a low-key trash. There is NO add or rename here:
// categories are added by typing in an ingredient's menu (step 3e-2) and deleted here (parity S106).
//
// ⚠️ EVERY TRASH IS DISABLED UNTIL config/orders AND THE INGREDIENTS HAVE REALLY ARRIVED: before that the list is only the
// defaults, and a delete would write them over the venue's own list (parity S107) or leave out the ingredients not yet seen. Deleting never moves the ingredients that used a category: they
// are left without one, and the question says how many.
function CategoriesCard() {
  const { t } = useT();
  const store = useSuppliersStore();
  const { configLoaded, ingredientsFromServer } = useSuppliers();
  // ⚠️ A category delete rewrites the list AND the ingredients that hold it: before the server has said which ingredients
  // there are, the ones missing from the browser's copy would keep the category and it would come back.
  const canDelete = configLoaded && ingredientsFromServer;
  const { location } = useSession();
  const [confirm, confirmDialog] = useConfirm();
  const headId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const trashes = useRef(new Map<string, HTMLButtonElement>());
  const [saved, showSaved] = useSavedChip();
  const asking = useRef(false);

  const language = outputLanguage(location) ?? 'en';
  const list = store.categories(language);
  const keyOf = (name: string) => name.trim().toLowerCase();

  // Where the focus goes once the deleted row has left the page: the trash that takes its place (the next row's, or the last
  // when it was the last), or the card's heading when none is left — never the page.
  const [after, setAfter] = useState<{ deleted: string; next: string | null } | null>(null);
  useEffect(() => {
    if (after === null || list.some(name => keyOf(name) === keyOf(after.deleted))) return;
    setAfter(null);
    const target = after.next === null ? undefined : trashes.current.get(after.next);
    (target ?? heading.current)?.focus();
  });

  async function remove(name: string): Promise<void> {
    if (asking.current) return;
    asking.current = true;
    try {
      const count = store.countInCategory(name);
      const ok = await confirm({
        title: t('sup.settings.deleteCategoryTitle'),
        message: count === 0 ? t('sup.settings.deleteCategoryNone', { name }) : t('sup.settings.deleteCategoryUsed', { name, n: count }),
        okLabel: t('ui.delete'),
        cancelLabel: t('common.cancel'),
        danger: true,
      });
      if (!ok) return;
      const index = list.findIndex(candidate => keyOf(candidate) === keyOf(name));
      const rest = list.filter(candidate => keyOf(candidate) !== keyOf(name));
      // The store writes to the phone's own database first: «Saved» is said at once, the screen follows, and a refusal is
      // said by the store (the category comes back).
      if (!store.deleteCategory(name, language)) return;
      showSaved();
      setAfter({ deleted: name, next: rest[Math.min(index, rest.length - 1)] ?? null });
    } finally {
      asking.current = false;
    }
  }

  return (
    <section className={styles.card} aria-labelledby={headId}>
      <div className={styles.head}>
        <h3 id={headId} ref={heading} tabIndex={-1} className={styles.headTitle}>{t('sup.settings.categories')}</h3>
        <p className={styles.note}>{t('sup.settings.categoriesNote')}</p>
        <span role="status" className={saved ? styles.saved : styles.quiet}>{saved ? t('settings.saved') : ''}</span>
      </div>
      {list.length === 0 ? (
        <div className={styles.row}>
          <span className={styles.text}><span className={styles.sub}>{t('sup.settings.categoriesEmpty')}</span></span>
        </div>
      ) : (
        <ul className={styles.rows}>
          {list.map(name => (
            <li key={name} className={styles.row}>
              <span className={styles.text}><span className={styles.title}>{name}</span></span>
              <button
                ref={node => {
                  if (node) trashes.current.set(name, node);
                  else trashes.current.delete(name);
                }}
                type="button"
                className={styles.trash}
                disabled={!canDelete}
                aria-label={t('sup.settings.deleteCategory', { name })}
                title={t('sup.settings.deleteCategory', { name })}
                onClick={() => { void remove(name); }}
              >
                <Trash2 aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {confirmDialog}
    </section>
  );
}
