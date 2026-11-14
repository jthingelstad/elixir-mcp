import { ErrorState } from "@elixir-mcp/ui";

/** Elixir did not answer the session read: not signed out, and the page
 *  says so with a way to try again. Home, Settings and Clan share it. */
export function Unavailable({ onRetry, busy }) {
  return (
    <ErrorState
      titleAs="h1"
      title="This page could not be read just now"
      onRetry={onRetry}
      busy={busy}
    >
      Elixir could not check who you are. You are not signed out; the request
      did not get through. Try again in a moment.
    </ErrorState>
  );
}
