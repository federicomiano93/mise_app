import { useEffect, useState } from 'react';
import { asLabelLogo } from './imageLabelData';
import type { LabelLogo } from './imageLabelData';
import { useRecipesStore } from './RecipesContext';

// The image label's logo, followed live for as long as the screen that calls this is on screen (P14: the section never
// watches it). NEW IN MISE 2.
//
//   loading     — nothing believable yet;
//   none        — the venue has no logo (the server said so, or it was just taken away on this phone);
//   unreadable  — a document is there but is not a logo the rules would have let in: the label refuses it like none;
//   failed      — the read was refused or failed and nothing was held;
//   ready       — the logo.
//
// ⚠️ «NO DOCUMENT» FROM THE BROWSER'S OWN DATABASE IS NOT BELIEVED on its own: that database may simply never have read
// this document, and a label screen opened offline would say «no logo» about a venue that has one. It is believed only
// over a logo held a moment ago (this phone took it away: Firestore shows its own writes at once).
export type LogoState =
  | { readonly status: 'loading' | 'none' | 'unreadable' | 'failed' }
  | { readonly status: 'ready'; readonly logo: LabelLogo };

export function useLabelLogo(): LogoState {
  const store = useRecipesStore();
  const [state, setState] = useState<LogoState>({ status: 'loading' });

  useEffect(() => {
    setState({ status: 'loading' });
    return store.watchLabelLogo(
      (data, meta) => {
        if (data === null) {
          setState(previous => (meta.fromServer || previous.status === 'ready' ? { status: 'none' } : previous));
          return;
        }
        const logo = asLabelLogo(data);
        setState(logo === null ? { status: 'unreadable' } : { status: 'ready', logo });
      },
      () => {
        setState(previous => (previous.status === 'loading' ? { status: 'failed' } : previous));
      },
    );
  }, [store]);

  return state;
}
