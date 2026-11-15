import { vatGuideFor } from '@mise/shared/vat-guide';
import { useT } from '../i18n/useT';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import styles from './VatGuideDialog.module.css';

type Props = {
  // The venue's country: the law the guide states, and the language its items are written in.
  country: unknown;
  // The rate the product has now, so the guide can say «In use» beside it.
  currentRate: number | null;
  // «Use 10%»: the same rule as the menu applies it (the editor's applyVat), and the guide closes.
  onUse: (rate: number) => void;
  onClose: () => void;
};

// «which products take which VAT rate», opened from the button beside the VAT menu.
//
// ⚠️ TWO LANGUAGES ON ONE SCREEN, ON PURPOSE. The guide's ITEMS, NOTES and source titles name foods
// and laws, so they are drawn exactly as stored, in the venue's COUNTRY's language (the rule every
// food word follows); the screen around them — title, the disclaimer, «Use 10%», the date — is
// interface and follows the interface language.
// ⚠️ A GUIDE, NOT A RULING: it opens with «your accountant confirms».
export function VatGuideDialog({ country, currentRate, onUse, onClose }: Props) {
  const { t, locale } = useT();
  const guide = vatGuideFor(country);

  return (
    <Dialog
      isOpen
      onClose={onClose}
      title={t('fc.vatGuide.title')}
      actions={<Button onPress={onClose}>{t('ui.back')}</Button>}
    >
      <div className={styles.body}>
        <p className={styles.disclaimer}>{t('fc.vatGuide.disclaimer')}</p>

        {guide.rates.map(group => (
          <section key={group.rate} className={styles.group}>
            <div className={styles.head}>
              <h3 className={styles.rate}>{t('fc.vatGuide.rate', { rate: String(group.rate) })}</h3>
              {currentRate !== null && currentRate === group.rate
                ? <span className={styles.inUse}>{t('fc.vatGuide.inUse')}</span>
                // A rate the guide says nothing here takes offers no button to use it.
                : group.none === true
                  ? null
                  : (
                    <Button onPress={() => { onUse(group.rate); }}>
                      {t('fc.vatGuide.use', { rate: String(group.rate) })}
                    </Button>
                  )}
            </div>
            <ul className={styles.items}>
              {group.items.map((item, index) => <li key={index}>{item}</li>)}
            </ul>
          </section>
        ))}

        {guide.notes.length === 0 ? null : (
          <section className={styles.group}>
            <h3 className={styles.rate}>{t('fc.vatGuide.notes')}</h3>
            <ul className={styles.items}>
              {guide.notes.map((note, index) => <li key={index}>{note}</li>)}
            </ul>
          </section>
        )}

        <div className={styles.sources}>
          <p>{t('fc.vatGuide.sources', { date: checkedDate(guide.checkedOn, locale) })}</p>
          <ul className={styles.items}>
            {guide.sources.map(source => (
              <li key={source.url}>
                <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Dialog>
  );
}

// A date written as it is read — «13 settembre 2026», «13 September 2026» — in the interface
// language. Noon, so no time zone can move the day.
function checkedDate(iso: string, locale: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' });
}
