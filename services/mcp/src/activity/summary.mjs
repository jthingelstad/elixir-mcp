/**
 * The summary line of an activity entry: deterministic, templated English
 * a person can read, every number taken from the entry's own sections.
 * No model call, no judgment, no verb of instruction (review 2026-09-13,
 * §12 and §14). If a sentence here would not be worth reading on the
 * console's Activity page, it is not worth an agent's tokens either.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "since Thu 09:00" in the reader's zone; a window over a day says the date. */
function sinceLabel(fromIso, toIso, timeZone = "UTC") {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const spanH = (to - from) / 3_600_000;
  const opts =
    spanH <= 36
      ? { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
      : { month: "short", day: "numeric" };
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(from);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      ...opts,
    }).format(from);
  }
}

const who = (e) => {
  const base = e.nickname
    ? `${e.nickname} (${e.name ?? e.subject_tag})`
    : (e.name ?? e.subject_tag);
  return e.relationship && e.relationship !== "primary"
    ? `${base}, ${e.relationship}`
    : base;
};

export function summarizePlayer(e, timeZone = "UTC") {
  const since = sinceLabel(e.window.from, e.window.to, timeZone);
  const parts = [];
  const b = e.battles;
  if (b.played > 0) {
    const record = [`${b.won}W`, `${b.lost}L`, b.drawn ? `${b.drawn}D` : null]
      .filter(Boolean)
      .join("-");
    const modes = Object.entries(b.by_mode)
      .sort((x, y) => y[1] - x[1])
      .map(([m, n]) => `${n} ${m}`)
      .join(", ");
    parts.push(
      `${plural(b.played, "battle")} since ${since} (${record}${modes ? `; ${modes}` : ""})`,
    );
  } else {
    parts.push(`no recorded battles since ${since}`);
  }
  if (
    e.trophies &&
    e.trophies.from !== null &&
    e.trophies.to !== null &&
    e.trophies.from !== e.trophies.to
  ) {
    const d = e.trophies.to - e.trophies.from;
    parts.push(
      `trophies ${e.trophies.from.toLocaleString("en-US")} → ${e.trophies.to.toLocaleString("en-US")} (${d > 0 ? "+" : ""}${d})`,
    );
  }
  for (const n of e.notables) {
    switch (n.kind) {
      case "best_trophies_band":
        parts.push(`new best ${n.value.toLocaleString("en-US")} trophies`);
        break;
      case "arena_promotion":
        parts.push(`reached a new arena`);
        break;
      case "ranked_promotion":
        parts.push(`promoted to ${n.league}`);
        break;
      case "collection_level":
        parts.push(`collection level ${n.value}`);
        break;
      case "career_wins":
        parts.push(`${n.value.toLocaleString("en-US")} career wins`);
        break;
      case "legendary_badge":
        parts.push(plural(n.count, "one-off badge"));
        break;
      case "badge_level":
        parts.push(plural(n.count, "badge level-up"));
        break;
      case "clan_joined":
        parts.push(`joined ${n.clan_name ?? "a clan"}`);
        break;
      case "clan_left":
        parts.push(`left ${n.clan_name ?? "their clan"}`);
        break;
      case "returned":
        parts.push(`back after ${plural(n.after_days, "quiet day")}`);
        break;
      default:
        break;
    }
  }
  if (e.collection.unlocked.items.length > 0)
    parts.push(
      `unlocked ${e.collection.unlocked.items.slice(0, 3).join(", ")}${e.collection.unlocked.more ? ` +${e.collection.unlocked.more}` : ""}`,
    );
  if (e.war.battles > 0) parts.push(`${plural(e.war.battles, "war battle")}`);
  if (
    b.played === 0 &&
    e.presence.days_quiet !== null &&
    e.presence.days_quiet >= 1
  )
    parts.push(
      `last recorded battle ${plural(e.presence.days_quiet, "day")} ago${e.presence.days_since_poll ? `, last polled ${plural(e.presence.days_since_poll, "day")} ago` : ""}`,
    );
  return `${who(e)}: ${parts.join("; ")}.`;
}

