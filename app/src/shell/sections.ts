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
import type { MessageKey } from '../i18n/en';

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

// «More» is the current tab on its own page AND on every section it holds: standing on
// Suppliers on a phone, the tab bar must still say where you are, and the only tab that
// leads there is «More». `more` is the list THIS person's «More» holds (arrangeSections).
export function moreIsCurrent(pathname: string, more: readonly Section[]): boolean {
  return isUnder(pathname, MORE.path) || more.some(section => isUnder(pathname, section.path));
}
