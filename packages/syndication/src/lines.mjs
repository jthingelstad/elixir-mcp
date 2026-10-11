/** One timeline item as one Discord line (Jamie, 2026-10-10: "plain
 *  lines", with links back to Elixir that never unfurl into embeds).
 *
 *  The item's own sentence (itemText, time-free), and no time of its
 *  own: Discord's post time says when (Jamie, 2026-10-11). Only an item
 *  over three hours old (a late proof, a quiet rung) says how long ago,
 *  in a relative Discord timestamp each reader sees on their own clock.
 *  Names are escaped so a player called `*_King_*` cannot restyle the channel,
 *  and every link is a masked link around an angle-bracketed address,
 *  the form Discord never previews; the relay also sends the message
 *  with embeds suppressed. */
import { ELIXIR_ORIGIN, DISCORD_CONTENT_MAX } from "@elixir-mcp/contracts";
import { escapeDiscord } from "@elixir-mcp/clan-engine";

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
 *  literal (one rule with Clan's Actions, kept in the engine). Line
 *  breaks fold to spaces: one item is one line. */
export { escapeDiscord };

/** A line opens with its sentence, so a name that starts it with "#",
 *  "-" or "1." is made literal too: never a heading, a subtext or a
 *  list (the stamp led every line until 2026-10-11). */
const literalLead = (s) =>
  s.replace(/^(#|-)/, "\\$1").replace(/^(\d+)\.(?=\s)/, "$1\\.");

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

/** An item this old or younger, when its line is built, carries no
 *  time: the message's own post time says enough. */
const FRESH_MS = 3 * 3600_000;

const SITTINGS = new Set(["battle_session", "session_standout"]);
/** The instant an item's age runs from: a sitting's last battle (it
 *  moved then, so a sitting edited as it grows stays fresh and never
 *  gains a time), every other item's own `at`. */
const movedMs = (it) =>
  Date.parse(
    SITTINGS.has(it.kind) && it.facts?.ended_at ? it.facts.ended_at : it.at,
  );

/** "<t:1760000000:R>" ("5 hours ago", on each reader's clock) for an
 *  item more than three hours old when the line is built; "" for any
 *  younger one. An edit builds the line again, so the rule is recomputed;
 *  a stamp is relative, never a clock time that could read later than
 *  the message's own. */
export function discordStamp(it, nowMs = Date.now()) {
  const ms = movedMs(it);
  if (!Number.isFinite(ms) || nowMs - ms <= FRESH_MS) return "";
  return `<t:${Math.floor(ms / 1000)}:R>`;
}

/** The item's own sentence: time-free since 11.8.0. A post carries no
 *  other time unless the item is over three hours old (discordStamp). */
export const itemSentence = (it) => String(it.text ?? "");

/** The item as one Discord message's content, at most 2,000 characters:
 *  the sentence, the stamp when the item is old (discordStamp), then
 *  the links. The links survive a long sentence (a clan chat message),
 *  the sentence is cut. `text`, when given, is told instead of the
 *  item's own sentence (a clan's model rewrote it), with the same stamp
 *  and links, escaped the same way. */
export function discordLine(
  it,
  {
    battles = new Map(),
    clanTags = new Set(),
    nowMs = Date.now(),
    text = null,
  } = {},
) {
  const stamp = discordStamp(it, nowMs);
  const sentence = literalLead(escapeDiscord(text ?? itemSentence(it)));
  const links = itemLinks(it, { battles, clanTags })
    .map((l) => `[${escapeDiscord(l.label)}](<${l.url}>)`)
    .join(" · ");
  const tail = `${stamp ? ` · ${stamp}` : ""}${links ? ` · ${links}` : ""}`;
  const room = DISCORD_CONTENT_MAX - tail.length;
  const body =
    sentence.length > room
      ? `${sentence.slice(0, Math.max(0, room - 1)).replace(/\\$/, "")}…`
      : sentence;
  return `${body}${tail}`.slice(0, DISCORD_CONTENT_MAX);
}
