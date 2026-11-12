/** The one link a clan's activity post carries back to Elixir (Jamie,
 *  2026-11-11, A5: "a stream of events that link back to Elixir";
 *  2026-11-12: "make sure they do not have previews"; DECISIONS "A
 *  clan's activity goes to a Discord channel of its own, as an editor").
 *
 *  The page is the most specific one a reader in the clan's channel may
 *  open, signed in as a member of the clan:
 *  - one member's battle (a promotion, a crossing, a sitting's best win,
 *    a highlight) when the record holds it: the battle's public page;
 *  - a war story: the clan's War;
 *  - an award the clan granted: the clan's Standings;
 *  - another story about one member: their player page;
 *  - a roster story (a join, a departure, a role change) and a story
 *    about several members: the clan's Feed, its timeline.
 *
 *  The address goes in angle brackets inside a masked link, the form
 *  Discord never previews; the relay also sends every message with
 *  embeds suppressed (SUPPRESS_EMBEDS, `discord-webhook.mjs`), on a post
 *  and on an edit. The words before it are Elixir's or the clan's
 *  model's after the engine's checks, which refuse any link in the
 *  model's own words (`editorProblem`), so this is the post's one link.
 *  Pure. */
import { ELIXIR_ORIGIN, DISCORD_CONTENT_MAX } from "@elixir-mcp/contracts";
import { activityCategory, storyBattleId } from "@elixir-mcp/clan-engine";

const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));

/** The battle a story item names, if any: its promotion's or crossing's,
 *  a sitting's best win, a highlight's. */
const storyItemBattleId = (it) =>
  storyBattleId(it) ??
  it?.facts?.best_win?.battle_id ??
  (it?.kind === "battle_highlight" ? it?.facts?.battle?.battle_id : null) ??
  null;

/** The battle ids a run's stories may link to, for one battleLinks read. */
export const storyBattleIds = (stories) => [
  ...new Set(
    stories
      .flatMap((s) => s.items ?? [])
      .map(storyItemBattleId)
      .filter(Boolean),
  ),
];

/** The clan's own pages, on Elixir's one origin. */
export const clanPageUrl = (clanTag, page = "feed") =>
  `${ELIXIR_ORIGIN}/clan/${tagPath(clanTag)}/${page}`;

/**
 * The page a story's post links to. `items`: every item the post tells
 * (a model post telling several stories passes them all). `battles`:
 * battle_id -> { url } from `battleLinks`, the record's battles only.
 */
export function storyLink(items, { clanTag, battles = new Map() }) {
  const feed = clanPageUrl(clanTag, "feed");
  const told = (items ?? []).filter(Boolean);
  if (!told.length) return feed;
  const categories = new Set(told.map(activityCategory));
  if (categories.has("members")) return feed;
  if ([...categories].every((c) => c === "war"))
    return clanPageUrl(clanTag, "war");
  const players = new Set(told.map((it) => it.facts?.player_tag ?? null));
  if (players.size !== 1 || players.has(null)) return feed;
  for (const it of told) {
    const battle = battles.get(storyItemBattleId(it));
    if (battle?.url) return battle.url;
  }
  if (told.every((it) => it.kind === "award_granted"))
    return clanPageUrl(clanTag, "standings");
  const [player] = players;
  return `${ELIXIR_ORIGIN}/home/player/${tagPath(player)}`;
}

/** What a post ends with: one masked link, the address in angle brackets
 *  so Discord shows no preview of it. */
export const linkLine = (url) => `[Open in Elixir](<${url}>)`;

/** A post's content: `body` (already escaped for Discord) cut to leave
 *  room, then the link on its own line, which always survives. */
export function withLink(body, url) {
  if (!url) return String(body).slice(0, DISCORD_CONTENT_MAX);
  const tail = `\n${linkLine(url)}`;
  const room = DISCORD_CONTENT_MAX - tail.length;
  const text = String(body);
  const cut =
    text.length > room
      ? `${text.slice(0, Math.max(0, room - 1)).replace(/\\$/, "")}…`
      : text;
  return `${cut}${tail}`;
}
