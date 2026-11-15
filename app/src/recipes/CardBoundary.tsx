import { Component } from 'react';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  // The card threw while it was drawn: the host closes it and says so.
  onFail: () => void;
};

// ⚠️ THE «ADD AS AN INGREDIENT» CARD FAILING MUST NOT TAKE THE RECIPE EDITOR DOWN. The card is drawn inside the editor's tree, whose
// nearest boundary is the whole detail pane: a throw there would unmount the editor and lose the unsaved recipe. This one catches
// it first, draws nothing, and tells the editor (which closes the card, keeps its working copy and says it).
//
// `failed` is a flag, not the error: `throw undefined` is legal JavaScript.
export class CardBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(): void {
    this.props.onFail();
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
