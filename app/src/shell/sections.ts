import {
  BookOpen,
  Calculator,
  ChartPie,
  Croissant,
  LayoutGrid,
  Settings,
  ShoppingCart,
  Truck,
  Warehouse,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { isMonthId } from '@mise/shared/inventory-model';
import { isWeekday } from '@mise/shared/pastries-model';
import type { MessageKey } from '../i18n/en';
import { ordersScreenName } from '../orders/ordersPath';
import { parseRecipesPath } from '../recipes/recipesPath';
import { suppliersScreenName } from '../suppliers/suppliersPath';

export type SectionId =
  | 'orders'
  | 'suppliers'
  | 'recipes'
  | 'calculator'
  | 'pastries'
  | 'stocktake'
  | 'foodcost'
  | 'settings';

export type Section = {
  readonly id: SectionId;
  readonly path: string;
  readonly label: MessageKey;
  readonly icon: LucideIcon;
  // Where the tablet rail shows it: the main stack, or pinned to the bottom.
  readonly inRail: 'top' | 'bottom';
  // Whether the phone's tab bar has its own tab for it; the others live under «More».
  readonly inTabs: boolean;
};

// ⚠️ THE SINGLE SOURCE BOTH NAVIGATIONS READ FROM, in the order a person sees them. The rail,
// the tab bar, the «More» page and the routes are all built from this list, so a section can
// never be in one and forgotten in another. This is EVERY section there is; which of them a
// person is shown depends on the venue and the role (arrangeSections below, fed by
// session/visibility.ts) — and a shown section is a gate on everything later put behind it.
export const SECTIONS: readonly Section[] = [
  { id: 'orders', path: '/orders', label: 'section.orders', icon: ShoppingCart, inRail: 'top', inTabs: true },
  { id: 'suppliers', path: '/suppliers', label: 'section.suppliers', icon: Truck, inRail: 'top', inTabs: false },
  { id: 'recipes', path: '/recipes', label: 'section.recipes', icon: BookOpen, inRail: 'top', inTabs: true },
  { id: 'calculator', path: '/calculator', label: 'section.calculator', icon: Calculator, inRail: 'top', inTabs: true },
  { id: 'pastries', path: '/pastries', label: 'section.pastries', icon: Croissant, inRail: 'top', inTabs: false },
  { id: 'stocktake', path: '/stocktake', label: 'section.stocktake', icon: Warehouse, inRail: 'top', inTabs: true },
  { id: 'foodcost', path: '/food-cost', label: 'section.foodcost', icon: ChartPie, inRail: 'top', inTabs: false },
  { id: 'settings', path: '/settings', label: 'section.settings', icon: Settings, inRail: 'bottom', inTabs: false },
];

// The fifth tab on a phone: a page listing every section that has no tab of its own.
export const MORE = { path: '/more', label: 'section.more', icon: LayoutGrid } as const;

type ArrangedSections = {
  readonly railTop: readonly Section[];
  readonly railBottom: readonly Section[];
  // The phone's tabs, WITHOUT «More» (that one is not a section).
  readonly tabs: readonly Section[];
  // What «More» holds: every shown section that has no tab of its own.
  readonly more: readonly Section[];
  // Where the address with no section in it lands: the first section a person is shown.
  readonly first: Section;
};

// The sections a person is shown, split between the rail, the tab bar and «More», in list order.
//
// ⚠️ A FUNCTION OF WHO IS ASKING, NEVER A CONSTANT. These lists used to be module-level
// constants; a constant is evaluated when the file is loaded, when no venue is open, so it
// would freeze one list for every venue and every role for the life of the page.
//
// Settings is always shown (session/visibility.ts), so `first` always exists.
export function arrangeSections(visible: ReadonlySet<SectionId>): ArrangedSections {
  const shown = SECTIONS.filter(section => visible.has(section.id));
  return {
    railTop: shown.filter(section => section.inRail === 'top'),
    railBottom: shown.filter(section => section.inRail === 'bottom'),
    tabs: shown.filter(section => section.inTabs),
    more: shown.filter(section => !section.inTabs),
    first: shown[0] ?? sectionById('settings'),
  };
}

export function sectionById(id: SectionId): Section {
  const section = SECTIONS.find(candidate => candidate.id === id);
  if (!section) throw new Error(`Unknown section: ${id}`);
  return section;
}

function isUnder(pathname: string, path: string): boolean {
  return pathname === path || pathname.startsWith(`${path}/`);
}

// The message key naming the screen at a path: the section's label, «More» for its own page,
// «Page not found» for anything else. The shell uses it to name a screen that failed to draw
// (the section never got to print its own title), so it must agree with the route table.
export function titleKeyFor(pathname: string): MessageKey {
  if (isUnder(pathname, MORE.path)) return MORE.label;
  const section = SECTIONS.find(candidate => isUnder(pathname, candidate.path));
  return section ? section.label : 'notFound.title';
}

// The name the usage record and the error report give the screen at a path (announceScreen):
// the section's id, `more` for its own page, `not-found` for anything else.
//
// null for `/` itself: the address with no section in it redirects at once to the first section
// (StartRedirect), and that section announces itself. Counting `/` as «not found» would put a
// bogus screen and a bogus route at the start of every single visit.
//
// ⚠️ THESE NAMES ARE WHAT THE OWNER'S STATISTICS GROUP BY, so renaming a section's id renames
// its history. The record accepts only [a-z0-9:-] and 40 characters with «m2:» in front.
export function screenNameFor(pathname: string): string | null {
  if (pathname === '/') return null;
  if (isUnder(pathname, MORE.path)) return 'more';
  const section = SECTIONS.find(candidate => isUnder(pathname, candidate.path));
  if (!section) return 'not-found';
  if (section.id === 'pastries') return pastriesScreenName(pathname, section.path);
  if (section.id === 'stocktake') return stocktakeScreenName(pathname, section.path);
  if (section.id === 'foodcost') return foodcostScreenName(pathname, section.path);
  if (section.id === 'calculator') return calculatorScreenName(pathname, section.path);
  if (section.id === 'recipes') return recipesScreenName(pathname, section.path);
  // «Ingredients & suppliers» (step 3e): the names of docs/parity/suppliers.md, decision T1.
  if (section.id === 'suppliers') return suppliersScreenName(pathname.slice(section.path.length));
  // Orders (step 3f-1): the list, a supplier's order and its «What they sell».
  if (section.id === 'orders') return ordersScreenName(pathname.slice(section.path.length));
  return section.id;
}

// The Recipe catalogue is five screens so far that share one section: the list, one recipe (the current
// app's `''` and `detail`), the Allergen sheet (`recipes-allergens`), the label Settings (`recipes-settings`), a recipe's label (`recipes-label`, the current app's `label`) and the editor, new or existing (`recipes-editor`), the mixing steps (`recipes-steps`) the guided mix (`recipes-run`) the photo reader (`recipes-photo`), the HACCP list (`recipes-haccp`) and a recipe's HACCP label (`recipes-haccp-label`). A recipe opened beside the list is
// the same screen as on its own.
// ⚠️ ONLY AN ADDRESS THE SECTION DRAWS AS A RECIPE counts as one: a reserved word or junk is sent back to
// the list, and logging it as a recipe screen would put a screen nobody saw in the owner's statistics.
function recipesScreenName(pathname: string, base: string): string {
  const { kind } = parseRecipesPath(pathname.slice(base.length));
  if (kind === 'recipe') return 'recipes-detail';
  if (kind === 'allergens') return 'recipes-allergens';
  if (kind === 'settings') return 'recipes-settings';
  // A new recipe and an existing one's editor are one screen in the statistics (step 3d-6).
  if (kind === 'new' || kind === 'edit') return 'recipes-editor';
  // Reading a recipe from photographs (step 3d-9) is its own screen in the statistics.
  if (kind === 'photo') return 'recipes-photo';
  // The mixing steps editor (step 3d-8) is its own screen in the statistics.
  if (kind === 'steps') return 'recipes-steps';
  // The guided mix, the run (step 3d-8, slice B).
  if (kind === 'mix') return 'recipes-run';
  // The HACCP list and a recipe's HACCP label (image labels step 2) are two screens in the statistics.
  if (kind === 'haccp') return 'recipes-haccp';
  if (kind === 'haccpLabel') return 'recipes-haccp-label';
  return kind === 'label' ? 'recipes-label' : 'recipes';
}

// The Stocktake is three screens that share one section: the month's counting list (whichever
// month), one product, and «What the month cost». Changing month is not a new screen, so every
// month's list is plain `stocktake`. (The sentence an employee gets where a month cannot be opened
// for them is a fourth, announced by the section itself when it arises: the address does not change.)
function stocktakeScreenName(pathname: string, base: string): string {
  const rest = pathname.slice(base.length).split('/').filter(part => part !== '');
  if (rest.length === 3 && isMonthId(rest[0]) && rest[1] === 'product') return 'stocktake-product';
  if (rest.length === 2 && isMonthId(rest[0]) && rest[1] === 'cost') return 'stocktake-cost';
  return 'stocktake';
}

// Food cost is four screens that share one section: the list of products, a product (an existing
// one or a new one), its margin history and Settings. A product opened beside the list is the same
// screen as on its own.
function foodcostScreenName(pathname: string, base: string): string {
  const rest = pathname.slice(base.length).split('/').filter(part => part !== '');
  if (rest.length === 1 && rest[0] === 'new') return 'foodcost-product';
  if (rest.length === 1 && rest[0] === 'settings') return 'foodcost-settings';
  if (rest.length === 2 && rest[0] === 'product') return 'foodcost-product';
  if (rest.length === 3 && rest[0] === 'product' && rest[2] === 'history') return 'foodcost-history';
  return 'foodcost';
}

// The Calculator is three screens that share one section: the work view (whichever recipe's tab), Settings
// (the hub and every screen under it, which is how the current app's usage record has always named them) and the
// Dough history (`log`, and `log-history` for a log's versions and one version: the current app's own names). Add and
// Edit are `log` for now. Changing tab is not a new screen. ⚠️ `settings` is also the name of the Settings section's own page, so
// the owner's statistics count the two together (the decision for the night run of 12 Oct 2026).
function calculatorScreenName(pathname: string, base: string): string {
  const [first, , third] = pathname.slice(base.length).split('/').filter(part => part !== '');
  if (first === 'settings') return 'settings';
  if (first === 'log') return third === 'history' ? 'log-history' : 'log';
  // Orders received, still coming or history: the current app's overlay is one screen, `client-orders`.
  if (first === 'orders') return 'client-orders';
  return 'calculator';
}

// What the usage record calls the sentence an employee gets in place of a month the rules refuse
// them (a closed month, or the Stocktake no longer shown to employees). Announced by the section.
export const STOCKTAKE_UNAVAILABLE_SCREEN = 'stocktake-unavailable';

// Pastries is three screens that share one section: the day (the list, whichever day), its editor
// and Records. Picking another day is not a new screen, so every day is plain `pastries`.
function pastriesScreenName(pathname: string, base: string): string {
  const rest = pathname.slice(base.length).split('/').filter(part => part !== '');
  if (rest.length === 1 && rest[0] === 'records') return 'pastries-records';
  if (rest.length === 2 && isWeekday(rest[0]) && rest[1] === 'edit') return 'pastries-editor';
  return 'pastries';
}

// «More» is the current tab on its own page AND on every section it holds: standing on
// Suppliers on a phone, the tab bar must still say where you are, and the only tab that
// leads there is «More». `more` is the list THIS person's «More» holds (arrangeSections).
export function moreIsCurrent(pathname: string, more: readonly Section[]): boolean {
  return isUnder(pathname, MORE.path) || more.some(section => isUnder(pathname, section.path));
}
