/** clan_report: one clan's week, composed once per clan and sent to
 *  every person tracking it. The clan entry (buildClanEntry) carries
 *  activity, roster changes, standouts, presence and donations the way
 *  the feed says them; war_history gives the week that closed, with the
 *  race's standings and every member's points; clans_roster the size.
 *  The roster itself is a link (the board, EmailClan, 2026-10-01): a
 *  member-by-member table put a 50-member clan's mail past the size
 *  Gmail clips at, and the console already draws it. */
import { badgeLabel } from "@elixir-mcp/record/badge-names";
import { buildClanEntry } from "@elixir-mcp/tools/activity/entries";
import { accountCtx, callTool } from "./ctx.mjs";
import { tryTool } from "./shared.mjs";

/** The facts are the same for every reader (review 2026-09-27 §6.7):
 *  `account` only shapes the ctx the tools are called with, the scope is
 *  the clan's own recording scope, and a day is carried as an instant
 *  that each recipient's render names in their own zone. */
export async function buildClan({ db, account, clanTag, week, season }) {
  const ctx = accountCtx(db, account);
  const fromMs = week.from.getTime();
  const toMs = week.to.getTime();
  const scope = await clanScope(db, clanTag);
  const { entry } = await buildClanEntry(db, {
    tag: clanTag,
    scope,
    fromMs,
    toMs,
    timezone: "UTC",
  });
  const roster = await tryTool(callTool, ctx, "clans_roster", {
    clan_tag: clanTag,
  });
  const wars = await tryTool(callTool, ctx, "war_history", {
    clan_tag: clanTag,
    seasons: 2,
  });
  const closed = (wars?.weeks ?? []).find((w) => {
    const t = w.closed_at ?? w.finished;
    return (
      t &&
      Date.parse(t) >= fromMs - 6 * 3600_000 &&
      Date.parse(t) < toMs + 6 * 3600_000 &&
      !w.in_progress
    );
  });
  // Who battled, from the closed week's own roster (the tool, never a
  // second derivation): members whose weekly war decks were more than
  // none. war_history's week rows carry no participant count.
  const exact = closed
    ? await tryTool(callTool, ctx, "war_history", {
        clan_tag: clanTag,
        season_id: closed.season_id,
        section_index: closed.section_index,
      })
    : null;
  const battled = exact?.member_weeks
    ? exact.member_weeks.filter((m) => (m.decks_used ?? 0) > 0).length
    : null;
  const ours = (exact?.standings ?? []).find((c) => c.clan_tag === clanTag);
  const war = closed
    ? {
        present: true,
        season: closed.season_id,
        week: closed.section_index + 1,
        colosseum: Boolean(closed.is_colosseum),
        rank: closed.our_rank ?? null,
        fame: closed.our_fame ?? null,
        trophy_change: closed.trophy_change ?? null,
        war_trophies: closed.our_clan_war_trophies ?? null,
        finished_early: Boolean(closed.finished_early),
        finish_war_day: closed.finish_war_day ?? null,
        // The instant the boat crossed the line; each reader's render
        // names it in their own zone.
        finished_at: ours?.finish_time ?? null,
        battled,
        // Every clan in the race, the way war_history ranks them.
        standings: (exact?.standings ?? []).map((c) => ({
          tag: c.clan_tag,
          name: c.name ?? c.clan_tag,
          rank: c.rank ?? null,
          fame: c.fame ?? 0,
          finished: c.finish_time != null,
        })),
        // Who raced: each member's own points and war decks (points are
        // the member's; fame is the boat's), most points first.
        raced: (exact?.member_weeks ?? [])
          .filter((m) => (m.decks_used ?? 0) > 0)
          .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
          .map((m) => ({
            tag: m.player_tag,
            name: m.name ?? m.player_tag,
            points: m.points ?? 0,
            decks: m.decks_used ?? 0,
          })),
      }
    : { present: false };

  const r = entry.roster;
  const st = entry.standouts;
  const items = (l) => l?.items ?? l ?? [];
  const standouts = [];
  for (const m of (st?.most_battles ?? []).slice(0, 3))
    standouts.push({
      tag: m.tag,
      name: m.name ?? m.tag,
      text: `${m.battles} battles${m === st.most_battles[0] ? ", the most in the clan" : ""}`,
    });
  for (const s of items(st?.sessions).slice(0, 3))
    standouts.push({
      tag: s.tag,
      name: s.name ?? s.tag,
      text: sessionText(s),
    });
  for (const x of items(st?.ranked_promotions))
    standouts.push({
      tag: x.tag,
      name: x.name ?? x.tag,
      text: `promoted to ${x.league ?? "a new league"} in ranked${x.over ? ` (beat ${x.over} ${x.score})` : ""}`,
    });
  for (const x of items(st?.arena_promotions))
    standouts.push({
      tag: x.tag,
      name: x.name ?? x.tag,
      text: `reached ${x.arena ?? "a new arena"}${x.over ? ` (beat ${x.over} ${x.score})` : ""}`,
    });
  for (const x of items(st?.new_bests))
    standouts.push({
      tag: x.tag,
      name: x.name ?? x.tag,
      text: `new best of ${Number(x.best).toLocaleString("en-US")} trophies`,
    });
  // The clan's week, by kind (the board's rows): who played most, who
  // moved up, who set a best. A list's `more` is what the entry left out.
  const named = (l, map) => ({
    items: items(l).map((x) => ({
      tag: x.tag,
      name: x.name ?? x.tag,
      ...map(x),
    })),
    more: l?.more ?? 0,
  });
  const week_moves = st
    ? {
        top_battler: st.most_battles?.[0]
          ? {
              tag: st.most_battles[0].tag,
              name: st.most_battles[0].name ?? st.most_battles[0].tag,
              battles: st.most_battles[0].battles,
            }
          : null,
        ranked: named(st.ranked_promotions, (x) => ({ to: x.league ?? null })),
        arena: named(st.arena_promotions, (x) => ({ to: x.arena ?? null })),
        bests: named(st.new_bests, (x) => ({ best: x.best })),
      }
    : null;
  const badges = (st?.badges ?? [])
    .flatMap((b) =>
      (b.names?.items ?? b.names ?? []).map((n) => ({
        name: b.name ?? b.tag,
        badge: badgeLabel(n),
      })),
    )
    .slice(0, 8);

  return {
    week: {
      label: week.label,
      key: week.key,
      season,
      war_week: war.present ? war.week : null,
    },
    clan: {
      tag: clanTag,
      name: entry.name ?? roster?.name ?? clanTag,
      scope,
      members: r.size.to ?? roster?.member_count ?? null,
      members_from: r.size.from ?? r.size.to ?? roster?.member_count ?? null,
    },
    headline: {
      battles: entry.activity.battles ?? 0,
      active: entry.activity.members_active ?? 0,
      of: entry.activity.members_total ?? roster?.member_count ?? null,
      sessions: entry.activity.sessions ?? 0,
      donations: entry.donations?.week_total ?? 0,
      donations_leader: entry.donations?.leader
        ? {
            tag: entry.donations.leader.tag,
            name: entry.donations.leader.name ?? entry.donations.leader.tag,
            n: entry.donations.leader.given ?? "",
          }
        : null,
    },
    war,
    membership: {
      joined: (r.joined?.items ?? r.joined ?? []).map((m) => ({
        tag: m.tag,
        name: m.name ?? m.tag,
        at: m.at ?? null,
        role: m.role ?? null,
        note: r.bounced?.includes?.(m.tag)
          ? "left again inside the week"
          : null,
      })),
      left: (r.left?.items ?? r.left ?? []).map((m) => ({
        tag: m.tag,
        name: m.name ?? m.tag,
        at: m.at ?? null,
        role: m.role,
        tenure_days: m.tenure_days ?? null,
      })),
      more: (r.joined?.more ?? 0) + (r.left?.more ?? 0),
      roles: (r.role_changes?.items ?? r.role_changes ?? []).map((m) => ({
        tag: m.tag,
        name: m.name ?? m.tag,
        from: m.from,
        to: m.to,
        at: m.at ?? null,
      })),
    },
    standouts: dedupe(standouts).slice(0, 8),
    week_moves,
    presence: {
      quiet: (
        entry.presence?.quiet_crossed?.items ??
        entry.presence?.quiet_crossed ??
        []
      ).map((q) => ({
        name: q.name ?? q.tag,
        days: q.days ?? q.rung ?? q.days_quiet,
      })),
      returned: (
        entry.presence?.returned?.items ??
        entry.presence?.returned ??
        []
      ).map((q) => ({ name: q.name ?? q.tag, days: q.after_days })),
    },
    badges,
    roster_note:
      scope === "comprehensive"
        ? null
        : "Activity scope: roster and war only; member battles are not recorded for this clan.",
    coverage: `Counted from what Elixir recorded for ${entry.name ?? roster?.name ?? clanTag}, Monday to Monday at the river race's own reset; the roster was read ${roster?.meta?.freshness_seconds != null ? `${Math.round(roster.meta.freshness_seconds / 60)} min` : "shortly"} before this was composed.`,
  };
}