export function summarizeClan(e, timeZone = "UTC") {
  const since = sinceLabel(e.window.from, e.window.to, timeZone);
  const parts = [];
  const a = e.activity;
  if (a.battles !== null)
    parts.push(
      `${plural(a.battles, "battle")} by ${a.members_active} of ${a.members_total} members since ${since}`,
    );
  else
    parts.push(
      `${a.members_total} members since ${since} (roster and war only)`,
    );
  const r = e.roster;
  const moves = [];
  if (r.joined.items.length)
    moves.push(
      `joined: ${r.joined.items
        .slice(0, 5)
        .map((m) => m.name ?? m.tag)
        .join(
          ", ",
        )}${r.joined.items.length > 5 || r.joined.more ? ` +${r.joined.items.length - 5 + r.joined.more}` : ""}`,
    );
  if (r.left.items.length)
    moves.push(
      `left: ${r.left.items
        .slice(0, 5)
        .map((m) => m.name ?? m.tag)
        .join(
          ", ",
        )}${r.left.items.length > 5 || r.left.more ? ` +${r.left.items.length - 5 + r.left.more}` : ""}`,
    );
  if (r.role_changes.items.length)
    moves.push(
      `roles: ${r.role_changes.items
        .slice(0, 3)
        .map((m) => `${m.name ?? m.tag} ${m.from}→${m.to}`)
        .join(", ")}`,
    );
  if (moves.length) parts.push(moves.join("; "));
  if (r.size.from !== r.size.to)
    parts.push(`roster ${r.size.from}→${r.size.to}`);
  const w = e.war;
  if (w) {
    if (w.resolved.length) {
      for (const x of w.resolved)
        parts.push(
          `week ${x.week} finished${x.rank ? ` in place ${x.rank}` : ""}${x.fame !== null ? ` with ${x.fame.toLocaleString("en-US")} fame` : ""}`,
        );
    }
    if (w.day_kind === "war") {
      const d = w.decks;
      const state = w.race_finished_at
        ? "race finished"
        : w.fame !== null
          ? `${w.fame.toLocaleString("en-US")} fame, place ${w.place_of_five} of 5`
          : "";
      parts.push(
        `war day ${w.war_day}${state ? ` (${state})` : ""}${d ? `: ${d.untouched} untouched, ${d.partial} partial, ${d.finished} finished of ${d.participants}` : ""}`,
      );
    } else if (w.day_kind === "training") {
      parts.push(`training day`);
    }
  }
  const p = e.presence;
  if (p.quiet_crossed?.items.length)
    parts.push(
      `quiet past ${p.quiet_crossed.items[0].rung}d: ${p.quiet_crossed.items
        .slice(0, 5)
        .map((m) => `${m.name ?? m.tag} (${m.days_quiet}d)`)
        .join(", ")}${p.quiet_crossed.more ? ` +${p.quiet_crossed.more}` : ""}`,
    );
  if (p.returned?.items.length)
    parts.push(
      `back: ${p.returned.items
        .slice(0, 3)
        .map((m) => `${m.name ?? m.tag} after ${m.after_days}d`)
        .join(", ")}`,
    );
  const s = e.standouts;
  if (s) {
    if (s.most_battles.length)
      parts.push(
        `most battles: ${s.most_battles
          .slice(0, 3)
          .map((m) => `${m.name ?? m.tag} ${m.battles}`)
          .join(", ")}`,
      );
    if (s.new_bests.items.length)
      parts.push(
        `new bests: ${s.new_bests.items
          .slice(0, 3)
          .map((m) => `${m.name ?? m.tag} ${m.best.toLocaleString("en-US")}`)
          .join(", ")}${s.new_bests.more ? ` +${s.new_bests.more}` : ""}`,
      );
    if (s.arena_promotions.items.length)
      parts.push(
        `${plural(s.arena_promotions.items.length + s.arena_promotions.more, "arena promotion")} (${s.arena_promotions.items
          .slice(0, 3)
          .map((m) => `${m.name ?? m.tag} → ${m.arena}`)
          .join(", ")})`,
      );
    if (s.ranked_promotions.items.length)
      parts.push(
        `ranked: ${s.ranked_promotions.items
          .slice(0, 3)
          .map((m) => `${m.name ?? m.tag} → ${m.league}`)
          .join(", ")}`,
      );
    if (s.badges.length)
      parts.push(
        `badges: ${s.badges
          .slice(0, 3)
          .map((m) => `${m.name ?? m.tag} ${m.count}`)
          .join(", ")}`,
      );
  }
  if (e.donations.leader && e.donations.week_total > 0)
    parts.push(
      `donations this week ${e.donations.week_total.toLocaleString("en-US")}, led by ${e.donations.leader.name ?? e.donations.leader.tag} (${e.donations.leader.given})`,
    );
  return `${e.name ?? e.subject_tag}: ${parts.join("; ")}.`;
}
