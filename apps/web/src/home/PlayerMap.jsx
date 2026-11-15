import { ErrorState, Panel } from "@elixir-mcp/ui";
import { PlaceMap } from "../components/PlaceMap.jsx";
import { usePlayerMap } from "../lib/queries.js";

/**
 * The player map (#768): everyone who has set a place, each at the city,
 * region or country they picked and never closer, for anyone signed in to
 * Elixir.
 * Find's Near you draws it below its list, loaded lazily (Leaflet).
 * There is no page of it outside Elixir, and nothing of it on MCP.
 */
export function PlayerMap() {
  const query = usePlayerMap();
  const d = query.data;
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError || !d?.ok)
    return (
      <Panel pad>
        <ErrorState
          title="The player map could not be read just now"
          onRetry={() => query.refetch()}
          busy={query.isFetching}
        >
          Try again in a moment.
        </ErrorState>
      </Panel>
    );
  const n = d.on_map ?? 0;
  return (
    <Panel title="Player map" titleAs="h2" className="kit-playermap" pad>
      <p className="kit-tiny m-0">
        {n === 0
          ? "Nobody is on the player map yet."
          : n === 1
            ? "1 player is on the player map."
            : `${n.toLocaleString()} players are on the player map.`}{" "}
        Each pin is the place someone picked, never closer.
      </p>
      <PlaceMap entries={d.entries} label="Map of where players play from" />
      {d.truncated ? (
        <p className="kit-tiny m-0">Showing the first {n.toLocaleString()}.</p>
      ) : null}
      <p className="kit-tiny m-0">{d.attribution}</p>
    </Panel>
  );
}
