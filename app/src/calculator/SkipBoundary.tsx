import { Component } from 'react';
import type { ReactNode } from 'react';

type Props = {
  children: ReactNode;
  // When this changes, a child that failed is tried again (a log whose data was replaced on another phone).
  resetKey?: string | number;
};
type State = { failed: boolean; seenKey: string | number | undefined };

// Draws nothing for a child that fails to draw. For one card of a list: a damaged log must not take its neighbours
// down, and a box saying «this part didn't load» in the middle of a list of dough would be noise for the person at
// the bench. React already reports what a boundary catches (the error report wraps console.error), so the owner
// still hears of it.
//
// ⚠️ A FAILURE IS NOT FOR EVER: when `resetKey` changes the child is drawn again, so a card whose data was fixed or
// replaced elsewhere comes back without a reload.
export class SkipBoundary extends Component<Props, State> {
  override state: State = { failed: false, seenKey: undefined };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.seenKey ? null : { seenKey: props.resetKey, failed: false };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
