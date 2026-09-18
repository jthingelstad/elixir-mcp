/** Helpers every builder shares. */
import { WEEKDAY } from "./week.mjs";

/** Game-mode names as the mail says them. The tool rows are keyed by the
 *  API's own mode name; the mail groups them the way a player thinks. */
export function modeLabel(gameMode = "", type = "") {
  const g = String(gameMode);
  if (/^Ladder$/i.test(g)) return "Trophy Road";
  // The timeline's mode GROUPS come through here too.
  if (/^war$/i.test(g)) return "War";
  if (/^casual$/i.test(g)) return "Casual";
  if (/^other$/i.test(g)) return "Other";
  if (/^Ranked/i.test(g) || /pathoflegend|ranked/i.test(type)) return "Ranked";
  if (/^CW_Duel/i.test(g)) return "War · Duel";
  if (/^CW_Battle/i.test(g) || /riverRacePvP/i.test(type)) return "War · 1v1";
  if (/^CW_Boat|boat/i.test(g) || /boat/i.test(type)) return "War · Boat";
  if (/friendly|trail/i.test(g) || /friendly|trail/i.test(type))
    return "Friendly";
  if (/2v2|team/i.test(g) || /2v2/i.test(type)) return "2v2";
  if (/tournament/i.test(g) || /tournament/i.test(type)) return "Tournament";
  if (/challenge/i.test(g) || /challenge/i.test(type)) return "Challenge";
  return g.replace(/_/g, " ").replace(/\s+/g, " ").trim() || "Other";
}

export function weekday(iso, timezone = "UTC") {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      weekday: "short",
    }).format(new Date(iso));
  } catch {
    return WEEKDAY[new Date(iso).getUTCDay()];
  }
}

export function agoText(seconds) {
  if (seconds == null) return "never";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

/** Card names with the form the deck carried, the way the site says it. */
export function cardLabel(card) {
  const form =
    card.evolution === 2 ? " (Hero)" : card.evolution === 1 ? " (Evo)" : "";
  return `${card.name}${form}`;
}

/** The recipient's tracked players by relationship, from the claim table. */
export async function myPlayers(db, accountId) {
  const { rows } = await db.query(
    `select c.player_tag, c.relationship, c.is_primary, p.name, p.last_known_clan_tag, nn.nickname
       from claim c join player p on p.player_tag = c.player_tag
       left join player_nickname nn on nn.account_id = c.account_id and nn.player_tag = c.player_tag
      where c.account_id = $1
      order by c.is_primary desc, c.relationship, p.name`,
    [accountId],
  );
  return rows.map((r) => ({
    tag: r.player_tag,
    name: r.name ?? r.player_tag,
    nickname: r.nickname ?? null,
    relationship: r.is_primary ? "primary" : r.relationship,
    clanTag: r.last_known_clan_tag ?? null,
  }));
}

/** Tolerant tool call: a reader that refuses (no subject, nothing
 *  recorded) yields null rather than failing the whole mail. */
export async function tryTool(callTool, ctx, name, args) {
  try {
    return await callTool(ctx, name, args);
  } catch (err) {
    if (
      err?.code &&
      ["not_found", "no_subject", "bad_request", "result_too_large"].includes(
        err.code,
      )
    )
      return null;
    throw err;
  }
}
