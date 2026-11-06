import { Navigate } from 'react-router';
import { NotAvailable } from './NotAvailable';
import { KEEP_FOCUS } from './Page';
import { SectionPlaceholder } from './SectionPlaceholder';
import type { SectionId } from './sections';
import { useVisibleSections } from './useVisibleSections';

// A section's route: the section when it is on for this person, «not available» when it is not
// (an address typed by hand, an old bookmark, a venue that did not buy it).
//
// ⚠️ A SHOWN SECTION IS A GATE ON EVERYTHING LATER PUT BEHIND IT: the real screens of step 3
// replace SectionPlaceholder here, and they only ever exist behind this check.
export function SectionRoute({ sectionId }: { sectionId: SectionId }) {
  const { visible } = useVisibleSections();
  return visible.has(sectionId) ? <SectionPlaceholder sectionId={sectionId} /> : <NotAvailable sectionId={sectionId} />;
}

// The address with no section in it lands on the first section this person is shown — Orders for
// most, but a venue that did not buy Orders, or an employee kept from it, starts elsewhere.
// KEEP_FOCUS: that is the app arranging itself on first load, not a person asking to move.
export function StartRedirect() {
  const { first } = useVisibleSections();
  return <Navigate to={first.path} replace state={KEEP_FOCUS} />;
}
