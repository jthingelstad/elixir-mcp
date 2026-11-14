import { ErrorState, Panel, Row, Rows, useClock } from "@elixir-mcp/ui";
import { usePlayerRecord } from "../lib/queries.js";

/**
 * A player page's Record tab (2026-11-12): what Explore's player and
 * profile records showed, folded into the page every name opens. The last
 * 30 days as Elixir recorded them, and the last profile read with its
 * lifetime counters. Game facts only: a nickname is never drawn here (the
 * summary carries the reader's own), nor any account.
 */
const LIFETIME = [
  ["battle_count", "Battles, all time"],
  ["wins", "Wins, all time"],
  ["losses", "Losses, all time"],
  ["three_crown_wins", "Three-crown wins"],
  ["collection_level", "Collection level"],
  ["king_tower_level", "King Tower level"],
  ["total_donations", "Cards donated, all time"],
];

const n = (v) => (typeof v === "number" ? v.toLocaleString() : null);

export function PlayerRecord({ tag }) {
  const { calendar } = useClock();
  const query = usePlayerRecord(tag, true);
  if (query.isPending) return <div className="kit-skeleton" aria-busy="true" />;
  if (query.isError)
    return (
      <ErrorState
        title="This record could not be read just now"
        onRetry={() => query.refetch()}
        busy={query.isFetching}
      >
        Try again in a moment.
      </ErrorState>
    );
  const { summary, profile } = query.data;
  return (
    <>
      <Recent summary={summary} />
      <Profile profile={profile} calendar={calendar} />
    </>
  );
}

function Recent({ summary }) {
  const r = summary?.last_30_days;
  if (!r || !r.battles)
    return (
      <Panel title="Last 30 days" titleAs="h2" pad>
        <p className="kit-week__quiet">
          No battles recorded in the last 30 days.
        </p>
      </Panel>
    );
  const record = `${n(r.wins)} won, ${n(r.losses)} lost${r.draws ? `, ${n(r.draws)} drawn` : ""}`;
  const cap = r.capture;
  const deck = summary.top_deck;
  return (
    <Panel title="Last 30 days" titleAs="h2">
      <Rows>
        <Row title="Battles" right={n(r.battles)} detail={record} />
        {typeof r.net_trophies === "number" ? (
          <Row
            title="Trophies"
            right={`${r.net_trophies > 0 ? "+" : ""}${n(r.net_trophies)}`}
            detail="Net, over the recorded battles"
          />
        ) : null}
        {deck?.archetype?.label ? (
          <Row
            title="Most played deck"
            right={n(deck.battles)}
            detail={deck.archetype.label}
          />
        ) : null}
      </Rows>
      <p className="kit-panel__body kit-tiny">
        {cap?.expected_battles
          ? `Elixir recorded ${n(cap.captured_battles)} of about ${n(cap.expected_battles)} battles the profile counted; one it did not read is not here.`
          : "What Elixir recorded; a battle it did not read is not here."}
      </p>
    </Panel>
  );
}

function Profile({ profile, calendar }) {
  const snap = profile?.snapshot;
  if (!snap)
    return (
      <Panel title="Profile" titleAs="h2" pad>
        <p className="kit-week__quiet">No profile read yet.</p>
      </Panel>
    );
  const best = profile.attributes?.best_trophies;
  const rows = LIFETIME.filter(
    ([key]) => typeof snap.lifetime?.[key] === "number",
  );
  return (
    <Panel title="Profile" titleAs="h2">
      <Rows>
        {typeof snap.trophies === "number" ? (
          <Row title="Trophies" right={n(snap.trophies)} />
        ) : null}
        {typeof best === "number" ? (
          <Row title="Best trophies" right={n(best)} />
        ) : null}
        {rows.map(([key, label]) => (
          <Row key={key} title={label} right={n(snap.lifetime[key])} />
        ))}
      </Rows>
      <p className="kit-panel__body kit-tiny">
        {snap.date
          ? `As the profile read on ${calendar(snap.date)} had it.`
          : "As the last profile read had it."}{" "}
        Lifetime counters are the game&rsquo;s own, apart from the battles
        Elixir recorded.
      </p>
    </Panel>
  );
}
