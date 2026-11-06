// English is the SOURCE of the messages: it defines which keys exist, and Italian (it.ts) must
// match it exactly — a missing or an extra key there is a TYPE error, and `npm run build`
// type-checks before it builds, so an untranslated message cannot reach a phone.
//
// A message is a string, or a PluralMessage when its wording depends on a count — and that
// count is passed as `n`: t(key, { n }), `{n}` in the text, as in the current app. Keys are
// flat and grouped by prefix (nav., section., placeholder. …); a `{name}` in a message is
// filled in by format() in i18n.ts.

export type PluralMessage = {
  readonly one: string;
  readonly other: string;
  readonly zero?: string;
  readonly two?: string;
  readonly few?: string;
  readonly many?: string;
};

export type Message = string | PluralMessage;

export const en = {
  'app.name': 'Mise',
  'page.title': '{title} · Mise',

  'nav.rail': 'All sections',
  'nav.tabs': 'Main sections',
  'nav.skip': 'Skip to content',

  'section.orders': 'Orders',
  'section.suppliers': 'Suppliers',
  'section.recipes': 'Recipes',
  'section.calculator': 'Calculator',
  'section.pastries': 'Pastries',
  'section.stocktake': 'Stocktake',
  'section.foodcost': 'Food cost',
  'section.settings': 'Settings',
  'section.more': 'More',

  'placeholder.title': 'This section will arrive in one of the next steps of Mise 2.',
  'placeholder.body': 'Until then, keep using the app you use today.',

  'notFound.title': 'Page not found',
  'notFound.body': 'This address doesn’t lead to any section.',
  'notFound.action': 'Go to Orders',

  'status.online': 'Online',
  'status.offline': 'No connection',

  'part.failed.title': 'This part didn’t load.',
  'part.failed.body': 'The rest of the screen works.',
  'part.failed.action': 'Reload',

  'app.failed.title': 'Mise stopped working.',
  'app.failed.body': 'Reloading usually fixes it. Nothing you saved is lost.',
  'app.failed.action': 'Reload the app',
} as const satisfies Record<string, Message>;

export type MessageKey = keyof typeof en;

// The shape every language must have: the same keys as English, a string where English has
// a string and a PluralMessage where English has one. This is what makes a missing key a
// compile error instead of a blank on a screen.
export type Messages = {
  readonly [K in MessageKey]: (typeof en)[K] extends string ? string : PluralMessage;
};
