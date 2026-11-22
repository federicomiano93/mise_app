// The page loaded again, so the policy written at load (csp-plugin.ts) names the printer just saved. Its own module, so a spec
// can stand in for it (jsdom cannot reload).
import { markLeavingOnPurpose } from '../session/busy';

export function reloadPage(): void {
  markLeavingOnPurpose();
  window.location.reload();
}
