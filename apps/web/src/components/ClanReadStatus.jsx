import { Icon } from "@elixir-mcp/ui";

/** A failed membership read says nothing about what the account tracks.
 * Retain any earlier answer; retry only this read, never an add or fetch. */
export function ClanReadStatus({ query }) {
  if (query.isError)
    return (
      <div className="callout callout--warn mb-4 flex-wrap" role="alert">
        <Icon name="circle-dashed" size={17} />
        <span className="min-w-[12rem] flex-1">
          Your clans could not be read just now. Your saved tracking is
          unchanged.
          {query.data
            ? " Any previously read clans are kept while you retry."
            : ""}
        </span>
        <button
          className="btn btn--sm"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
        >
          {query.isFetching ? "Trying…" : "Try again"}
        </button>
      </div>
    );
  if (query.isPending)
    return (
      <p role="status" className="mb-4 text-ink-faint">
        Checking your clans…
      </p>
    );
  return null;
}
