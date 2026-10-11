/**
 * The words of the timeline: each entry's summary line and each item's
 * text. Deterministic, templated English a person can read, every number
 * taken from the facts beside it. No model call, no judgment, no verb of
 * instruction. If a sentence here would
 * not be worth reading on the console's Timeline page, it is not worth an
 * agent's tokens either.
 */

import { badgeLabel } from "@elixir-mcp/record/badge-names";

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

/** "Oct 14" for a day an item names (an away's end): a date, never a
 *  clock time. */
const dayLabel = (iso, timeZone) =>
  fmt(iso, timeZone, { month: "short", day: "numeric" });

// The in-game name: a reader's nickname is a field of its own, never
// the text (#374; DECISIONS: nicknames are private).
const who = (e) => {
  const base = e.name ?? e.subject_tag;
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
  if (e.ranked?.rating) {
    const d = e.ranked.rating.to - e.ranked.rating.from;
    parts.push(
      `ranked rating ${num(e.ranked.rating.from)} → ${num(e.ranked.rating.to)} (${d > 0 ? "+" : ""}${d})`,
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
        parts.push(`earned ${badgeLabel(n.name)}`);
        break;
      case "badge_level":
        parts.push(
          `${plural(n.count, "badge level-up")}${n.names?.length ? ` (${n.names.map(badgeLabel).join(", ")})` : ""}`,
        );
        break;
      case "clan_joined":
        parts.push(`joined ${n.clan_name ?? "a clan"}`);
        break;
      case "clan_left":
        parts.push(`departed ${n.clan_name ?? "their clan"}`);
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
      `unlocked ${e.collection.unlocked.items.slice(0, 3).join(", ")}${e.collection.unlocked.more ? ` +${e.collection.unlocked.more} more` : ""}`,
    );
  const forms = e.collection.forms_unlocked;
  if (forms?.items.length > 0)
    parts.push(
      `unlocked ${forms.items.slice(0, 3).join(", ")}${forms.more ? ` +${forms.more} more` : ""}`,
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
  return `${e.name ?? e.subject_tag}: ${clanSummaryParts(e, timeZone).join("; ")}.`;
}

/** The clan sentence's clauses, in the order the sentence says them: the
 *  week's activity first, then roster moves, war, presence, standouts and
 *  donations. The timeline joins them into one sentence; the friends
 *  mail draws the first as a headline and the next few as bullets
 *  (2026-10-08), so both say the same facts in the same order. */
export function clanSummaryParts(e, timeZone = "UTC") {
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
      )}${list.items.length > cap || list.more ? ` +${Math.max(0, list.items.length - cap) + list.more} more` : ""}`;
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
  // What a capped list left out, said (Gym #303: "back:" named 3 of 12
  // returns with no +N and read as complete): the items past the cut
  // plus the ones the list itself already counted as more. "more", so it
  // never reads as a number of the last name's (#376: "dez42 ... +1").
  const rest = (list, shown) => {
    const n =
      Math.max(0, (list?.items?.length ?? 0) - shown) + (list?.more ?? 0);
    return n ? ` +${n} more` : "";
  };
  // Grouped by the rung each member crossed (Gym #267: "quiet past 10d"
  // headed a list where four had crossed only 5 days).
  if (p.quiet_crossed?.items.length) {
    const byRung = new Map();
    for (const m of p.quiet_crossed.items.slice(0, 5)) {
      if (!byRung.has(m.rung)) byRung.set(m.rung, []);
      byRung.get(m.rung).push(`${m.name ?? m.tag} (${m.days_quiet}d)`);
    }
    parts.push(
      [...byRung.entries()]
        .sort((a, b) => b[0] - a[0])
        .map(([rung, names]) => `quiet past ${rung}d: ${names.join(", ")}`)
        .join("; ") + rest(p.quiet_crossed, 5),
    );
  }
  if (p.returned?.items.length)
    parts.push(
      `back: ${p.returned.items
        .slice(0, 3)
        .map((m) => `${m.name ?? m.tag} after ${m.after_days}d`)
        .join(", ")}${rest(p.returned, 3)}`,
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
          .join(", ")}${rest(s.new_bests, 3)}`,
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
          .join(", ")}${rest(s.ranked_promotions, 3)}`,
      );
    if (s.sessions?.items.length)
      parts.push(
        `standout sessions: ${s.sessions.items
          .slice(0, 3)
          .map(
            (m) =>
              `${m.name ?? m.tag} ${m.won}W-${m.lost}L${m.trophy_net ? ` ${m.trophy_net > 0 ? "+" : ""}${m.trophy_net} trophies` : ""}${m.won_in_a_row >= 5 ? ` (${m.won_in_a_row} in a row)` : ""}`,
          )
          .join(", ")}${rest(s.sessions, 3)}`,
      );
    if (s.badges.length)
      parts.push(
        `badges: ${s.badges
          .slice(0, 3)
          .map(
            (m) =>
              `${m.name ?? m.tag} ${m.count}${m.names?.length ? ` (${m.names.map(badgeLabel).join(", ")})` : ""}`,
          )
          .join(", ")}`,
      );
  }
  if (e.donations.leader && e.donations.week_total > 0)
    parts.push(
      `donations this week ${num(e.donations.week_total)}, led by ${e.donations.leader.name ?? e.donations.leader.tag} (${e.donations.leader.given})`,
    );
  return parts;
}

/** ", on a 3-0 win over Jotaro (5,976), +30 to 6,000" - the battle a
 *  moment names (promoted_by / crossed_by), or nothing when the record did
 *  not hold the crossing. A 2v2 names the pair. */
const rated = (o) =>
  `${o.name ?? o.player_tag}${typeof o.starting_trophies === "number" ? ` (${num(o.starting_trophies)})` : ""}`;
/** Who a battle was against: one opponent with their trophies, or a pair. */
const against = (b) =>
  b.opponent
    ? rated(b.opponent)
    : b.opponents?.length
      ? b.opponents.map(rated).join(" and ")
      : "an opponent";
function onBattle(b) {
  if (!b) return "";
  const who = against(b);
  const score = `${b.crowns ?? "?"}-${b.crowns_against ?? "?"}`;
  const change =
    typeof b.trophy_change === "number"
      ? `, ${b.trophy_change > 0 ? "+" : ""}${b.trophy_change}${typeof b.trophies_after === "number" ? ` to ${num(b.trophies_after)}` : ""}`
      : "";
  return `, on a ${score} win over ${who}${change}`;
}

const signed = (n) => `${n > 0 ? "+" : ""}${num(n)}`;
/** A sitting's record, modes and ladder net. The net's peak rides along
 *  when it differs, so a trophy rung the final net no longer shows is
 *  still said (#373: crossed 150, ended at +117). */
function sitting(f) {
  const m = modes(f.by_mode);
  const net =
    typeof f.trophy_net === "number" && f.trophy_net !== 0
      ? `, ${signed(f.trophy_net)} trophies`
      : "";
  const peak =
    typeof f.trophy_net_peak === "number" &&
    f.trophy_net_peak !== 0 &&
    f.trophy_net_peak !== f.trophy_net
      ? `${net ? "" : ", net 0"}, peak ${signed(f.trophy_net_peak)}`
      : "";
  return `${record(f.won, f.lost, f.drawn)}${m ? `; ${m}` : ""}${net}${peak}`;
}
/** The decks and named events a sitting was played with. */
function played(f) {
  const decks = (f.decks ?? []).map((d) => `${d.label} (${d.battles})`);
  const events = (f.events ?? [])
    .filter((e) => e.name)
    .map((e) => `${e.name} (${e.battles})`);
  return `${decks.length ? `, with ${decks.join(", ")}` : ""}${events.length ? `, in ${events.join(", ")}` : ""}`;
}

/** Who carried a war week (2026-10-11, Jamie): the three members with the
 *  most points, each with their points and decks used, as `members`
 *  orders them. Points, never a member's share of fame; the week as a
 *  whole, never a day. */
const WEEK_LEADERS = 3;
function carried(members) {
  const top = (members ?? [])
    .filter((m) => typeof m.points === "number" && m.points > 0)
    .slice(0, WEEK_LEADERS)
    .map(
      (m) =>
        `${m.name ?? m.player_tag} (${num(m.points)} points${typeof m.decks_used === "number" ? `, ${plural(m.decks_used, "deck")}` : ""})`,
    );
  if (!top.length) return "";
  const list =
    top.length === 1
      ? top[0]
      : `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
  return `, led by ${list}`;
}

