import { ErrorState } from "@elixir-mcp/ui";
import { transportFailed } from "../client/index.ts";

/** A temporary read failure keeps any posts or draft already on screen.
 * A refusal can supersede cached data, so the panel closes on that answer. */
export function PostReadState({ query, children }) {
  const error = query.error;
  if (error && !transportFailed(error) && error.status !== 429) return null;
  return (
    <>
      {error ? (
        <ErrorState
          title="Posts could not be loaded"
          busy={query.isFetching}
          onRetry={() => query.refetch()}
        >
          {error.status === 429
            ? (error.data?.message ?? "Try again later.")
            : null}
        </ErrorState>
      ) : null}
      {children}
    </>
  );
}
