import { useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { I18nContext } from '../i18n/I18nContext';
import type { Language } from '../i18n/i18n';
import { ChooseVenueScreen } from './ChooseVenueScreen';
import { LoadingScreen } from './LoadingScreen';
import { NoAccessScreen } from './NoAccessScreen';
import { useSession } from './SessionContext';
import { SessionErrorScreen } from './SessionErrorScreen';
import { SignInScreen } from './SignInScreen';

// The door. One screen per thing the session can be, and only `ready` lets the app through.
//
// ⚠️ THE APP IS NEVER DRAWN BEFORE THE SESSION SAYS A VENUE IS OPEN. Drawing it first and hiding
// it when signed out would show one frame of somebody's data to whoever is holding the phone.
// The children (the router) do not even exist until then, so no section can start listening to
// a venue that is not open yet.
export function SessionGate({ children }: { children: ReactNode }) {
  const session = useSession();

  switch (session.status) {
    case 'loading':
      return <LoadingScreen />;
    case 'signed-out':
      return <SignInScreen />;
    case 'choose-location':
      return <ChooseVenueScreen />;
    case 'no-access':
      return <NoAccessScreen />;
    case 'error':
      return <SessionErrorScreen />;
    case 'ready':
      return <InVenueLanguage language={session.language}>{children}</InVenueLanguage>;
  }
}

// ⚠️ THE VENUE'S LANGUAGE FIRST. Everything above a venue follows the phone's language; from the
// moment a venue is open its own language wins, even when the two disagree (a venue whose staff
// read English stays English on an Italian phone). The session loads that language BEFORE it
// says `ready`, so swapping is one frame — and the app is held back until the swap is done, so
// it is never drawn in the wrong language and then redrawn.
function InVenueLanguage({ language, children }: { language: Language | null; children: ReactNode }) {
  const { lang, setLanguage } = useContext(I18nContext);
  // The language we already asked for. If loading it fails, the app falls back to English
  // (loadLanguage) and `lang` never matches: without this the gate would wait for ever.
  const [asked, setAsked] = useState<Language | null>(null);

  useEffect(() => {
    if (language === null || language === lang) return;
    let current = true;
    void setLanguage(language).finally(() => {
      if (current) setAsked(language);
    });
    return () => { current = false; };
  }, [language, lang, setLanguage]);

  if (language !== null && language !== lang && asked !== language) return <LoadingScreen />;
  return children;
}
