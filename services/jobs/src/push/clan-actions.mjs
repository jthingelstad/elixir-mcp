/** A Clan Action that became yours, for web push (2026-11-16): Clan's
 *  morning run names each verified member with new Actions; this owes
 *  them one notice per clan per UTC day, which the minute's push drain
 *  sends. Owed only when the account has a device and the kind on. */
import { owePush } from "@elixir-mcp/tools/activity/push";
import { clipText } from "@elixir-mcp/tools/activity/bell";

const SITE = "https://elixir.poapkings.com";

/** The message's link as a path on Elixir, else the clan's own page. */
function pathOf(link, clanTag) {
  const s = String(link ?? "");
  if (s.startsWith(`${SITE}/`)) return s.slice(SITE.length).slice(0, 300);
  return `/clan/${encodeURIComponent(clanTag.replace(/^#/, ""))}`;
}

export function oweClanActionsPush(
  db,
  { accountId, clanTag, clanName, count, link, day },
) {
  return owePush(db, {
    accountId,
    kind: "clan_actions",
    title:
      count === 1
        ? "A Clan Action is waiting for you"
        : `${count} Clan Actions are waiting for you`,
    body: clanName ? `In ${clipText(clanName, 60)}` : "",
    url: pathOf(link, clanTag),
    dedupeKey: `clan_actions/${day}/${clanTag}/${accountId}`,
  });
}
