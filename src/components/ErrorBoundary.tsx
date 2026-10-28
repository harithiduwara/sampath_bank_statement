import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  /** Changing this (e.g. the current view) clears the error. */
  resetKey: string;
  children: ReactNode;
}

/** Keeps one broken view from taking down the workspace (and the user's unsaved session). */
export default class ErrorBoundary extends Component<Props, { error: Error | null; key: string }> {
  state = { error: null as Error | null, key: this.props.resetKey };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  static getDerivedStateFromProps(props: Props, state: { error: Error | null; key: string }) {
    return props.resetKey !== state.key ? { error: null, key: props.resetKey } : null;
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="rounded-xl border border-crit/30 bg-crit-soft p-6">
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="mt-0.5 text-crit" aria-hidden="true" />
          <div>
            <p className="font-semibold text-ink">This view ran into a problem</p>
            <p className="mt-1 text-sm text-ink-2">
              Your statements and edits are still loaded. Open another view, or try this one again. Export to Excel if you want a copy of your work.
            </p>
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="mt-3 h-9 rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-3"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );
  }
}
