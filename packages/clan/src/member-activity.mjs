/** Recorded evidence for a current clan member. No evaluation or ledger writes.
 * The HTTP handler proves the caller's clan; the roster proves the subject.
 * Project only facts in the current observed stint, never private Clan state. */
import { normalizeTag } from "./gate.mjs";
import { ManageError } from "./manage/service.mjs";

const iso = (value) =>
  typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : null;
const count = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null;

export function createMemberActivity({
  mcp,
  weeklyCounts = async () => [],
  warBounds = async () => [],
  now = () => Date.now(),
}) {
  return async (clanTag, token, input, { cursor = null, to = null } = {}) => {
    const playerTag = normalizeTag(input);
    if (!playerTag) throw new ManageError(400, "invalid_tag");
    const call = async (name, args) => {
      const r = await mcp.callTool(token, name, args);
      if (!r.ok)
        throw new ManageError(
          r.status === 401 ? 401 : 502,
          r.status === 401 ? "session_expired" : "elixir_unavailable",
        );
      return r.body;
    };
    const roster = await call("clans_roster", { clan_tag: clanTag });
    const member = (roster.members ?? []).find(
      (m) => m.player_tag === playerTag,
    );
    if (roster.clan_tag !== clanTag || !member)
      throw new ManageError(404, "not_current_member");
    const p = await call("clans_participation", {
      clan_tag: clanTag,
      weeks: 4,
    });
    const participation = (p.members ?? []).find(
      (m) => m.player_tag === playerTag,
    );
    if (p.clan_tag !== clanTag || !participation)
      throw new ManageError(404, "not_current_member");
    const joined = iso(participation.joined_observed_at);
    const start = iso(p.weeks?.[0]?.from);
    if (!start) throw new ManageError(502, "elixir_unavailable");
    const from = joined && joined > start ? joined : start;
    const end = to === null ? new Date(now()).toISOString() : iso(to);
    if (!end || end > new Date(now()).toISOString() || end <= from)
      throw new ManageError(400, "invalid_window");
    if (cursor !== null && (typeof cursor !== "string" || cursor.length > 2000))
      throw new ManageError(400, "invalid_cursor");
    const page = await call("battles_query", {
      player_tag: playerTag,
      from,
      to: end,
      limit: 25,
      verbosity: "compact",
      ...(cursor ? { cursor } : {}),
    });
    // The tool is a player read. A clan view must additionally restrict
    // the participant's recorded clan, including after a return to this clan.
    const battles = (page.battles ?? [])
      .filter((b) => {
        const at = iso(b.battle_time);
        return b.me?.clan_tag === clanTag && at && at >= from && at < end;
      })
      .map((b) => ({
        battle_id: b.battle_id,
        battle_time: b.battle_time,
        mode_group: b.mode_group,
        game_mode: b.game_mode,
        outcome: b.me?.outcome ?? null,
        crowns: count(b.me?.crowns),
        opponent_crowns: count(b.opponents?.[0]?.crowns),
        url: /^https:\/\/elixir\.poapkings\.com\/battle\/[a-f0-9]{12,64}$/.test(
          b.url ?? "",
        )
          ? b.url
          : null,
      }));
    // Coverage is independent evidence, not permission to call an empty
    // page inactivity. Its global history/counts and account extras stay out.
    const r = await mcp.callTool(token, "elixir_coverage", {
      player_tag: playerTag,
    });
    const intervals = r.ok
      ? (r.body.observation_intervals ?? [])
          .filter((i) => {
            const a = iso(i.observed_from),
              b = iso(i.observed_to);
            return a && b && a >= from && b <= end && b > a;
          })
          .map((i) => ({
            from: i.observed_from,
            to: i.observed_to,
            expected_battles: count(i.expected_battles),
            captured_battles: count(i.captured_battles),
            complete:
              i.is_complete === true
                ? true
                : i.is_complete === false
                  ? false
                  : null,
          }))
      : [];
    const last = iso(participation.last_battle_time_in_clan);
    const weekCounts = new Map(
      (await weeklyCounts(clanTag, playerTag, p.weeks ?? [], from, end)).map(
        (w) => [w.iso_week, w],
      ),
    );
    const bounds = new Map(
      (await warBounds(p.war_weeks ?? [])).map((w) => [
        `${w.season_id}-${w.section_index}`,
        w,
      ]),
    );
    const asOf = iso(p.meta?.as_of);
    const warWeeks = (p.war_weeks ?? []).flatMap((w, index) => {
      const b = bounds.get(`${w.season_id}-${w.section_index}`);
      const a = iso(b?.from),
        z = iso(b?.to);
      // Calendar periods bound the weekly counter. A delayed first poll
      // cannot prove a week's start; an earlier observed start widens it.
      const observed = iso(w.started_observed_at);
      const start = a && observed && observed < a ? observed : a;
      if (start && z && (z <= from || start >= end)) return [];
      const comparable = !!(
        start &&
        z &&
        asOf &&
        start >= from &&
        (z <= end || asOf <= end)
      );
      return [
        {
          season_id: w.season_id,
          section_index: w.section_index,
          from: start,
          to: z,
          attribution_unknown: !comparable,
          decks: comparable ? count(participation.war_decks?.[index]) : null,
          points: comparable ? count(participation.war_points?.[index]) : null,
          finished_early: w.finished_early === true,
          is_colosseum: w.is_colosseum === true,
        },
      ];
    });
    return {
      clan_tag: clanTag,
      player_tag: playerTag,
      name: member.name ?? null,
      role: member.role,
      window: { from, to: end, joined_observed_at: joined },
      as_of: p.meta?.as_of ?? null,
      last_seen_in_game: member.last_seen_in_game ?? null,
      last_recorded_battle_in_clan:
        last && (!joined || last >= joined) ? last : null,
      battles,
      next_cursor: page.next_cursor ?? null,
      weeks: (p.weeks ?? []).flatMap((w) => {
        const a = iso(w.from),
          z = iso(w.covers?.to ?? w.to);
        if (!a || !z || z <= from || a >= end) return [];
        const effectiveFrom = a < from ? from : a;
        const effectiveTo = z > end ? end : z;
        return [
          {
            iso_week: w.iso_week,
            from: effectiveFrom,
            to: effectiveTo,
            partial:
              w.partial === true ||
              effectiveFrom !== a ||
              effectiveTo !== iso(w.to),
            battles: count(weekCounts.get(w.iso_week)?.battles),
            ranked_battles: count(weekCounts.get(w.iso_week)?.ranked_battles),
            donations:
              effectiveFrom > a
                ? null
                : count(weekCounts.get(w.iso_week)?.donations),
          },
        ];
      }),
      war_weeks: warWeeks,
      coverage: { available: r.ok === true, intervals },
    };
  };
}
