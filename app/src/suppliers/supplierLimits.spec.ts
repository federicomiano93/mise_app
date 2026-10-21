import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CATEGORY_MAX, EMAIL_MAX, NAME_MAX, PHONE_MAX, SHORT_NAME_MAX, VAT_MAX } from './SupplierCard';

// The card's maxLength numbers ARE the rules' numbers: a longer entry closes the card local-first, the server refuses it and
// everything typed is lost. This reads firestore.rules itself, so a rule that changes breaks this spec first.
const rules = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'firestore.rules'), 'utf8');

// The suppliers whitelist block: from its key list to the `active` check that follows the last text limit.
const block = rules.slice(rules.indexOf("'deliveryDays', 'orderDays', 'active', 'notifyHoursBefore',"));

function limitOf(field: string): number {
  const found = new RegExp(String.raw`request\.resource\.data\.${field}\.size\(\) <= (\d+)`).exec(block);
  if (!found) throw new Error(`no size limit for ${field} in the suppliers rules`);
  return Number(found[1]);
}

describe('the supplier card\'s limits are the suppliers rules\' limits', () => {
  it.each([
    ['name', NAME_MAX],
    ['shortName', SHORT_NAME_MAX],
    ['category', CATEGORY_MAX],
    ['phone', PHONE_MAX],
    ['email', EMAIL_MAX],
    ['vatNumber', VAT_MAX],
  ])('%s', (field, max) => {
    expect(max).toBe(limitOf(field));
  });
});
