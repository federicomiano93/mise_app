import { useEffect, useState } from 'react';

// ⚠️ A LIVE REGION INSERTED ALREADY FILLED IS NOT ANNOUNCED RELIABLY (docs/architecture.md, «Traps already paid for»): it is drawn empty
// and its words come in an effect, after it is on the page.
export function useSpoken(text: string): string {
  const [said, setSaid] = useState('');
  useEffect(() => { setSaid(text); }, [text]);
  return said;
}
