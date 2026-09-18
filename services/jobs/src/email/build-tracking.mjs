/** tracking_report: the week for everything the recipient tracks,
 *  ordered by relationship depth: you in full, alts shorter, friends a
 *  paragraph, watchers a line. It IS elixir_timeline's window, built
 *  in-process (buildTimeline) so the 48 KB door cap never applies. */
import {
  buildTimeline,
  subjectsFor,
} from "../../../mcp/src/activity/entries.mjs";
import { itemText } from "../../../mcp/src/activity/summary.mjs";
import { modeLabel } from "./shared.mjs";

const MOMENT_KINDS = new Set([
  "badge_earned",
  "legendary_badge_earned",
  "arena_changed",
  "ranked_promotion",
  "best_trophies_band",
  "collection_level_step",
  "career_wins_step",
  "card_unlocked",
  "clan_joined",
  "clan_left",
  "returned",
]);

export async function buildTracking({ db, account, week, season }) {
  const subjects = await subjectsFor(db, account.accountId);
  if (subjects.length === 0) return null;
  const fromMs = week.from.getTime();
  const toMs = week.to.getTime();
  const tz = account.timezone;
  const { entries, quiet, items } = await buildTimeline(db, subjects, {
    fromMs,
    toMs,
    timezone: tz,
    accountId: account.accountId,
  });
  const momentsFor = (tag) =>
    items
      .filter((it) => it.subject_tag === tag && MOMENT_KINDS.has(it.kind))
      .slice(0, 8)
      .map((it) => {
        const text = itemText(it, tz);
        // "Wed 22:57 thingles joined Elixir Kings." -> when + the rest
        const m = /^(\w{3} \d{2}:\d{2})\s+(.*)$/.exec(text);
        return m ? { when: m[1], text: m[2] } : { when: "", text };
      });
  const players = entries.filter((e) => e.kind === "player_activity");
  const clans = entries.filter((e) => e.kind === "clan_activity");
  const one = (e) => ({
    tag: e.subject_tag,
    name: e.name ?? e.subject_tag,
    nickname: e.nickname ?? null,
    battles: e.battles.played,
    wins: e.battles.won,
    losses: e.battles.lost,
    sessions: e.battles.sessions,
    war_battles: e.war?.battles ?? 0,
    trophies:
      e.trophies?.from != null && e.trophies?.to != null
        ? { from: e.trophies.from, to: e.trophies.to }
        : null,
    clan: e.clan?.tag
      ? {
          tag: e.clan.tag,
          name: e.clan.name ?? e.clan.tag,
          role: e.clan.role ?? null,
        }
      : null,
    modes: modesText(e.battles.by_mode),
    moments: momentsFor(e.subject_tag),
  });
  const primary = players.find((e) => e.relationship === "primary");
  const alts = players.filter((e) => e.relationship === "alt").map(one);
  const friends = players.filter((e) => e.relationship === "friend").map(one);
  const watching = players
    .filter((e) => e.relationship === "watching")
    .map((e) => {
      const bits = [];
      if (e.battles.played)
        bits.push(
          `${e.battles.played} battle${e.battles.played === 1 ? "" : "s"}, ${e.battles.won}W-${e.battles.lost}L${e.battles.by_mode ? ` (${modesText(e.battles.by_mode)})` : ""}`,
        );
      else bits.push("no recorded battles");
      for (const n of e.notables ?? []) {
        if (n.kind === "returned")
          bits.push(`back after ${n.after_days} quiet days`);
        else if (n.kind === "clan_joined") bits.push(`joined ${n.clan_name}`);
        else if (n.kind === "clan_left") bits.push(`left ${n.clan_name}`);
        else if (n.kind === "arena_changed")
          bits.push(`reached ${n.to ?? "a new arena"}`);
        else if (n.kind === "ranked_promotion")
          bits.push(`promoted to ${n.to}`);
      }
      return {
        tag: e.subject_tag,
        name: e.name ?? e.subject_tag,
        line: bits.join("; "),
        delta:
          e.trophies?.from != null && e.trophies?.to != null
            ? e.trophies.to - e.trophies.from
            : null,
      };
    });
  const clanRows = clans.map((e) => ({
    tag: e.subject_tag,
    name: e.name ?? e.subject_tag,
    line: e.summary ? e.summary.replace(/^[^:]+:\s*/, "") : "",
  }));
  return {
    week: { label: week.label, key: week.key, season },
    primary: primary ? one(primary) : null,
    alts,
    friends,
    watching,
    clans: clanRows,
    quiet: quiet.map((q) => ({
      tag: q.tag,
      name: q.nickname ?? q.name ?? q.tag,
      days: q.days_quiet,
    })),
    preheader: primary ? primary.summary : undefined,
    coverage: `${subjects.length} subjects tracked; ${quiet.length ? `${quiet.length} with nothing recorded this week (read days since poll before calling the silence theirs)` : "every tracked player was polled inside the week"}.`,
  };
}

function modesText(byMode) {
  if (!byMode) return "";
  const entries = Object.entries(byMode)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  return entries
    .map(([m, n]) => `${n} ${modeLabel(m, "").toLowerCase()}`)
    .join(", ");
}
