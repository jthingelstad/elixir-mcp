import { CLAN_HELP } from "./clan-help.js";
import { HOME_HELP } from "../home/help.js";
import { LADDER_HELP } from "../ladder/help.js";
import { isLadder, ladderSlug } from "../ladder/ladder.js";
import { SETTINGS_HELP } from "../views/account/help.js";
import { ADMIN_HELP, EXPLORE_HELP, STATUS_HELP } from "../views/help.js";
import { settingsHere } from "../lib/settings.js";

/**
 * What the Help drawer says for an address. The text sits next to each page,
 * and only the lookup is here. `area` is what a note from the drawer files
 * under: stored `console` reads as Elixir.
 */
const FALLBACK = {
  title: "this page",
  docs: "home",
  lines: ["Elixir records your Clash Royale battles and reads them back."],
};

export function helpFor(path) {
  const clean = String(path ?? "").replace(/\/$/, "");
  const [, first, second] = clean.split("/");
  const area = (page, name = "console") => ({ ...page, area: name });
  // Stats, under You since 2026-11-12, is Ladder's own help.
  if (isLadder(clean))
    return area(LADDER_HELP[ladderSlug(clean)] ?? LADDER_HELP.season, "ladder");
  if (first === "home")
    return area(HOME_HELP[second ?? "today"] ?? HOME_HELP.today);
  if (first === "clan") return area(CLAN_HELP, "clan");
  if (first === "settings") {
    const here = settingsHere(clean);
    return area(SETTINGS_HELP[here?.page] ?? SETTINGS_HELP.profile);
  }
  if (first === "console" && second === "explore") return area(EXPLORE_HELP);
  if (first === "console" && second === "admin") return area(ADMIN_HELP);
  if (first === "console" && second === "status") return area(STATUS_HELP);
  if (clean === "/data/service") return area(STATUS_HELP);
  return area(FALLBACK);
}
