import { Component, createRef } from 'react';
import type { ErrorInfo, ReactNode, RefObject } from 'react';
import { Button } from 'react-aria-components';
import { CloudOff, RotateCw } from 'lucide-react';
import { useT } from '../i18n/useT';
import { Page } from '../shell/Page';
import { ScreenLoadError } from './ScreenLoadError';
import styles from './PartBoundary.module.css';

type Props = {
  children: ReactNode;
  // When this changes while the fallback is showing, the boundary tries its children again.
  // The shell passes the section's path, so moving to another section recovers by itself.
  resetKey?: string;
  // The name of the screen this boundary guards. Given, the fallback is drawn inside a Page
  // with it: the screen keeps its h1, its browser-tab title and the focus move after a
  // navigation. Left out, the fallback is just the box — for a part INSIDE a screen, whose own
  // heading is already on show.
  title?: string;
  // Not how the error report hears of a failure: React already logs what a boundary catches with
  // console.error, which the report wraps (telemetry/startTelemetry.ts). Calling the report from
  // here too would send every render error twice. For a part that wants to know for its own sake.
  onError?: (error: unknown, info: ErrorInfo) => void;
};

type State = {
  failed: boolean;
  // What failed was the download of a screen's code: only a new page load can fix that.
  pageReload: boolean;
  resetKey: string | undefined;
};

// ⚠️ ONE FAILING PART MUST NOT TAKE THE SCREEN DOWN. Without a boundary, an error thrown while
// drawing one section unmounts the whole tree: a white page, no navigation, nothing to tap.
// With this one around a section, the rail and the top bar stay, the section says so in
// words, and «Reload» draws it again.
//
// `failed` is a flag, not the error itself: `throw undefined` is legal JavaScript, and an error
// stored as a value would then look like «no error».
export class PartBoundary extends Component<Props, State> {
  override state: State = { failed: false, pageReload: false, resetKey: this.props.resetKey };

  private container = createRef<HTMLDivElement>();
  private fallback = createRef<HTMLDivElement>();
  private focusAfterReload = false;

  static getDerivedStateFromError(error: unknown): Partial<State> {
    return { failed: true, pageReload: error instanceof ScreenLoadError };
  }

  // Synchronous, before the render: the new section is drawn straight away, instead of the
  // fallback flashing for one frame after the user already moved on.
  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    if (props.resetKey === state.resetKey) return null;
    return { failed: false, pageReload: false, resetKey: props.resetKey };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  // ⚠️ THE «RELOAD» BUTTON IS UNMOUNTED WHEN THE CHILDREN COME BACK, AND THE FOCUS GOES WITH
  // IT: to <body>, where a keyboard user is lost and a screen reader says nothing. So the focus
  // is put back on the restored screen's heading (its first h1), or on the container if it has
  // none. Only after THIS button: a recovery through resetKey is a navigation, and Page moves
  // the focus after those itself.
  //
  // ⚠️ A PART THAT FAILS AGAIN LOSES THE FOCUS TOO: when a boundary catches an error React
  // throws away the fallback it showed and builds a new one, so the button the person just
  // pressed is a different element. The new button takes the focus.
  override componentDidUpdate(_previous: Props, previousState: State): void {
    if (!this.focusAfterReload) return;
    this.focusAfterReload = false;
    if (!previousState.failed) return;
    if (this.state.failed) this.fallback.current?.querySelector('button')?.focus();
    else focusRestored(this.container.current);
  }

  // ⚠️ A SCREEN THAT COULD NOT BE DOWNLOADED IS NOT FIXED BY DRAWING IT AGAIN: React.lazy and the
  // browser both remember the failed import for the life of the page, so «Reload» would rethrow the
  // same error at once, for ever. Only a new page load downloads it afresh (see ScreenLoadError).
  // Anything else gets the soft reset: a bug in a screen can pass.
  private reload = (): void => {
    if (this.state.pageReload) {
      window.location.reload();
      return;
    }
    this.focusAfterReload = true;
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (this.state.failed) return <PartFailed title={this.props.title} onReload={this.reload} boxRef={this.fallback} />;
    return <div ref={this.container} tabIndex={-1}>{this.props.children}</div>;
  }
}

function focusRestored(container: HTMLElement | null): void {
  if (!container) return;
  const heading = container.querySelector('h1');
  if (!heading) {
    container.focus();
    return;
  }
  // A heading is not focusable unless it carries a tabindex; Page's does, anybody else's may not.
  if (!heading.hasAttribute('tabindex')) heading.tabIndex = -1;
  heading.focus();
}

// A function component, so it can read the language from the context like every other
// screen; the class above cannot call a hook.
type FailedProps = {
  title: string | undefined;
  onReload: () => void;
  boxRef: RefObject<HTMLDivElement | null>;
};

function PartFailed({ title, onReload, boxRef }: FailedProps) {
  const { t } = useT();
  const box = (
    <div ref={boxRef} role="status" className={styles.failed}>
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
  return title === undefined ? box : <Page title={title}>{box}</Page>;
}
