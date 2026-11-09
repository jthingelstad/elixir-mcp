/**
 * The first-use funnel ({funnel: {days: 90}} or {funnel: true}), a read.
 *
 * Of the people who made an account in the last `days` (default 90, at
 * most 3650), how many signed in, added their player, got a first read,
 * verified, connected an agent and came back. Person accounts only:
 * agents and integrations are principals, not people. Overall and by the
 * UTC week (Monday) the account was made, newest first. Every figure is
 * read from what Elixir already keeps; nothing is stored for it.
 *
 *   accounts          person accounts made in the window, any status
 *   by_status         of those, by account.status
 *   signed_in         signed in at least once: a `signed_in` account
 *                     event (the web code and Discord sign-ins), a
 *                     session row (any sign-in; rows go 30 days after
 *                     they expire), an OAuth family (consent by code is a
 *                     sign-in) or a call of the person's own
 *   enrolled          made by `{account_enroll}` (its `enrolled` event)
 *   enrolled_never_signed_in  of those, no sign-in by the rule above
 *   primary_player    a primary claim now
 *   first_read        the primary has a first read landed: the same rule
 *                     as GET /api/me/first-answer and Home, a profile
 *                     snapshot or battle evidence for the tag
 *                     (`hasBattleEvidence`, @elixir-mcp/record/capture-state)
 *   verified          a verified claim now, or a `claim_verified` event
 *   agent_connected   a live agent connection now: an unrevoked,
 *                     unexpired OAuth family that is not a family app's
 *                     sign-in (Drop, Clan), or a live MCP service token,
 *                     on the person or on an agent they own
 *   came_back_7d / _30d  own activity on a later UTC day than the one
 *                     the account was made, within 7 or 30 days: a
 *                     sign-in (event or session minted) or a call they
 *                     made (mcp_call_audit under their account, never a
 *                     service token's). A session only seen or refreshed
 *                     is not a return (Jamie, 2026-10-08, the beta pulse).
 *                     `open_7d` / `open_30d` count accounts whose window
 *                     is still running, so a young week reads as so far.
 *   time_to_first_read  seconds from the primary claim's creation to the
 *                     first read: the earlier of the first admitted
 *                     profile receipt's fetch and the first stored battle
 *                     row for the tag. `measured` counts the accounts with
 *                     both instants and the read after the claim;
 *                     `already_recorded` counts primaries Elixir held
 *                     before the claim (a tag someone else records, or an
 *                     opponent's), which have no wait to measure.
 *
 * Counts only: no account id, address, email hash or tag is selected,
 * returned or logged. A read-only session; it writes nothing.
 */

import pg from "pg";
import { hasBattleEvidence } from "@elixir-mcp/record/capture-state";

const DEFAULT_DAYS = 90;
const MAX_DAYS = 3650;

const EMPTY = () => ({
  accounts: 0,
  signed_in: 0,
  enrolled: 0,
  enrolled_never_signed_in: 0,
  primary_player: 0,
  first_read: 0,
  verified: 0,
  agent_connected: 0,
  came_back_7d: 0,
  open_7d: 0,
  came_back_30d: 0,
  open_30d: 0,
});

/** Linear-interpolated percentile of sorted numbers (percentile_cont). */
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo));
}

function timing(waits, alreadyRecorded) {
  const sorted = [...waits].sort((a, b) => a - b);
  return {
    measured: sorted.length,
    already_recorded: alreadyRecorded,
    median_seconds: percentile(sorted, 0.5),
    p90_seconds: percentile(sorted, 0.9),
  };
}

