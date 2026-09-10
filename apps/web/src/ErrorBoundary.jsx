import { Component } from "react";

/**
 * There was no error boundary anywhere in this app.
 *
 * React's default for an uncaught render error is to unmount the ENTIRE tree,
 * so one component's bad assumption took the whole page down -- nav included.
 * The symptom is a blank white page with a console error and no way forward
 * except retyping a URL, which is exactly what was reported.
 *
 * A boundary cannot stop the throw. What it does is bound the damage to the
 * region that failed, keep the navigation alive so the app is still usable,
 * and -- the part that matters for diagnosis -- put the actual message on the
 * screen. An error nobody can read is an error nobody can report.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Still log it: the console is where a developer looks first, and the
    // component stack is the part the on-screen message deliberately omits.
    console.error("app render error", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="panel" style={{ margin: "24px 0" }}>
        <h2 style={{ marginTop: 0 }}>This section failed to render.</h2>
        <p style={{ color: "var(--ink-faint)" }}>
          The rest of the site still works — use the navigation above. If you
          can, send this text with a note about what you were doing:
        </p>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            fontSize: "13px",
            background: "var(--sunken, rgba(0,0,0,0.2))",
            padding: "12px",
            borderRadius: "6px",
            overflowX: "auto",
          }}
        >
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
