import { useLocation } from "@tanstack/react-router";
import { useMe, useNav } from "../App.jsx";
import {
  MODES,
  capturePending,
  ladderHref,
  ladderPlayers,
  ladderSlug,
  pickMode,
  pickPlayer,
  pickSeason,
  recordedSeasons,
} from "../ladder/ladder.js";
import { useToolRead } from "../lib/queries.js";
import { NoPlayers } from "../ladder/common.jsx";
import { Cards } from "../ladder/Cards.jsx";
import { Days } from "../ladder/Days.jsx";
import { Pending } from "../ladder/Pending.jsx";
import { Decks } from "../ladder/Decks.jsx";
import { Season } from "../ladder/Season.jsx";

/**
 * /ladder/{page}: whose season (`?player=`, one of yours, the primary by
 * default), which game (`?mode=`, else the mode played most) and which
 * season (`?season=`, else the current one, or the last with battles
 * while the current has none: pickSeason), then the page.
 * players_summary is read once here: it names the mode a page opens on
 * and the deck the season home shows, and its recorded_since starts the
 * read that lists the player's seasons for the picker.
 */
export function LadderPage() {
  const { me } = useMe();
  const navigate = useNav();
  const { pathname, search } = useLocation();
  const players = ladderPlayers(me?.claims);
  const player = pickPlayer(players, search?.player);
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
  if (!player) return <NoPlayers />;
  // Nothing captured yet: say so, calmly, on every page (Pending.jsx).
  if (capturePending(summary)) return <Pending player={player} />;

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
  const slug = ladderSlug(pathname);
  const modeAsked = MODES.some((m) => m.key === search?.mode);
  const mode = pickMode(search?.mode, summary.data?.last_30_days?.modes);
  const ctx = {
    player,
    players,
    mode,
    // Until the summary answers, an unasked mode is not known yet, and a
    // page that read Trophy Road first would read it twice.
    modeReady: (modeAsked || !summary.isPending) && season.ready,
    season,
    seasonPicker: {
      seasons: seasons ?? [],
      value: season.key,
      navigate,
      hrefFor: (key) =>
        ladderHref(slug, {
          player: search?.player,
          mode: search?.mode,
          season: key,
        }),
    },
    summary,
    search: search ?? {},
  };
  switch (slug) {
    case "days":
      return <Days {...ctx} />;
    case "decks":
      return <Decks {...ctx} />;
    case "cards":
      return <Cards {...ctx} />;
    default:
      return <Season {...ctx} />;
  }
}