/** Who attested a fact, and through which app. */
const attester = (f) =>
  f.attested_by?.name ?? f.attested_by?.player_tag ?? f.attested_by?.app;
const by = (f) => attester(f) ?? "A leader";
const said = (f) =>
  `${attester(f) ?? "A leader"} said${f.attested_by?.app ? ` (in ${f.attested_by.app})` : ""}`;
const via = (f) => (f.attested_by?.app ? ` (via ${f.attested_by.app})` : "");

/** A card's form as a player says it (#110): "Evolution Valkyrie",
 *  "Hero Knight". Reads a ledger payload (`name`) or an item's facts
 *  (`card`). */
export function formLabel(f) {
  const card = f.card ?? f.name ?? `card ${f.card_id}`;
  const form = { evolution: "Evolution", hero: "Hero" }[f.form];
  return form ? `${form} ${card}` : `a new form of ${card}`;
}

/** One timeline item as a sentence. */
export function itemText(it, timeZone = "UTC") {
  const f = it.facts ?? {};
  const subj = it.subject_name ?? it.subject_tag ?? "";
  const member = f.name ?? f.player_tag ?? "";
  switch (it.kind) {
    case "battle_session":
      return `${member || subj} played a session of ${plural(f.battles, "battle")} (${sitting(f)})${played(f)}${f.open ? ", still going" : ""}.`;
    case "session_standout": {
      const run =
        f.won_in_a_row >= 5 ? `, ${f.won_in_a_row} wins in a row` : "";
      // A 2v2 pair's sittings are the same games: each says who with, so
      // a narrator can tell them as one (feedback #370). A sitting only
      // partly with the partner says how much of it (Codex on #482).
      const partner = f.teammate?.name ?? f.teammate?.player_tag;
      const mate = !f.teammate
        ? ""
        : f.teammate.battles >= f.battles
          ? ` with ${partner} in 2v2`
          : `, ${f.teammate.battles} of them with ${partner} in 2v2`;
      const best = f.best_win
        ? `; best win ${f.best_win.crowns ?? "?"}-${f.best_win.crowns_against ?? "?"} over ${against(f.best_win)}`
        : "";
      return `${member || subj} played ${plural(f.battles, "battle")} in one sitting${mate} (${sitting(f)}${run})${played(f)}${best}${f.open ? ", still going" : ""}.`;
    }
    // The badge as a player says it: a level above 1 is a level taken,
    // the first level (or a one-off) is a badge earned.
    case "badge_earned":
      return `${member || subj} ${f.level > 1 ? `took ${badgeLabel(f.badge ?? f.name)} to level ${f.level}` : `earned ${badgeLabel(f.badge ?? f.name)}`}.`;
    case "legendary_badge_earned":
      return `${member || subj} earned ${badgeLabel(f.badge ?? f.name)}.`;
    case "arena_changed":
      return `${member || subj} moved to ${f.to_name ?? `arena ${f.to}`}${f.from_name ? ` from ${f.from_name}` : ""}${onBattle(f.promoted_by)}.`;
    case "ranked_promotion":
      return `${member || subj} was promoted to ${f.to_name ?? `league ${f.to}`}${onBattle(f.promoted_by)}.`;
    case "best_trophies_band":
      return `${member || subj} set a new best of ${num(f.best)} trophies${f.crossed_by ? `, crossing ${num(f.band)}${onBattle(f.crossed_by)}` : ""}.`;
    case "collection_level_step":
      return `${member || subj} reached collection level ${f.level}.`;
    case "career_wins_step":
      return `${member || subj} passed ${num(f.wins)} career wins${f.crossed_by ? `, the ${num(f.step)}th${onBattle(f.crossed_by)}` : ""}.`;
    case "card_unlocked":
      return `${member || subj} unlocked ${f.card ?? f.name ?? `card ${f.card_id}`}.`;
    case "card_form_unlocked":
      return `${member || subj} unlocked ${formLabel(f)}.`;
    case "member_joined":
      return `${f.name ?? f.player_tag} joined ${subj}${f.role && f.role !== "member" ? ` as ${f.role}` : ""}.`;
    // The roster sees only that a member went, never whether they left or
    // were removed (Jamie, 2026-10-10: a kick is "was removed", never
    // "left", wherever the timeline is told), so the roster's own item
    // says neither; a leader's departure_classified says which.
    case "member_left":
      return `${f.name ?? f.player_tag} departed ${subj}${f.role_at_departure ? ` (was ${f.role_at_departure})` : ""}.`;
    case "member_role_changed": {
      // Rows written before 3.0.0 carry no direction; the roles say it.
      const rank = { member: 0, elder: 1, coLeader: 2, leader: 3 };
      const dir =
        f.direction ??
        ((rank[f.role_after] ?? 0) < (rank[f.role_before] ?? 0)
          ? "demoted"
          : "promoted");
      return `${f.name ?? f.player_tag} was ${dir} from ${f.role_before} to ${f.role_after} in ${subj}.`;
    }
    case "bracket_observed": {
      const rivals = (f.rivals ?? []).map((r) => r.name ?? r.tag).join(", ");
      return `${subj}'s week ${(f.section_index ?? 0) + 1}${f.is_colosseum ? " (Colosseum)" : ""} bracket: ${rivals || "no rivals recorded"}.`;
    }
    case "race_finished":
      return `${subj} crossed the finish line${f.fame !== null && f.fame !== undefined ? ` with ${num(f.fame)} fame` : ""}.`;
    case "week_resolved":
      return `${subj} finished week ${(f.section_index ?? 0) + 1}${f.rank ? ` in place ${f.rank}` : ""}${f.fame !== null && f.fame !== undefined ? ` with ${num(f.fame)} fame` : ""}${typeof f.trophy_change === "number" ? ` (${f.trophy_change > 0 ? "+" : ""}${f.trophy_change} war trophies)` : ""}${carried(f.members)}.`;
    case "clan_joined":
      return `${subj} joined ${f.clan_name ?? f.clan_tag}.`;
    case "clan_left":
      return `${subj} departed ${f.clan_name ?? f.clan_tag}${f.role && f.role !== "member" ? ` (was ${f.role})` : ""}.`;
    case "quiet_crossed":
      return `${member || subj} passed ${f.rung} recorded-quiet days${f.days_since_poll ? ` (last polled ${plural(f.days_since_poll, "day")} ago)` : ""}.`;
    case "returned":
      return `${member || subj} played again after ${plural(f.after_days, "quiet day")}.`;
    // Attested facts (9.2.0): said by a person through a family app, and
    // said as theirs.
    case "departure_classified":
      return `${said(f)} ${member} ${f.kind === "kick" ? "was removed from" : "left"} ${subj}${f.kind === "kick" ? "" : " on their own"}.`;
    case "role_change_made": {
      const rank = { member: 0, elder: 1, coLeader: 2, leader: 3 };
      const dir =
        (rank[f.to] ?? 0) < (rank[f.from] ?? 0) ? "demoted" : "promoted";
      return `${by(f)} ${dir} ${member} from ${f.from} to ${f.to} in ${subj}.`;
    }
    case "award_granted":
      return `${subj} gave ${member} ${f.award}${f.place ? ` (place ${f.place})` : ""} for season ${f.season_id}${via(f)}.`;
    case "member_away":
      return `${member} said they are away from ${subj}${f.until ? ` until ${dayLabel(f.until, timeZone)}` : ""}${via(f)}.`;
    case "clan_message":
      return f.channel === "leader_message"
        ? `${by(f)} sent ${subj} a Clan Leader Message${f.title ? `, "${f.title}"` : ""}: "${f.body}"`
        : `${by(f)} said in ${subj}'s clan chat: "${f.body}"`;
    case "personal_record":
      return `${subj} set a new personal best in ${f.game}: ${num(f.score)}${typeof f.previous_best === "number" ? ` (was ${num(f.previous_best)})` : ""}${via(f)}.`;
    case "award_standing": {
      const unit =
        { points: "points", donations: "donations", war_decks: "war decks" }[
          f.unit
        ] ?? f.unit;
      return `${member} stands ${f.place === 1 ? "first" : `in place ${f.place}`} in ${subj}'s ${f.award} for season ${f.season_id} with ${num(f.value)} ${unit}${f.previous_player_tag ? `, taking it from ${f.previous_name ?? f.previous_player_tag}` : ""}${via(f)}.`;
    }
    default:
      if (it.kind.startsWith("account_")) {
        const kind = it.kind.slice("account_".length);
        const what = kind.replaceAll("_", " ");
        // A clan event names its clan first: Elixir's follow of the
        // primary's clan (0205) carries the player it followed for too,
        // and "clan added (#PLAYER)" named the wrong thing (2026-10-08).
        const clanKind = kind.startsWith("clan_");
        const detail =
          (clanKind
            ? (f.clan_tag ?? f.player_tag)
            : (f.player_tag ?? f.clan_tag)) ??
          f.role ??
          f.name ??
          "";
        const auto =
          clanKind && f.auto === true
            ? f.player_tag
              ? `, automatically: ${f.player_tag}'s clan`
              : ", automatically"
            : "";
        // A burst is one item (#376): six connections revoked in a second
        // said once, with the apps they were.
        const apps = f.apps?.length ? f.apps.join(", ") : "";
        if (f.count > 1)
          return `your account: ${what}, ${f.count} at once${apps ? ` (${apps})` : ""}.`;
        const named = [apps, detail ? `${detail}${auto}` : ""]
          .filter(Boolean)
          .join(", ");
        return `your account: ${what}${named ? ` (${named})` : ""}.`;
      }
      return `${subj}: ${it.kind.replaceAll("_", " ")}.`;
  }
}
