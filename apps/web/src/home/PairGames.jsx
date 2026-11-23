import { useId, useState } from "react";
import {
  Empty,
  ErrorState,
  Icon,
  Link,
  MODE_LABEL,
  Panel,
  Row,
  Rows,
  TagText,
  useClock,
} from "@elixir-mcp/ui";
import { usePairBattles, usePlayerPair } from "../lib/queries.js";
import { SETTINGS } from "../lib/settings.js";

/** A private record of two named players, never an inferred connection:
 *  your own verified players' games with any player you are not blocked
 *  with, followed or not (2026-11-23). */
export function PairGames({ tag, initialAs = null }) {
  const [as, setAs] = useState(initialAs);
  const [pick, setPick] = useState(null);
  const id = useId();
  const query = usePlayerPair(tag, as);
  if (query.isPending) return <p role="status">Reading your games together…</p>;
  if (query.isError || query.data?.status >= 500)
    return (
      <ErrorState
        title="Your games together could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again in a moment.
      </ErrorState>
    );
  if (query.data.status !== 200)
    return (
      <Empty title="These games are not available">
        Your games with this player can&rsquo;t be shown here.
      </Empty>
    );
  const data = query.data.data;
  if (data.state === "verify")
    return (
      <Empty
        title="Verify your player to read your games together"
        action={
          <Link className="btn" to={`${SETTINGS}/players/verify`}>
            Verify your player
          </Link>
        }
      >
        This record uses battles played by your verified player.
      </Empty>
    );
  const modes = data.modes ?? [];
  // The two most recent distinct days on which these players changed sides.
  const days = modes
    .flatMap((m) => (m.days ?? []).map((d) => ({ ...d, mode: m.key })))
    .sort(
      (a, b) =>
        b.day.localeCompare(a.day) ||
        b.count - a.count ||
        a.mode.localeCompare(b.mode),
    );
  const latest = days[0];
  const earlier =
    latest &&
    days.find((d) => d.day < latest.day && d.teamed !== latest.teamed);
  const dayLine = (d) => {
    const label = MODE_LABEL[d.mode] ?? d.mode;
    const date = new Intl.DateTimeFormat("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(d.day + "T12:00:00Z"));
    return d.teamed && d.wins === d.count
      ? `won ${d.wins} ${label} ${d.wins === 1 ? "game" : "games"} together on ${date}`
      : `played ${d.count} ${label} ${d.count === 1 ? "game" : "games"} ${d.teamed ? "together" : "against each other"} on ${date}`;
  };
  const mode = modes.find((m) => m.key === pick) ?? modes[0];
  const own = data.own_players.find((p) => p.tag === data.selected_player);
  return (
    <Panel title="Your games together">
      <div className="kit-panel__body">
        <div className="kit-pair__filters">
          {data.own_players.length > 1 ? (
            <label htmlFor={`${id}-player`}>
              <span className="field-label">Your player</span>
              <select
                className="select select--hit"
                id={`${id}-player`}
                value={data.selected_player}
                onChange={(e) => {
                  setAs(e.target.value);
                  setPick(null);
                }}
              >
                {data.own_players.map((p) => (
                  <option key={p.tag} value={p.tag}>
                    {p.name ?? p.tag} · {p.tag}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="kit-tiny">
              As <TagText>{own?.name ?? data.selected_player}</TagText>
            </p>
          )}
          {mode ? (
            <label htmlFor={`${id}-mode`}>
              <span className="field-label">Mode</span>
              <select
                className="select select--hit"
                id={`${id}-mode`}
                value={mode.key}
                onChange={(e) => setPick(e.target.value)}
              >
                {modes.map((m) => (
                  <option key={m.key} value={m.key}>
                    {MODE_LABEL[m.key] ?? m.key}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <p className="kit-tiny">
          Last 30 days, as Elixir recorded them. A gap means unknown.
        </p>
        {earlier ? (
          <p>
            You {dayLine(earlier)}, then {dayLine(latest)}.
          </p>
        ) : null}
      </div>
      {mode ? (
        <>
          {mode.against_record && mode.against > 1 ? (
            <p className="kit-panel__body">
              {mode.against_record.wins === mode.against_record.losses &&
              mode.against_record.wins * 2 === mode.against
                ? `You split ${mode.against} games, ${mode.against_record.wins} wins each.`
                : `You played each other ${mode.against} times. You won ${mode.against_record.wins}.`}
            </p>
          ) : null}
          {mode.teamed_record && mode.teamed > 1 ? (
            <p className="kit-panel__body">
              You teamed up for {mode.teamed} games and won{" "}
              {mode.teamed_record.wins} together.
            </p>
          ) : null}
          <PairRows
            tag={tag}
            as={data.selected_player}
            mode={mode.key}
            side="teamed"
            count={mode.teamed}
          />
          <PairRows
            tag={tag}
            as={data.selected_player}
            mode={mode.key}
            side="against"
            count={mode.against}
          />
        </>
      ) : (
        <Empty title="No shared battles recorded">
          Elixir has no battles with both players in the last 30 days. A battle
          it did not read is not here.
        </Empty>
      )}
    </Panel>
  );
}

function PairRows({ tag, as, mode, side, count }) {
  const { when } = useClock();
  const id = useId();
  const title = side === "teamed" ? "Teamed up" : "Played against";
  const read = usePairBattles({ tag, as, mode, side }, count > 0);
  const games = read.data?.pages.flatMap((p) => p.battles) ?? [];
  const unique = [...new Map(games.map((g) => [g.battle_id, g])).values()];
  return (
    <section aria-labelledby={id}>
      <div className="kit-panel__head">
        <h3 id={id} className="kit-panel__title">
          {title}
        </h3>
        <span className="kit-tiny">
          {count} {count === 1 ? "battle" : "battles"}
        </span>
      </div>
      {count === 0 ? (
        <p className="kit-panel__body kit-tiny">None recorded in this mode.</p>
      ) : read.isPending ? (
        <p className="kit-panel__body" role="status">
          Reading the battles…
        </p>
      ) : (
        <>
          <Rows>
            {unique.map((g) => (
              <Row
                key={g.battle_id}
                href={g.url}
                title={
                  { win: "Won", loss: "Lost", draw: "Drew" }[g.outcome] ??
                  "Battle recorded"
                }
                detail={when(g.at)}
                right={<Icon name="chevron-right" size={16} />}
              />
            ))}
          </Rows>
          {read.isError ? (
            <ErrorState
              title="These battles could not be read just now"
              onRetry={() => read.refetch()}
              busy={read.isFetching}
            >
              Try again in a moment.
            </ErrorState>
          ) : null}
          {read.hasNextPage ? (
            <div className="kit-panel__body">
              <button
                type="button"
                className="btn btn--quiet"
                disabled={read.isFetchingNextPage}
                onClick={() => read.fetchNextPage()}
              >
                {read.isFetchingNextPage
                  ? "Reading…"
                  : `Older ${side === "teamed" ? "team" : "opponent"} battles`}
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
