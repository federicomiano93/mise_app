import { parseISODate, spellShortDate } from '@mise/shared/day';
import type { DayTranslate } from '@mise/shared/day';
import type { CalendarAlert } from '@mise/shared/notifications';
import { supplierLabel } from '@mise/shared/supplier-label';
import type { MessageKey } from '../i18n/en';
import type { MessageParams } from '../i18n/i18n';
import type { StoredDoc } from './ordersSource';

export type CalendarNotice = Exclude<CalendarAlert<StoredDoc>, { kind: 'order' }>;

// ⚠️ EVERY WORD IN THE READER'S LANGUAGE (finding F-6): the current app poured the English «tomorrow», an English weekday and a raw
// «2026-12-25» into its Italian sentences. Here the alert is data, and the weekday and the date are spelled with the dictionary.
export function noticeText(
  notice: CalendarNotice,
  t: (key: MessageKey, params?: MessageParams) => string,
  dt: DayTranslate,
): string {
  const date = spellShortDate(notice.iso, dt);
  if (notice.kind === 'holiday') {
    return notice.inDays === 1
      ? t('ord.notice.holidayTomorrow', { date })
      : t('ord.notice.holidayInDays', { n: notice.inDays, date });
  }
  const day = t(`day.weekdayLong.${parseISODate(notice.iso).getDay()}` as MessageKey);
  return t('ord.notice.deliveryClash', { supplier: supplierLabel(notice.supplier), day, date });
}
