// version.ts — which release of Mise 2 this is, as the owner's statistics see it.
//
// «m2-<seven digits of the git commit>» stamped into the bundle by vite.config.ts, so a line
// from Mise 2 can never be mistaken for one from the current app (whose appVersion is the
// cache number, «649»), and the commit it names is the code that was running.
//
// ⚠️ AT MOST 12 CHARACTERS: the rules' limit on appVersion (pinned in version.spec.ts).

export const MISE2_VERSION: string = __MISE2_VERSION__;
