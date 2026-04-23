import { Component, type ErrorInfo, type ReactNode } from 'react';
import { tryInvoke } from '../lib/ipc';

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    void tryInvoke('log:render-error', {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack ?? undefined,
      route: typeof window !== 'undefined' ? window.location.hash : undefined,
    });
  }

  reset = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return <DefaultFallback error={error} reset={this.reset} details={this.state.componentStack} />;
  }
}

function DefaultFallback({
  error,
  reset,
  details,
}: {
  error: Error;
  reset: () => void;
  details: string | null;
}) {
  return (
    <div className="flex h-screen items-center justify-center bg-bg p-8 text-text">
      <div className="flex w-[520px] flex-col gap-4 border border-offline/40 bg-bg-panel px-6 py-6">
        <div className="flex items-center gap-2">
          <span className="status-dot offline" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-offline">
            Renderer crash
          </span>
        </div>
        <h1 className="text-lg font-semibold">Something broke inside the UI.</h1>
        <p className="text-sm text-text-muted">
          The main process is still running — your DB, bot connection, and
          session state are intact. Try reloading the window.
        </p>
        <div className="border border-border bg-bg p-3 font-mono text-xs text-offline">
          {error.message}
        </div>
        {details && (
          <details className="text-[11px] text-text-dim">
            <summary className="cursor-pointer text-text-muted hover:text-text">
              Component stack
            </summary>
            <pre className="mt-2 whitespace-pre-wrap break-all text-[10px]">
              {details.trim()}
            </pre>
          </details>
        )}
        <div className="flex gap-2">
          <button
            onClick={() => window.location.reload()}
            className="border border-accent bg-accent/10 px-3 py-1.5 text-xs uppercase tracking-wider text-accent hover:bg-accent/20"
          >
            Reload window
          </button>
          <button
            onClick={reset}
            className="border border-border bg-bg px-3 py-1.5 text-xs uppercase tracking-wider text-text-muted hover:bg-bg-hover"
          >
            Try again
          </button>
        </div>
      </div>
    </div>
  );
}
