import { useLocation } from "@tanstack/react-router";
import { useMe } from "../App.jsx";
import {
  MODES,
  ladderPlayers,
  ladderSlug,
  pickMode,
  pickPlayer,
} from "../lib/ladder.js";
import { useToolRead } from "../lib/queries.js";
import { NoPlayers } from "../ladder/common.jsx";
import { Cards } from "../ladder/Cards.jsx";
import { Days } from "../ladder/Days.jsx";
import { Decks } from "../ladder/Decks.jsx";
import { Season } from "../ladder/Season.jsx";

/**
 * /ladder/{page}: whose season (`?player=`, one of yours, the primary by
 * default) and which game (`?mode=`, else the mode played most), then
 * the page. players_summary is read once here: it names the mode a page
 * opens on and the deck the season home shows.
 */
export function LadderPage() {
  const { me } = useMe();
  const { pathname, search } = useLocation();
  const players = ladderPlayers(me?.claims);
  const player = pickPlayer(players, search?.player);
  const summary = useToolRead(
    "players_summary",
    { player_tag: player?.player_tag },
    { enabled: Boolean(player) },
  );
  if (!player) return <NoPlayers />;

  const asked = MODES.some((m) => m.key === search?.mode);
  const mode = pickMode(search?.mode, summary.data?.last_30_days?.modes);
  const ctx = {
    player,
    players,
    mode,
    // Until the summary answers, an unasked mode is not known yet, and a
    // page that read Trophy Road first would read it twice.
    modeReady: asked || !summary.isPending,
    summary,
    search: search ?? {},
  };
  switch (ladderSlug(pathname)) {
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
