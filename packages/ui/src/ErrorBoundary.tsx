import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * There was no error boundary anywhere in the console once.
 *
 * React's default for an uncaught render error is to unmount the ENTIRE
 * tree, so one component's bad assumption took the whole page down --
 * nav included. The symptom is a blank white page with a console error
 * and no way forward except retyping a URL.
 *
 * A boundary cannot stop the throw. What it does is bound the damage to
 * the region that failed, keep the navigation alive so the app is still
 * usable, and -- the part that matters for diagnosis -- put the actual
 * message on the screen. An error nobody can read is an error nobody
 * can report. Key it on the route: a boundary that has caught stays
 * caught, so without that a single bad page keeps showing its error
 * after you navigated away from it.
 */
export class ErrorBoundary extends Component<
  { children?: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children?: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    // Still log it: the console is where a developer looks first, and the
    // component stack is the part the on-screen message deliberately omits.
    console.error("app render error", error, info?.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel my-6">
        <h2 className="mt-0">This section failed to render.</h2>
        <p className="text-ink-faint">
          The rest of the site still works — use the navigation above. If you
          can, send this text with a note about what you were doing:
        </p>
        <pre className="overflow-x-auto rounded-chip bg-ground-sunken p-3 text-[13px] whitespace-pre-wrap">
          {String(this.state.error?.stack || this.state.error)}
        </pre>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    );
  }
}
