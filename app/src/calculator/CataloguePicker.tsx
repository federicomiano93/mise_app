import { useEffect, useRef, useState } from 'react';
import { normalizeSearchText } from '@mise/shared/catalogue-model';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import type { StoredDoc } from './calculatorSource';
import { useRecipesEditor } from './recipesEditorContext';
import styles from './CataloguePicker.module.css';

type Props = {
  // The person chose one. The picker waits for the answer (stamping the rows takes a moment) and ignores taps meanwhile.
  onChoose: (recipe: StoredDoc) => Promise<void>;
  // Escape, Back: nothing was chosen.
  onClose: () => void;
};

type Reading = { status: 'loading' } | { status: 'failed' } | { status: 'ready'; recipes: StoredDoc[] };

const nameOf = (doc: StoredDoc): string => String(doc.name ?? '').trim();

// The Catalogue's recipes, to pick one to link to. A dialog (focus kept inside, Escape closes), mounted only while
// it is open — and the Catalogue is read when it mounts, never before (P14: the Calculator reads only the two or
// three recipes its tabs are linked to).
//
// ⚠️ A READ THAT FAILS SAYS SO HERE, in the picker, and links nothing.
export function CataloguePicker({ onChoose, onClose }: Props) {
  const { t } = useT();
  const editor = useRecipesEditor();
  const [reading, setReading] = useState<Reading>({ status: 'loading' });
  const [query, setQuery] = useState('');
  const [choosing, setChoosing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // The editor hands back the SAME read to every caller, so a development double-mount reads the Catalogue once.
  const { loadCatalogue } = editor;
  useEffect(() => {
    let live = true;
    loadCatalogue().then(
      recipes => { if (live) setReading({ status: 'ready', recipes }); },
      () => { if (live) setReading({ status: 'failed' }); },
    );
    return () => { live = false; };
  }, [loadCatalogue]);

  async function choose(recipe: StoredDoc) {
    if (choosing) return;
    setChoosing(true);
    try {
      await onChoose(recipe);
    } finally {
      if (mounted.current) setChoosing(false);
    }
  }

  const wanted = normalizeSearchText(query);
  const shown = reading.status === 'ready'
    ? reading.recipes
      .map(recipe => ({ recipe, name: nameOf(recipe) || t('calc.unnamedRecipe') }))
      .filter(entry => wanted === '' || normalizeSearchText(entry.name).includes(wanted))
      .sort((a, b) => a.name.localeCompare(b.name))
    : [];

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('calc.pickCatalogueRecipe')}
      actions={<Button onPress={onClose}>{t('ui.back')}</Button>}
    >
      <input
        type="search"
        autoFocus
        autoComplete="off"
        className={styles.search}
        placeholder={t('calc.searchCatalogue')}
        aria-label={t('calc.searchCatalogue')}
        value={query}
        onChange={event => { setQuery(event.target.value); }}
      />
      <div className={styles.list} aria-busy={reading.status === 'loading' || choosing}>
        {reading.status === 'loading' || choosing ? <p className={styles.note}>{t('calc.loading')}</p> : null}
        <div role="alert">
          {reading.status === 'failed' ? <p className={styles.note}>{t('calc.catalogueListFailed')}</p> : null}
        </div>
        {reading.status === 'ready' && reading.recipes.length === 0 ? <p className={styles.note}>{t('calc.catalogueEmpty')}</p> : null}
        {reading.status === 'ready' && reading.recipes.length > 0 && shown.length === 0
          ? <p className={styles.note}>{t('calc.nothingMatches')}</p> : null}
        {shown.length > 0 ? (
          <ul className={styles.rows}>
            {shown.map(entry => (
              <li key={entry.recipe.id}>
                <button
                  type="button"
                  className={styles.row}
                  disabled={choosing}
                  onClick={() => { void choose(entry.recipe); }}
                >
                  {entry.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </Dialog>
  );
}
