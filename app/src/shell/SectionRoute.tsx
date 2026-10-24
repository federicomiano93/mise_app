import { Suspense } from 'react';
import { Navigate } from 'react-router';
import { useT } from '../i18n/useT';
import { NotAvailable } from './NotAvailable';
import { KEEP_FOCUS, Page } from './Page';
import { SectionPlaceholder } from './SectionPlaceholder';
import { SECTION_SCREENS } from './sectionScreens';
import { sectionById } from './sections';
import type { SectionId } from './sections';
import { useVisibleSections } from './useVisibleSections';

// A section's route: the section when it is on for this person, «not available» when it is not
// (an address typed by hand, an old bookmark, a venue that did not buy it).
//
// ⚠️ A SHOWN SECTION IS A GATE ON EVERYTHING LATER PUT BEHIND IT: the real screens of step 3
// replace SectionPlaceholder here, and they only ever exist behind this check. A built section is
// fetched when it is first drawn (sectionScreens.ts), so a hidden one never loads its code.
export function SectionRoute({ sectionId }: { sectionId: SectionId }) {
  const { visible } = useVisibleSections();
  if (!visible.has(sectionId)) return <NotAvailable sectionId={sectionId} />;

  const Screen = SECTION_SCREENS[sectionId];
  if (!Screen) return <SectionPlaceholder sectionId={sectionId} />;
  return (
    <Suspense fallback={<SectionLoading sectionId={sectionId} />}>
      <Screen />
    </Suspense>
  );
}

// While a section's code is on its way: its title (so the screen already has its h1 and its tab
// title) and a quiet line. Not a live region — a status announced for the fraction of a second
// the fetch takes would only be noise.
function SectionLoading({ sectionId }: { sectionId: SectionId }) {
  const { t } = useT();
  return (
    <Page title={t(sectionById(sectionId).label)}>
      <p>{t('session.loading')}</p>
    </Page>
  );
}

// The address with no section in it lands on the first section this person is shown — Orders for
// most, but a venue that did not buy Orders, or an employee kept from it, starts elsewhere.
// KEEP_FOCUS: that is the app arranging itself on first load, not a person asking to move.
export function StartRedirect() {
  const { first } = useVisibleSections();
  return <Navigate to={first.path} replace state={KEEP_FOCUS} />;
}
