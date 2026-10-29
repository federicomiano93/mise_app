import { useId } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  HACCP_FIELDS, HACCP_SIZES, HACCP_STATES, haccpListCategory, haccpSettingsOf, haccpSizeMm,
} from '@mise/shared/haccp-label';
import type { HaccpField, HaccpSize, HaccpState } from '@mise/shared/haccp-label';
import { sortedCategories } from '@mise/shared/recipe-shelf';
import type { MessageKey } from '../i18n/en';
import { useT } from '../i18n/useT';
import { HACCP_FIELD_TEXT } from './haccpText';
import { useRecipes } from './RecipesContext';
import { SegmentedChoice } from './SegmentedChoice';
import styles from './LabelSettings.module.css';

// What each state SAYS, as KEYS resolved while drawing (the language arrives after the module is read).
const STATE_TEXT: Readonly<Record<HaccpState, MessageKey>> = {
  off: 'haccp.state.off',
  print: 'haccp.state.print',
  blank: 'haccp.state.blank',
};
// The notes under three of the rows: the ones whose meaning is not in their name.
const FIELD_NOTE: Readonly<Partial<Record<HaccpField, MessageKey>>> = {
  useBy: 'haccp.settings.note.useBy',
  preparedBy: 'haccp.settings.note.preparedBy',
  allergens: 'haccp.settings.note.allergens',
};

export const sizeText = (size: HaccpSize): string => {
  const { width, height } = haccpSizeMm(size);
  return `${width} × ${height} mm`;
};

// The HACCP label's card in the label Settings (image labels step 2): the size, which recipes the HACCP list shows, and
// the eleven fields with three states each. NEW IN MISE 2.
//
// ⚠️ SAVES ON THE TAP, like every other card, through the same `save` (the store puts a refused change back and the page's
// status line says so). THE FIELDS ARE WRITTEN AS ONE WHOLE MAP `{ haccpFields: { …all 11 } }`, built from what the venue
// holds now with the one change: the stored map then says every field's state outright, never «missing = its default»
// (a merge write would keep the other keys anyway; sending all eleven is what makes the stored map complete).
//
// ⚠️ THE LIST FILTER OFFERS ONLY WHAT THE VENUE HAS: «All recipes» and each recipe category. A word stored that is no longer
// on the list shows as «All recipes» (haccpListCategory), the same reading the HACCP list itself has.
export function HaccpSettingsCard({ save }: { save: (patch: Readonly<Record<string, unknown>>) => void }) {
  const { t, locale } = useT();
  const { labelConfig, categories } = useRecipes();
  const settings = haccpSettingsOf(labelConfig);
  const headId = useId();
  const sizeId = useId();
  const categoryId = useId();
  const words = sortedCategories(categories, locale);
  const listed = haccpListCategory(settings, categories) ?? '';

  return (
    <section className={styles.card} aria-labelledby={headId}>
      <div className={styles.head}>
        <h3 id={headId} className={styles.headTitle}>{t('haccp.settings.title')}</h3>
        <p className={styles.note}>{t('haccp.settings.intro')}</p>
      </div>

      <div className={styles.field}>
        <label htmlFor={sizeId} className={styles.fieldName}>{t('haccp.settings.size')}</label>
        <span className={styles.selectCell}>
          <select
            id={sizeId}
            className={styles.select}
            value={settings.size}
            onChange={event => {
              const size = HACCP_SIZES.find(candidate => candidate === event.target.value);
              if (size !== undefined && size !== settings.size) save({ haccpSize: size });
            }}
          >
            {HACCP_SIZES.map(size => <option key={size} value={size}>{sizeText(size)}</option>)}
          </select>
          <ChevronDown aria-hidden="true" className={styles.selectChevron} />
        </span>
      </div>

      {words.length > 0 ? (
        <div className={styles.field}>
          <label htmlFor={categoryId} className={styles.fieldName}>{t('haccp.settings.category')}</label>
          <span className={styles.selectCell}>
            <select
              id={categoryId}
              className={styles.select}
              value={listed}
              onChange={event => {
                const word = event.target.value;
                if (word === listed) return;
                // ⚠️ «ALL RECIPES» IS A REMOVAL (null), never an empty word: the rules take a word of 1 to 100 characters.
                save({ haccpCategory: word === '' ? null : word });
              }}
            >
              <option value="">{t('haccp.settings.categoryAll')}</option>
              {words.map(word => <option key={word} value={word}>{word}</option>)}
            </select>
            <ChevronDown aria-hidden="true" className={styles.selectChevron} />
          </span>
        </div>
      ) : (
        <div className={styles.field}>
          <p className={styles.note}>{t('haccp.settings.categoryHint')}</p>
        </div>
      )}

      <div className={styles.field}>
        <p className={styles.fieldName}>{t('haccp.settings.fields')}</p>
      </div>
      {HACCP_FIELDS.map(field => {
        const noteKey = FIELD_NOTE[field];
        return (
          <SegmentedChoice
            key={field}
            label={t(HACCP_FIELD_TEXT[field])}
            choices={HACCP_STATES.map(state => ({ value: state, text: t(STATE_TEXT[state]) }))}
            selected={settings.fields[field]}
            onSelect={state => {
              if (state !== settings.fields[field]) save({ haccpFields: { ...settings.fields, [field]: state } });
            }}
            note={noteKey === undefined ? undefined : t(noteKey)}
          />
        );
      })}
    </section>
  );
}