/** The clan's recording scope: the widest any tracker
 *  asked for, as the recording holds it; with no active recording, the
 *  widest tracker's request. Never one reader's own request: a tracker
 *  who chose activity scope does not narrow a clan another tracker has
 *  recorded comprehensively. */
async function clanScope(db, clanTag) {
  const { rows } = await db.query(
    `select coalesce(
        (select case when bool_or(scope = 'comprehensive') then 'comprehensive' else 'activity' end
           from recording
          where subject_type = 'clan' and subject_tag = $1 and status = 'active'
         having count(*) > 0),
        (select case when bool_or(scope = 'comprehensive') then 'comprehensive' else 'activity' end
           from account_clan where clan_tag = $1
         having count(*) > 0),
        'activity') as scope`,
    [clanTag],
  );
  return rows[0].scope;
}

function sessionText(s) {
  const modes = Object.entries(s.by_mode ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n} ${m}`)
    .join(", ");
  const streak = s.won_in_a_row >= 5 ? `, ${s.won_in_a_row} wins in a row` : "";
  // {{day:<instant>}}: the render names the day in the reader's zone.
  const day = s.started_at ? `{{day:${s.started_at}}} ` : "";
  return `${s.battles} battles in one ${day}sitting (${s.won}W-${s.lost}L${modes ? `; ${modes}` : ""}${streak})`;
}

function dedupe(rows) {
  const seen = new Map();
  for (const r of rows) {
    const cur = seen.get(r.tag);
    if (cur) cur.text += `; ${r.text}`;
    else seen.set(r.tag, { ...r });
  }
  return [...seen.values()];
}
