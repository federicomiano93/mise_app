import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { RootError } from './RootError';

type Props = {
  children: ReactNode;
  // 2b-2 connects the error report here.
  onError?: (error: unknown, info: ErrorInfo) => void;
};

type State = { failed: boolean };

// The last line of defence, wrapped around everything in main.tsx. The router has its own
// errorElement for a failure inside a route; this catches what is OUTSIDE the router — the
// provider, the router's own setup — which would otherwise leave a blank page. It shows the
// same screen as the router does.
export class AppBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override render(): ReactNode {
    if (this.state.failed) return <RootError />;
    return this.props.children;
  }
}
