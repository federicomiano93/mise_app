import type { HaccpField } from '@mise/shared/haccp-label';
import type { MessageKey } from '../i18n/en';

// What each HACCP field is CALLED on the screens (the Settings card's rows, the label screen's boxes): KEYS, resolved while
// drawing, because a constant holding the words would freeze the language the page booted in. These are the interface's
// words; the words PRINTED on the label are the country's (shared/haccp-label.ts, haccpCaption).
export const HACCP_FIELD_TEXT: Readonly<Record<HaccpField, MessageKey>> = {
  name: 'haccp.field.name',
  preparedOn: 'haccp.field.preparedOn',
  useBy: 'haccp.field.useBy',
  lot: 'haccp.field.lot',
  preparedBy: 'haccp.field.preparedBy',
  storage: 'haccp.field.storage',
  blastChilledOn: 'haccp.field.blastChilledOn',
  frozenOn: 'haccp.field.frozenOn',
  openedOn: 'haccp.field.openedOn',
  quantity: 'haccp.field.quantity',
  allergens: 'haccp.field.allergens',
};
