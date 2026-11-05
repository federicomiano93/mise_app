import { useId, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  CRATE_PERBOX_DEFAULT, CRATE_PERBOX_MAX, CRATE_PERBOX_MIN, WEIGHT_MAX, WEIGHT_MIN, clampCratePerBox, clampWeight,
} from '@mise/shared/calculator-config';
import type { Client, Product } from '@mise/shared/calculator-config';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { useClientsEditor } from './clientsEditorContext';
import { isBlank } from './clientsModel';
import { SettingSwitch } from './SettingSwitch';
import styles from './ProductCard.module.css';

type Props = {
  client: Client;
  product: Product;
  // Take the focus when it appears (a product just added).
  autoFocus: boolean;
};

// One product of a client, described in full: its name, the recipe it belongs to, its unit weight, how the quantity is
// typed, the optional crate box, and whether it is active (a port of `productCard` in js/calculator-settings.js).
// Everything a product is lives here — there is no separate catalogue screen to visit first.
//
// ⚠️ A PAUSED PRODUCT STAYS HERE with its recipe, weight, type and crate, but leaves the Calculator until it is
// switched back on: pause instead of delete is the way to keep a product's settings.
export function ProductCard({ client, product, autoFocus }: Props) {
  const { t } = useT();
  const editor = useClientsEditor();
  const ids = useId();
  const id = (part: string) => `${ids}-${part}`;
  const paused = product.active === false;
  const invalid = editor.showErrors && isBlank(product.name);
  const patch = (changes: Partial<Product>) => { editor.patchProduct(client.id, product.id, changes); };
  // A product whose recipe was deleted shows (and is saved on) the first one, so the select never holds an empty box.
  const recipeId = editor.recipes.some(recipe => recipe.id === product.recipeId)
    ? product.recipeId
    : (editor.recipes[0]?.id ?? '');
  const crate = typeof product.crate === 'object' && product.crate !== null
    ? product.crate
    : { show: false, perBox: CRATE_PERBOX_DEFAULT };

  async function remove() {
    const ok = await editor.confirm({
      title: t('calc.removeThisProduct'),
      okLabel: t('ui.delete'),
      cancelLabel: t('common.cancel'),
      danger: true,
    });
    if (ok) editor.removeProduct(client.id, product.id);
  }

  return (
    <div
      role="group"
      aria-label={isBlank(product.name) ? t('calc.productName') : product.name}
      className={paused ? `${styles.card} ${styles.paused}` : styles.card}
    >
      <div className={styles.row}>
        <label htmlFor={id('name')} className={styles.label}>{t('calc.field.name')}</label>
        <input
          id={id('name')}
          type="text"
          className={invalid ? `${styles.input} ${styles.invalid}` : styles.input}
          value={product.name}
          placeholder={t('calc.productName')}
          autoComplete="off"
          autoFocus={autoFocus}
          aria-invalid={invalid ? true : undefined}
          onChange={event => { patch({ name: event.target.value }); }}
        />
      </div>

      <div className={styles.row}>
        <label htmlFor={id('recipe')} className={styles.label}>{t('ui.recipe')}</label>
        <select
          id={id('recipe')}
          className={styles.input}
          value={recipeId}
          disabled={editor.recipes.length === 0}
          onChange={event => { patch({ recipeId: event.target.value }); }}
        >
          {editor.recipes.map(recipe => <option key={recipe.id} value={recipe.id}>{recipe.name}</option>)}
        </select>
      </div>

      <div className={styles.row}>
        <label htmlFor={id('weight')} className={styles.label}>{t('calc.field.weight')}</label>
        <div className={styles.withUnit}>
          <NumberBox
            id={id('weight')}
            label={t('calc.weightInGrams')}
            value={product.weight}
            min={WEIGHT_MIN}
            max={WEIGHT_MAX}
            clamp={clampWeight}
            onChange={weight => { patch({ weight }); }}
          />
          <span className={styles.unit} aria-hidden="true">g</span>
        </div>
      </div>

      {product.kind === 'kg' ? (
        // A legacy kg product: the quantity is typed in kilograms, and it has no type or crate options.
        <div className={styles.row}>
          <span className={styles.label}>{t('calc.field.type')}</span>
          <span className={styles.kg}>kg</span>
        </div>
      ) : (
        <>
          <div className={styles.row}>
            <label htmlFor={id('kind')} className={styles.label}>{t('calc.field.type')}</label>
            <select
              id={id('kind')}
              className={styles.input}
              aria-label={t('calc.quantityType')}
              value={product.kind === 'dropdown' ? 'dropdown' : 'number'}
              onChange={event => { patch({ kind: event.target.value === 'dropdown' ? 'dropdown' : 'number' }); }}
            >
              <option value="number">{t('calc.type.number')}</option>
              <option value="dropdown">{t('calc.type.dropdown')}</option>
            </select>
          </div>

          <div className={styles.switchRow}>
            <span id={id('crate')} className={styles.switchName}>{t('calc.crateBox')}</span>
            <SettingSwitch
              selected={crate.show === true}
              onChange={show => { patch({ crate: { ...crate, show } }); }}
              labelledBy={id('crate')}
            />
          </div>
          {crate.show === true ? (
            // The pieces appear only once the box is switched on, rather than sitting there greyed out.
            <div className={styles.row}>
              <label htmlFor={id('perbox')} className={styles.label}>{t('calc.piecesPerCrate')}</label>
              <NumberBox
                id={id('perbox')}
                label={t('calc.piecesPerCrate')}
                value={crate.perBox}
                min={CRATE_PERBOX_MIN}
                max={CRATE_PERBOX_MAX}
                clamp={clampCratePerBox}
                onChange={perBox => { patch({ crate: { ...crate, perBox } }); }}
              />
            </div>
          ) : null}
        </>
      )}

      <div className={styles.switchRow}>
        <span id={id('active')} className={styles.switchName}>{t('ui.active')}</span>
        <SettingSwitch selected={!paused} onChange={active => { patch({ active }); }} labelledBy={id('active')} />
      </div>

      {/* Delete sits alone at the bottom right, away from everything that edits: a small icon that never competes with Save (P20). */}
      <div className={styles.foot}>
        {paused ? <span className={styles.tag}>{t('ui.paused')}</span> : null}
        <Button
          variant="bare"
          className={styles.del}
          aria-label={isBlank(product.name) ? t('calc.removeProduct') : t('calc.removeProductNamed', { name: product.name })}
          onPress={() => { void remove(); }}
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

type NumberBoxProps = {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  clamp: (value: unknown) => number;
  onChange: (value: number) => void;
};

// A whole-number box that keeps the number within its range as it is typed (never NaN, never out of range), and
// shows what was typed until it is left — a box that rewrote «6000» to «5000» under the finger would be fighting
// the person typing.
function NumberBox({ id, label, value, min, max, clamp, onChange }: NumberBoxProps) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      className={styles.input}
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      aria-label={label}
      value={draft ?? String(value)}
      onFocus={event => { event.currentTarget.select(); }}
      onChange={event => {
        setDraft(event.target.value);
        onChange(clamp(event.target.value));
      }}
      onBlur={() => { setDraft(null); }}
    />
  );
}
