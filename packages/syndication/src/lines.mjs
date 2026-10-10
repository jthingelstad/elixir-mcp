/** One timeline item as one Discord line (Jamie, 2026-10-10: "plain
 *  lines", with links back to Elixir that never unfurl into embeds).
 *
 *  The item's own sentence (itemText), with its time lead replaced by a
 *  Discord timestamp, which every reader sees on their own clock. Names
 *  are escaped so a player called `*_King_*` cannot restyle the channel,
 *  and every link is a masked link around an angle-bracketed address,
 *  the form Discord never previews; the relay also sends the message
 *  with embeds suppressed. */
import { ELIXIR_ORIGIN, DISCORD_CONTENT_MAX } from "@elixir-mcp/contracts";

const tagPath = (tag) =>
  encodeURIComponent(String(tag ?? "").replace(/^#/, ""));
const playerUrl = (tag) =>
  `${ELIXIR_ORIGIN}/console/explore/player/${tagPath(tag)}`;
const clanUrl = (tag) =>
  `${ELIXIR_ORIGIN}/console/explore/clan/${tagPath(tag)}`;
// /explore/week/<tag>~<season>~<section index>, the week counted from 0
// (apps/web views/Explore.jsx, the mail's raceWeekUrl).
const weekUrl = (tag, season, sectionIndex) =>
  `${ELIXIR_ORIGIN}/console/explore/week/${tagPath(tag)}~${encodeURIComponent(season)}~${Number(sectionIndex)}`;

/** Discord markdown, mentions, timestamps and masked-link brackets, made
 *  literal. The line starts with its stamp, so a leading # or - in a
 *  name is never a heading or a list.
 *  Line breaks fold to spaces: one item is one line. */
export function escapeDiscord(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .replace(/[\\*_~`|>[\]<@]/g, (c) => `\\${c}`);
}

/** The battle an item names (a promotion, a crossing), if any. */
export function itemBattleId(it) {
  const f = it.facts ?? {};
  return f.promoted_by?.battle_id ?? f.crossed_by?.battle_id ?? null;
}

const WAR_KINDS = new Set([
  "bracket_observed",
  "race_finished",
  "week_resolved",
]);

/** The links an item carries, most specific first: its battle, its race
 *  week, the member a clan's item is about, then its subject (a clan
 *  when `clanTags` holds it, else a player). */
export function itemLinks(
  it,
  { battles = new Map(), clanTags = new Set() } = {},
) {
  const f = it.facts ?? {};
  const links = [];
  const battle = battles.get(itemBattleId(it));
  if (battle) links.push({ label: "battle", url: battle.url });
  if (
    WAR_KINDS.has(it.kind) &&
    it.subject_tag &&
    f.season_id != null &&
    f.section_index != null
  )
    links.push({
      label: `week ${Number(f.section_index) + 1}`,
      url: weekUrl(it.subject_tag, f.season_id, f.section_index),
    });
  if (f.player_tag && f.player_tag !== it.subject_tag)
    links.push({ label: f.name ?? f.player_tag, url: playerUrl(f.player_tag) });
  if (it.subject_tag)
    links.push({
      label: it.subject_name ?? it.subject_tag,
      url:
        clanTags.has(it.subject_tag) ||
        WAR_KINDS.has(it.kind) ||
        it.kind.startsWith("member_")
          ? clanUrl(it.subject_tag)
          : playerUrl(it.subject_tag),
    });
  return links;
}

/** "<t:1760000000:t>" for an item from the last 12 hours, the full date
 *  and time for an older one (a late proof, a quiet rung). */
function discordStamp(atIso, nowMs = Date.now()) {
  const ms = Date.parse(atIso);
  if (!Number.isFinite(ms)) return "";
  const style = nowMs - ms < 12 * 3600_000 ? "t" : "f";
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

// The time lead itemText writes ("Sat 11:18 "), which the stamp replaces.
const LEAD = /^\s*(?:[A-Z][a-z]{2} \d{2}:\d{2} )?/;

/** The item's own sentence, without its time lead. */
export const itemSentence = (it) => String(it.text ?? "").replace(LEAD, "");

/** The item as one Discord message's content, at most 2,000 characters:
 *  the links survive a long sentence (a clan chat message), the
 *  sentence is cut. `text`, when given, is told instead of the item's
 *  own sentence (a clan's model rewrote it), with the same stamp and
 *  links, escaped the same way. */
export function discordLine(
  it,
  {
    battles = new Map(),
    clanTags = new Set(),
    nowMs = Date.now(),
    text = null,
  } = {},
) {
  const stamp = discordStamp(it.at, nowMs);
  const sentence = escapeDiscord(text ?? itemSentence(it));
  const links = itemLinks(it, { battles, clanTags })
    .map((l) => `[${escapeDiscord(l.label)}](<${l.url}>)`)
    .join(" · ");
  const tail = links ? ` · ${links}` : "";
  const room = DISCORD_CONTENT_MAX - tail.length - stamp.length - 1;
  const body =
    sentence.length > room
      ? `${sentence.slice(0, Math.max(0, room - 1)).replace(/\\$/, "")}…`
      : sentence;
  return `${stamp ? `${stamp} ` : ""}${body}${tail}`.slice(
    0,
    DISCORD_CONTENT_MAX,
  );
}