export async function funnelOp(databaseUrl, spec = {}) {
  const days = spec === true || spec?.days == null ? DEFAULT_DAYS : spec.days;
  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS)
    return { error: `funnel: days must be an integer from 1 to ${MAX_DAYS}` };
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("set default_transaction_read_only = on");
    const { rows } = await db.query(
      `with people as (
         select a.account_id, a.status, a.created_at,
                date_trunc('week', a.created_at at time zone 'UTC')::date as week,
                (a.created_at at time zone 'UTC')::date as day0
           from account a
          where a.kind = 'person'
            and a.created_at >= now() - make_interval(days => $1)),
       agents as (
         select o.account_id as agent_id, o.owned_by_account_id as person_id
           from account o
          where o.kind = 'agent' and o.removed_at is null
            and o.owned_by_account_id in (select account_id from people)),
       own as (
         select account_id, created_at as at from account_event
          where kind = 'signed_in'
            and account_id in (select account_id from people)
         union all
         select account_id, created_at from session
          where account_id in (select account_id from people)
         union all
         select account_id, created_at from mcp_call_audit
          where created_at >= now() - make_interval(days => $1)
            and surface not like 'svc:%'
            and account_id in (select account_id from people)),
       activity as (
         select distinct account_id, (at at time zone 'UTC')::date as day
           from own)
       select p.week::text as week, p.status,
              (exists (select 1 from activity v where v.account_id = p.account_id)
                or exists (select 1 from oauth_family f
                            where f.account_id = p.account_id)) as signed_in,
              exists (select 1 from account_event e
                       where e.account_id = p.account_id and e.kind = 'enrolled')
                as enrolled,
              c.has_primary,
              c.primary_added_at,
              c.profile_available,
              c.last_battle_at,
              c.first_read_at,
              (exists (select 1 from claim x
                        where x.account_id = p.account_id and x.status = 'verified')
                or exists (select 1 from account_event e
                            where e.account_id = p.account_id
                              and e.kind = 'claim_verified')) as verified,
              (exists (select 1 from oauth_family f
                        where (f.account_id = p.account_id
                               or f.account_id in (select agent_id from agents g
                                                    where g.person_id = p.account_id))
                          and f.revoked_at is null and f.absolute_expires_at > now()
                          and not exists (select 1 from family_oauth_client fc
                                           where fc.client_id = f.client_id))
                or exists (select 1 from service_token t
                            where (t.account_id = p.account_id
                                   or t.account_id in (select agent_id from agents g
                                                        where g.person_id = p.account_id))
                              and t.revoked_at is null and t.audience = 'mcp'))
                as agent_connected,
              exists (select 1 from activity v
                       where v.account_id = p.account_id
                         and v.day between p.day0 + 1 and p.day0 + 7) as back_7d,
              exists (select 1 from activity v
                       where v.account_id = p.account_id
                         and v.day between p.day0 + 1 and p.day0 + 30) as back_30d,
              (now() at time zone 'UTC')::date <= p.day0 + 7 as open_7d,
              (now() at time zone 'UTC')::date <= p.day0 + 30 as open_30d
         from people p
         left join lateral (
           select true as has_primary,
                  c.created_at as primary_added_at,
                  -- first-answer.mjs's own two facts for the primary.
                  exists (select 1 from player_snapshot_daily s
                           where s.player_tag = c.player_tag
                             and s.profile_observed_at is not null)
                    as profile_available,
                  (select max(bp.battle_time) from battle_participant bp
                    where bp.player_tag = c.player_tag and bp.battle_time <= now())
                    as last_battle_at,
                  -- When the read landed: the first admitted profile
                  -- fetch, or the first battle row stored for the tag.
                  least(
                    (select min(r.fetched_at) from api_receipt r
                      where r.endpoint = 'player' and r.entity_key = c.player_tag
                        and r.admission = 'admitted'),
                    (select min(b.created_at) from battle_participant bp
                       join battle b on b.battle_id = bp.battle_id
                      where bp.player_tag = c.player_tag and bp.battle_time <= now()))
                    as first_read_at
             from claim c
            where c.account_id = p.account_id and c.is_primary
            order by c.created_at desc
            limit 1) c on true
        order by p.week desc`,
      [days],
    );

    const overall = EMPTY();
    const byStatus = {};
    const weeks = new Map();
    const waits = [];
    let alreadyRecorded = 0;
    for (const r of rows) {
      const firstRead =
        r.has_primary === true &&
        (r.profile_available === true ||
          hasBattleEvidence({
            battles_30d: 0,
            last_battle_at: r.last_battle_at,
          }));
      if (!weeks.has(r.week)) weeks.set(r.week, EMPTY());
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      for (const bucket of [overall, weeks.get(r.week)]) {
        bucket.accounts += 1;
        if (r.signed_in) bucket.signed_in += 1;
        if (r.enrolled) bucket.enrolled += 1;
        if (r.enrolled && !r.signed_in) bucket.enrolled_never_signed_in += 1;
        if (r.has_primary) bucket.primary_player += 1;
        if (firstRead) bucket.first_read += 1;
        if (r.verified) bucket.verified += 1;
        if (r.agent_connected) bucket.agent_connected += 1;
        if (r.back_7d) bucket.came_back_7d += 1;
        if (r.open_7d) bucket.open_7d += 1;
        if (r.back_30d) bucket.came_back_30d += 1;
        if (r.open_30d) bucket.open_30d += 1;
      }
      if (firstRead && r.primary_added_at && r.first_read_at) {
        const wait =
          (new Date(r.first_read_at).getTime() -
            new Date(r.primary_added_at).getTime()) /
          1000;
        if (wait < 0) alreadyRecorded += 1;
        else waits.push(wait);
      }
    }
    return {
      days,
      as_of: new Date().toISOString(),
      population:
        "person accounts made in the window (agents and integrations excluded)",
      overall: { ...overall, by_status: byStatus },
      // Newest first; a week with no accounts is not listed.
      by_week: [...weeks].map(([week, counts]) => ({
        week_starting: week,
        ...counts,
      })),
      time_to_first_read: timing(waits, alreadyRecorded),
      notes: [
        "first_read uses GET /api/me/first-answer's rule: a profile snapshot or battle evidence for the primary tag.",
        "signed_in: a signed_in event, a session (kept 30 days past expiry), an OAuth family or an own call; an old OAuth-consent-only sign-in with no other trace would read as never signed in.",
        "came_back counts sign-ins and own calls on a later UTC day, never a session merely seen or refreshed; open_* accounts are still inside that window.",
        "time_to_first_read runs from the primary claim's creation to the first admitted profile fetch or first stored battle; a primary re-chosen later is measured from the new claim.",
      ],
    };
  } finally {
    await db.end();
  }
}
