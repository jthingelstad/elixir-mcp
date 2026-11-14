import { Component, type ErrorInfo, type ReactNode } from "react";
import { ErrorState } from "./Empty.tsx";

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
      <div className="my-6">
        <ErrorState
          titleAs="h2"
          title="This section failed to render"
          onRetry={() => this.setState({ error: null })}
        >
          The rest of the site still works. Use the navigation above. If you
          can, send the text below with a note about what you were doing.
        </ErrorState>
        <pre className="mt-3 overflow-x-auto rounded-chip bg-ground-sunken p-3 text-[13px] whitespace-pre-wrap">
          {String(this.state.error?.stack || this.state.error)}
        </pre>
      </div>
    );
  }
}
