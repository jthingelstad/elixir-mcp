import { ErrorState } from "@elixir-mcp/ui";

/** A failed membership read says nothing about what the account tracks.
 * Retain any earlier answer; retry only this read, never an add or fetch. */
export function ClanReadStatus({ query }) {
  if (query.isError)
    return (
      <ErrorState
        className="mb-4"
        title="Your clans could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Your saved follows are unchanged.
        {query.data
          ? " Any previously read clans are kept while you retry."
          : ""}{" "}
        Try again in a moment.
      </ErrorState>
    );
  if (query.isPending)
    return (
      <p role="status" className="mb-4 text-ink-faint">
        Checking your clans…
      </p>
    );
  return null;
}
