import { dayWhen, localDayOf, todayISO } from '@mise/shared/day';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import { dayTranslate } from './dayWords';
import { NO_SUPPLIER_ID } from './ordersLens';
import type { StoredDoc } from './ordersSource';

type Say = (key: MessageKey, params?: MessageParams) => string;

// The name of the supplier a question is about, as it is read: the pseudo-supplier has no document and is named by the language.
export function awaitingSupplierName(suppliers: readonly StoredDoc[], supplierId: string, t: Say): string {
  if (supplierId === NO_SUPPLIER_ID) return t('ord.noSupplier');
  return supplierLabel(suppliers.find(supplier => supplier.id === supplierId));
}

// «Order to Bruno sent at 10:42: did it go?» — with the day too when it was not today («sent yesterday at 18:05»). The time is the
// interface language's own, two digits for the hour and the minute; the day is a spoken phrase («yesterday», «on Fri 13 Nov»).
export function awaitingSentence(t: Say, locale: string, supplierName: string, at: string): string {
  const when = new Date(at);
  const valid = !Number.isNaN(when.getTime());
  const time = valid ? new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(when) : '';
  const day = valid ? localDayOf(at) : '';
  return day !== '' && day !== todayISO()
    ? t('ord.awaiting.questionDay', { supplier: supplierName, when: dayWhen(day, new Date(), dayTranslate(t)), time })
    : t('ord.awaiting.question', { supplier: supplierName, time });
}
