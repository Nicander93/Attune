import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Keeps a rendering failure inside the page that caused it.
 *
 * Without this a single bad material would blank the whole window and the user would
 * lose their way back to the library - the worst possible outcome for an app whose
 * only job is not to lose work.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('页面渲染失败：', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="placeholder">
        <h1>这个页面出了点问题</h1>
        <p className="muted">{String(this.state.error.message || this.state.error)}</p>
        <p className="muted">你的素材和草稿都还在本地数据库里，没有丢失。</p>
        <button
          className="primary"
          onClick={() => {
            this.setState({ error: null });
            window.location.assign('/');
          }}
        >
          回到首页
        </button>
      </section>
    );
  }
}
