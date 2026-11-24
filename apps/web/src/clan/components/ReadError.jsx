import { ErrorBoundary, ErrorState } from "@elixir-mcp/ui";
import { CLAN } from "../lib/base.js";

/** The codes a read that never got a real answer comes back with: the
 *  browser's timeout, an edge error page, the API's own 504 and 503. */
const SLOW = new Set([
  "timeout",
  "bad_response",
  "unavailable",
  "temporarily_unavailable",
]);

/**
 * Why a read failed, in one word: `slow` (Elixir took too long or did not
 * answer), `offline` (the request never left the phone), `signedOut`,
 * `forbidden`, or `failed` for anything else. Takes a gated read's state
 * (`{ signedOut, forbidden, error, failed }`, lib/queries.js) or the
 * ApiError a plain query holds.
 */
export function troubleOf(failure) {
  if (!failure) return "failed";
  if (failure.signedOut || failure.status === 401) return "signedOut";
  if (failure.forbidden || failure.status === 403) return "forbidden";
  const thrown = failure.failed ?? failure;
  const code = thrown.transport ?? thrown.error ?? thrown.message ?? null;
  if (code === "network") return "offline";
  if (SLOW.has(code) || thrown.status >= 500) return "slow";
  return "failed";
}

/**
 * One panel's failed read, in plain words with a way to try again (the Run
 * redesign, 2026-11-24): only that panel says so, and the rest of the page
 * keeps working. `what` names the panel's content as a player would
 * ("Actions", "The rules"). Nothing a person typed is lost by a failed read.
 */
export function ReadError({ what, failure, onRetry, busy = false }) {
  const kind = troubleOf(failure);
  if (kind === "signedOut")
    return (
      <ErrorState title="You're signed out">
        Sign in again to keep going.{" "}
        <a href={`${CLAN}?error=session_expired`}>Sign in</a>
      </ErrorState>
    );
  if (kind === "forbidden")
    return (
      <ErrorState title="Not yours to see">
        Only the Leader and Co-Leaders can see this.
      </ErrorState>
    );
  const retry = onRetry ? { onRetry, busy } : {};
  if (kind === "slow")
    return (
      <ErrorState title="Elixir was slow" {...retry}>
        {what} didn&rsquo;t load in time. Nothing is lost.
      </ErrorState>
    );
  if (kind === "offline")
    return (
      <ErrorState title="Can't reach Elixir" {...retry}>
        Check your connection. Nothing is lost.
      </ErrorState>
    );
  return (
    <ErrorState title={`${what} didn't load`} {...retry}>
      Try again in a moment. Nothing is lost.
    </ErrorState>
  );
}

/**
 * A boundary round one panel: a panel that breaks while drawing says so in
 * its own place, and the tabs, the other panels and any unsaved draft above
 * it stay. Key it on what the panel shows, so moving on clears it.
 */
export function PanelBoundary({ what = "This part", children }) {
  return (
    <ErrorBoundary
      fallback={(retry) => (
        <ErrorState title={`${what} didn't load`} onRetry={retry}>
          Something went wrong on our side. Nothing is lost.
        </ErrorState>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
