import { PlayerName } from "@elixir-mcp/ui";
import { useLocation } from "@tanstack/react-router";
import { Link, TagText } from "@elixir-mcp/ui";
import { useMe, useNav } from "../App.jsx";
import { playerHref } from "../lib/player.js";
import {
  MODES,
  OTHER,
  capturePending,
  isOwnClaim,
  statsPlayers,
  scopeHref,
  statsSlug,
  playerName,
  pickMode,
  pickPlayer,
  pickSeason,
  recordedSeasons,
} from "../stats/stats.js";
import { useToolRead } from "../lib/queries.js";
import { NoPlayers } from "../stats/common.jsx";
import { Cards } from "../stats/Cards.jsx";
import { Battles } from "../stats/Battles.jsx";
import { Pending } from "../stats/Pending.jsx";
import { Decks } from "../stats/Decks.jsx";
import { StatsFrame } from "../stats/ScopeBar.jsx";
import { Season } from "../stats/Season.jsx";
import { YouTabs } from "../home/You.jsx";
import { Whose, whoseWords } from "../stats/whose.js";

/**
 * You › Stats (2026-11-12; Ladder, at /ladder until then), under You's tabs.
 * STATS/{page}: whose season (`?player=`, one of yours, the primary by
 * default), which game (`?mode=`, else the mode played most) and which
 * season (`?season=`, else the current one, or the last with battles
 * while the current has none: pickSeason), then the page inside the scope
 * bar's frame. players_summary is read once here: it names the mode a page
 * opens on, and its recorded_since starts the read that lists the player's
 * seasons for the picker. One no-mode read of the season gives the head its
 * dates, the chips their Other, and the bar its freshness.
 */
export function StatsPage() {
  const { me } = useMe();
  const { search } = useLocation();
  const players = statsPlayers(me?.claims, search?.player);
  const player = pickPlayer(players, search?.player);
  // A player you follow is theirs, not yours: no You tabs above it, a way
  // back to their player page, and "their" where your own says "your".
  const own = !player || isOwnClaim(player);
  return (
    <Whose.Provider value={whoseWords(own)}>
      <div className="kit-you-stats">
        {own ? (
          <YouTabs />
        ) : (
          <nav className="kit-you-stats__back" aria-label="Whose stats">
            <Link to={playerHref(player.player_tag)}>
              ‹{" "}
              <PlayerName tag={player.player_tag}>
                <TagText>{playerName(player)}</TagText>
              </PlayerName>
            </Link>
          </nav>
        )}
        <StatsBody players={players} player={player} />
      </div>
    </Whose.Provider>
  );
}

function StatsBody({ players, player }) {
  const { me } = useMe();
  const navigate = useNav();
  const { pathname, search } = useLocation();
  const summary = useToolRead(
    "players_summary",
    { player_tag: player?.player_tag },
    { enabled: Boolean(player) },
  );
  const since = summary.data?.meta?.recorded_since ?? null;
  // The seasons on record: one read from the first recorded battle,
  // whose applied window names every season roll since.
  const listed = useToolRead(
    "battles_performance",
    { player_tag: player?.player_tag, from: since },
    { enabled: Boolean(player && since) },
  );
  // With no season asked for, whether the current one has a battle yet.
  const asked = search?.season != null && String(search.season) !== "";
  const now = useToolRead(
    "battles_performance",
    { player_tag: player?.player_tag, season: "current" },
    { enabled: Boolean(player) && !asked },
  );
  // No session answer yet says nothing about whose players there are.
  if (!player) return me ? <NoPlayers /> : null;
  const slug = statsSlug(pathname);
  const hrefFor = (over) => scopeHref(slug, search ?? {}, over);
  // Nothing captured yet: say so, calmly, on every page (Pending.jsx), with the
  // player control still in reach, so a new or mistyped tag strands nobody.
  if (capturePending(summary))
    return (
      <Pending
        key={player.player_tag}
        player={player}
        players={players}
        hrefFor={hrefFor}
        navigate={navigate}
      />
    );

  const seasons = listed.data
    ? recordedSeasons(listed.data.applied)
    : listed.isError || (!summary.isPending && !since)
      ? []
      : undefined;
  const season = pickSeason(search?.season, {
    seasons,
    currentBattles: now.data
      ? Number(now.data.window?.battles ?? 0)
      : now.isError
        ? null
        : undefined,
  });
  const modeAsked =
    search?.mode === OTHER.key || MODES.some((m) => m.key === search?.mode);
  const mode = pickMode(search?.mode, summary.data?.last_30_days?.modes);
  const scope = { player_tag: player.player_tag, season: season.arg };
  // Until the summary answers, an unasked mode is not known yet, and a
  // page that read Trophy Road first would read it twice.
  const modeReady = (modeAsked || !summary.isPending) && season.ready;
  return (
    <ScopedPage
      slug={slug}
      search={search ?? {}}
      hrefFor={hrefFor}
      navigate={navigate}
      scope={scope}
      season={season}
      seasons={seasons}
      player={player}
      players={players}
      mode={mode}
      modeReady={modeReady}
      summary={summary}
    />
  );
}

/** The scope bar's read and frame, once the season is known. */
function ScopedPage({
  slug,
  search,
  hrefFor,
  navigate,
  scope,
  season,
  seasons,
  player,
  players,
  mode,
  modeReady,
  summary,
}) {
  const read = useToolRead("battles_performance", scope, {
    enabled: season.ready,
  });
  const ctx = {
    player,
    mode,
    modeReady,
    season,
    seasons,
    summary,
    search,
    hrefFor,
    startsAt: read.data?.applied?.window?.season?.starts_at ?? null,
  };
  return (
    <StatsFrame
      slug={slug}
      player={player}
      players={players}
      mode={mode}
      season={season}
      seasons={seasons}
      scope={read}
      summary={summary}
      hrefFor={hrefFor}
      navigate={navigate}
    >
      <Tab slug={slug} {...ctx} />
    </StatsFrame>
  );
}

function Tab({ slug, ...ctx }) {
  switch (slug) {
    case "battles":
      return <Battles {...ctx} />;
    case "decks":
      return <Decks {...ctx} />;
    case "cards":
      return <Cards {...ctx} />;
    default:
      return <Season {...ctx} />;
  }
}
