/** clan_report: one clan's week, composed once per clan and sent to
 *  every person tracking it. The clan entry (buildClanEntry) carries
 *  activity, roster changes, standouts, presence and donations the way
 *  the feed says them; war_history gives the week that closed; the
 *  members' daily series gives the roster table; clans_roster the roles. */
import { buildClanEntry } from "../../../mcp/src/activity/entries.mjs";
import { accountCtx, callTool } from "./ctx.mjs";
import { tryTool, weekday } from "./shared.mjs";

export async function buildClan({ db, account, clanTag, week, season }) {
  const ctx = accountCtx(db, account);
  const fromMs = week.from.getTime();
  const toMs = week.to.getTime();
  const tz = account.timezone;
  const { rows: scopeRows } = await db.query(
    `select scope from account_clan where account_id = $1 and clan_tag = $2`,
    [account.accountId, clanTag],
  );
  const scope = scopeRows[0]?.scope ?? "activity";
  const { entry } = await buildClanEntry(db, {
    tag: clanTag,
    scope,
    fromMs,
    toMs,
    timezone: tz,
  });
  const roster = await tryTool(callTool, ctx, "clans_roster", {
    clan_tag: clanTag,
  });
  const roleOf = new Map(
    (roster?.members ?? []).map((m) => [m.player_tag, roleLabel(m.role)]),
  );
  const fromDay = week.from.toISOString().slice(0, 10);
  const toDay = new Date(toMs - 1).toISOString().slice(0, 10);
  const series = await tryTool(callTool, ctx, "clans_members_timeline", {
    clan_tag: clanTag,
    from: fromDay,
    to: toDay,
    verbosity: "compact",
    metrics: ["trophies", "battle_count"],
    timezone: "UTC",
    limit: 50,
  });
  const current = new Set((roster?.members ?? []).map((m) => m.player_tag));
  const rosterRows = (series?.members ?? [])
    .filter((m) => current.size === 0 || current.has(m.player_tag))
    .map((m) => ({
      tag: m.player_tag,
      name: m.name ?? m.player_tag,
      role: roleOf.get(m.player_tag) ?? "member",
      trophies: m.last?.trophies ?? null,
      delta: m.delta?.trophies ?? null,
      battles: m.delta?.battle_count ?? null,
    }))
    .sort((a, b) => (b.trophies ?? -1) - (a.trophies ?? -1));

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
  const war = closed
    ? {
        present: true,
        season: closed.season_id,
        week: closed.section_index + 1,
        rank: closed.our_rank ?? null,
        fame: closed.our_fame ?? null,
        trophy_change: closed.trophy_change ?? null,
        clan_score: closed.our_clan_score ?? null,
        finished_early: Boolean(closed.finished_early),
        participants: closed.participants ?? null,
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
      text: sessionText(s, tz),
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
  const badges = (st?.badges ?? [])
    .flatMap((b) =>
      (b.names?.items ?? b.names ?? []).map((n) => ({
        name: b.name ?? b.tag,
        badge: n,
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
      members: r.size.to ?? roster?.member_count ?? rosterRows.length,
      members_from: r.size.from ?? r.size.to ?? rosterRows.length,
    },
    headline: {
      battles: entry.activity.battles ?? 0,
      active: entry.activity.members_active ?? 0,
      of: entry.activity.members_total ?? rosterRows.length,
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
        when: weekday(m.at, tz),
        note: r.bounced?.includes?.(m.tag)
          ? "left again inside the week"
          : null,
      })),
      left: (r.left?.items ?? r.left ?? []).map((m) => ({
        tag: m.tag,
        name: m.name ?? m.tag,
        when: weekday(m.at, tz),
        role: m.role,
      })),
      roles: (r.role_changes?.items ?? r.role_changes ?? []).map((m) => ({
        tag: m.tag,
        name: m.name ?? m.tag,
        from: m.from,
        to: m.to,
      })),
    },
    standouts: dedupe(standouts).slice(0, 8),
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
    roster: rosterRows,
    roster_note:
      scope === "comprehensive"
        ? null
        : "Activity scope: roster and war only; member battles are not recorded for this clan.",
    coverage: `Roster read ${roster?.meta?.freshness_seconds != null ? `${Math.round(roster.meta.freshness_seconds / 60)} min` : "recently"} before this was composed. Battles per member are profile deltas over the week; a dash means the profile was not polled at both ends of it.`,
  };
}

function roleLabel(role) {
  return role === "coLeader" ? "co-leader" : (role ?? "member");
}

function sessionText(s, tz) {
  const modes = Object.entries(s.by_mode ?? {})
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([m, n]) => `${n} ${m}`)
    .join(", ");
  const streak = s.won_in_a_row >= 5 ? `, ${s.won_in_a_row} wins in a row` : "";
  return `${s.battles} battles in one ${weekday(s.started_at, tz)} sitting (${s.won}W-${s.lost}L${modes ? `; ${modes}` : ""}${streak})`;
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
