/**
 * The words of the timeline: each entry's summary line and each item's
 * text. Deterministic, templated English a person can read, every number
 * taken from the facts beside it. No model call, no judgment, no verb of
 * instruction (review 2026-09-13, §12 and §14). If a sentence here would
 * not be worth reading on the console's Timeline page, it is not worth an
 * agent's tokens either.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const num = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "?");

function fmt(iso, timeZone, opts) {
  const d = new Date(iso);
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(d);
  } catch {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      ...opts,
    }).format(d);
  }
}

/** "since Thu 09:00" in the reader's zone; a window over a day says the date. */
function sinceLabel(fromIso, toIso, timeZone = "UTC") {
  const spanH = (new Date(toIso) - new Date(fromIso)) / 3_600_000;
  return fmt(
    fromIso,
    timeZone,
    spanH <= 36
      ? { weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }
      : { month: "short", day: "numeric" },
  );
}

/** "Sat 11:18" for an item's instant. */
const atLabel = (iso, timeZone) =>
  fmt(iso, timeZone, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const who = (e) => {
  const base = e.nickname
    ? `${e.nickname} (${e.name ?? e.subject_tag})`
    : (e.name ?? e.subject_tag);
  return e.relationship && e.relationship !== "primary"
    ? `${base}, ${e.relationship}`
    : base;
};

const record = (won, lost, drawn) =>
  [`${won}W`, `${lost}L`, drawn ? `${drawn}D` : null].filter(Boolean).join("-");
const modes = (byMode) =>
  Object.entries(byMode ?? {})
    .sort((x, y) => y[1] - x[1])
    .map(([m, n]) => `${n} ${m}`)
    .join(", ");

export function summarizePlayer(e, timeZone = "UTC") {
  const since = sinceLabel(e.window.from, e.window.to, timeZone);
  const parts = [];
  const b = e.battles;
  if (b.played > 0) {
    const m = modes(b.by_mode);
    parts.push(
      `${plural(b.played, "battle")} in ${plural(b.sessions, "session")} since ${since} (${record(b.won, b.lost, b.drawn)}${m ? `; ${m}` : ""})`,
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
      `trophies ${num(e.trophies.from)} → ${num(e.trophies.to)} (${d > 0 ? "+" : ""}${d})`,
    );
  }
  for (const n of e.notables) {
    switch (n.kind) {
      case "best_trophies_band":
        parts.push(`new best ${num(n.value)} trophies`);
        break;
      case "arena_promotion":
        parts.push(n.to ? `reached ${n.to}` : `reached a new arena`);
        break;
      case "ranked_promotion":
        parts.push(`promoted to ${n.league}`);
        break;
      case "collection_level":
        parts.push(`collection level ${n.value}`);
        break;
      case "career_wins":
        parts.push(`${num(n.value)} career wins`);
        break;
      case "legendary_badge":
        parts.push(`earned ${n.name}`);
        break;
      case "badge_level":
        parts.push(
          `${plural(n.count, "badge level-up")}${n.names?.length ? ` (${n.names.join(", ")})` : ""}`,
        );
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
      a.members_active > a.members_total
        ? `${plural(a.battles, "battle")} in ${plural(a.sessions, "session")} by ${a.members_active} players who were members during the window (roster now ${a.members_total}) since ${since}`
        : `${plural(a.battles, "battle")} in ${plural(a.sessions, "session")} by ${a.members_active} of ${a.members_total} members since ${since}`,
    );
  else
    parts.push(
      `${a.members_total} members since ${since} (roster and war only)`,
    );
  const r = e.roster;
  const names = (list, cap) =>
    `${list.items
      .slice(0, cap)
      .map((m) => m.name ?? m.tag)
      .join(
        ", ",
      )}${list.items.length > cap || list.more ? ` +${list.items.length - cap + list.more}` : ""}`;
  const moves = [];
  if (r.joined.items.length) moves.push(`joined: ${names(r.joined, 5)}`);
  if (r.left.items.length) moves.push(`left: ${names(r.left, 5)}`);
  if (r.role_changes.items.length)
    moves.push(
      `roles: ${r.role_changes.items
        .slice(0, 3)
        .map((m) => `${m.name ?? m.tag} ${m.from}→${m.to}`)
        .join(", ")}`,
    );
  if (moves.length) parts.push(moves.join("; "));
  if (r.size.from === 0 && r.size.to > 0)
    parts.push(`roster ${r.size.to} (recording began inside the window)`);
  else if (r.size.from !== r.size.to)
    parts.push(`roster ${r.size.from}→${r.size.to}`);
  const w = e.war;
  if (w) {
    for (const x of w.resolved)
      parts.push(
        `week ${x.week} finished${x.rank ? ` in place ${x.rank}` : ""}${x.fame !== null ? ` with ${num(x.fame)} fame` : ""}`,
      );
    if (w.day_kind === "war") {
      const d = w.decks;
      const state = w.race_finished_at
        ? "race finished"
        : w.fame !== null
          ? `${num(w.fame)} fame, place ${w.place_of_five} of 5`
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
          .map((m) => `${m.name ?? m.tag} ${num(m.best)}`)
          .join(", ")}${s.new_bests.more ? ` +${s.new_bests.more}` : ""}`,
      );
    if (s.arena_promotions.items.length)
      parts.push(
        `${plural(s.arena_promotions.items.length + s.arena_promotions.more, "arena promotion")} (${s.arena_promotions.items
          .slice(0, 3)
          .map((m) =>
            m.arena ? `${m.name ?? m.tag} → ${m.arena}` : (m.name ?? m.tag),
          )
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
          .map(
            (m) =>
              `${m.name ?? m.tag} ${m.count}${m.names?.length ? ` (${m.names.join(", ")})` : ""}`,
          )
          .join(", ")}`,
      );
  }
  if (e.donations.leader && e.donations.week_total > 0)
    parts.push(
      `donations this week ${num(e.donations.week_total)}, led by ${e.donations.leader.name ?? e.donations.leader.tag} (${e.donations.leader.given})`,
    );
  return `${e.name ?? e.subject_tag}: ${parts.join("; ")}.`;
}

/** One timeline item as a sentence. */
export function itemText(it, timeZone = "UTC") {
  const f = it.facts ?? {};
  const at = it.at ? atLabel(it.at, timeZone) : "";
  const subj = it.subject_name ?? it.subject_tag ?? "";
  const member = f.name ?? f.player_tag ?? "";
  switch (it.kind) {
    case "battle_session": {
      const m = modes(f.by_mode);
      const net =
        typeof f.trophy_net === "number" && f.trophy_net !== 0
          ? `, ${f.trophy_net > 0 ? "+" : ""}${f.trophy_net} trophies`
          : "";
      return `${at} ${subj} played a session of ${plural(f.battles, "battle")} (${record(f.won, f.lost, f.drawn)}${m ? `; ${m}` : ""}${net})${f.open ? ", still going" : ""}.`;
    }
    case "badge_earned":
      return `${at} ${member || subj} took ${f.name}${f.level ? ` to level ${f.level}` : ""}.`;
    case "legendary_badge_earned":
      return `${at} ${member || subj} earned ${f.name}.`;
    case "arena_changed":
      return `${at} ${member || subj} moved to ${f.to_name ?? `arena ${f.to}`}${f.from_name ? ` from ${f.from_name}` : ""}.`;
    case "ranked_promotion":
      return `${at} ${member || subj} was promoted to ${f.to_name ?? `league ${f.to}`}.`;
    case "best_trophies_band":
      return `${at} ${member || subj} set a new best of ${num(f.best)} trophies.`;
    case "collection_level_step":
      return `${at} ${member || subj} reached collection level ${f.level}.`;
    case "career_wins_step":
      return `${at} ${member || subj} passed ${num(f.wins)} career wins.`;
    case "card_unlocked":
      return `${at} ${member || subj} unlocked ${f.name ?? `card ${f.card_id}`}.`;
    case "member_joined":
      return `${at} ${f.name ?? f.player_tag} joined ${subj}${f.role && f.role !== "member" ? ` as ${f.role}` : ""}.`;
    case "member_left":
      return `${at} ${f.name ?? f.player_tag} left ${subj}${f.role_at_departure ? ` (was ${f.role_at_departure})` : ""}.`;
    case "member_role_changed": {
      // Rows written before 3.0.0 carry no direction; the roles say it.
      const rank = { member: 0, elder: 1, coLeader: 2, leader: 3 };
      const dir =
        f.direction ??
        ((rank[f.role_after] ?? 0) < (rank[f.role_before] ?? 0)
          ? "demoted"
          : "promoted");
      return `${at} ${f.name ?? f.player_tag} was ${dir} from ${f.role_before} to ${f.role_after} in ${subj}.`;
    }
    case "race_finished":
      return `${at} ${subj} crossed the finish line${f.fame !== null && f.fame !== undefined ? ` with ${num(f.fame)} fame` : ""}.`;
    case "week_resolved":
      return `${at} ${subj} finished week ${(f.section_index ?? 0) + 1}${f.rank ? ` in place ${f.rank}` : ""}${f.fame !== null && f.fame !== undefined ? ` with ${num(f.fame)} fame` : ""}${typeof f.trophy_change === "number" ? ` (${f.trophy_change > 0 ? "+" : ""}${f.trophy_change} war trophies)` : ""}.`;
    case "clan_joined":
      return `${at} ${subj} joined ${f.clan_name ?? f.clan_tag}.`;
    case "clan_left":
      return `${at} ${subj} left ${f.clan_name ?? f.clan_tag}${f.role && f.role !== "member" ? ` (was ${f.role})` : ""}.`;
    case "quiet_crossed":
      return `${at} ${member || subj} passed ${f.rung} recorded-quiet days${f.days_since_poll ? ` (last polled ${plural(f.days_since_poll, "day")} ago)` : ""}.`;
    case "returned":
      return `${at} ${member || subj} played again after ${plural(f.after_days, "quiet day")}.`;
    default:
      if (it.kind.startsWith("account_")) {
        const what = it.kind.slice("account_".length).replaceAll("_", " ");
        const detail = f.player_tag ?? f.clan_tag ?? f.role ?? f.name ?? "";
        return `${at} your account: ${what}${detail ? ` (${detail})` : ""}.`;
      }
      return `${at} ${subj}: ${it.kind.replaceAll("_", " ")}.`;
  }
}
