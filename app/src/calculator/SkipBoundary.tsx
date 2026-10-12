import { Component } from 'react';
import type { ReactNode } from 'react';

// Draws nothing for a child that fails to draw. For one card of a list: a damaged log must not take its neighbours
// down, and a box saying «this part didn't load» in the middle of a list of dough would be noise for the person at
// the bench. React already reports what a boundary catches (the error report wraps console.error), so the owner
// still hears of it.
export class SkipBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
