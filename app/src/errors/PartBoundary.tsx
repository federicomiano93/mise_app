import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Button } from 'react-aria-components';
import { CloudOff, RotateCw } from 'lucide-react';
import { useT } from '../i18n/useT';
import styles from './PartBoundary.module.css';

type Props = {
  children: ReactNode;
  // When this changes while the fallback is showing, the boundary tries its children again.
  // The shell passes the section's path, so moving to another section recovers by itself.
  resetKey?: string;
  // 2b-2 connects the error report here.
  onError?: (error: unknown, info: ErrorInfo) => void;
};

type State = { failed: boolean; resetKey: string | undefined };

// ⚠️ ONE FAILING PART MUST NOT TAKE THE SCREEN DOWN. Without a boundary, an error thrown while
// drawing one section unmounts the whole tree: a white page, no navigation, nothing to tap.
// With this one around a section, the rail and the top bar stay, the section says so in
// words, and «Reload» draws it again.
//
// `failed` is a flag, not the error itself: `throw undefined` is legal JavaScript, and an error
// stored as a value would then look like «no error».
export class PartBoundary extends Component<Props, State> {
  override state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  // Synchronous, before the render: the new section is drawn straight away, instead of the
  // fallback flashing for one frame after the user already moved on.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { failed: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  private reload = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) return <PartFailed onReload={this.reload} />;
    return this.props.children;
  }
}

// A function component, so it can read the language from the context like every other
// screen; the class above cannot call a hook.
function PartFailed({ onReload }: { onReload: () => void }) {
  const { t } = useT();
  return (
    <div role="status" className={styles.failed}>
      <CloudOff className={styles.icon} aria-hidden="true" />
      <div className={styles.text}>
        <p className={styles.title}>{t('part.failed.title')}</p>
        <p className={styles.body}>{t('part.failed.body')}</p>
      </div>
      <Button className={styles.reload} onPress={onReload}>
        <RotateCw aria-hidden="true" />
        <span>{t('part.failed.action')}</span>
      </Button>
    </div>
  );
}
