import { KIND_LABELS } from "@elixir-mcp/mail";

/**
 * The beta pulse (Admin ▸ Beta pulse, 2026-10-08): how the people who
 * signed up each week got on, as counts by signup week. Aggregate only:
 * every number is a count of accounts in a signup-week cohort, and no
 * response names, lists or links an account (Accounts is the page for
 * that). DECISIONS, "What is kept and counted, SETTLED": measurement is
 * aggregate.
 *
 * Read from what Elixir already keeps; nothing new is stored for it.
 *
 * The population: person accounts (never an agent or an integration),
 * not denied, made in the window. Staff and their test mailboxes are
 * left out and counted apart: an owner or admin account, and any
 * account whose address is a staff address with a +tag (the mailbox
 * sub-address a maintainer uses for a test signup). No address is
 * written here; the rule reads the accounts table.
 *
 * Weeks are ISO weeks (Monday 00:00 UTC), the running one included.
 * Each step is "ever reached" where the record keeps the history and
 * "now" where it keeps only the state:
 *   added_player     a claim now, or a claim_added event
 *   primary_set      a primary claim now
 *   profile          the primary has an admitted profile
 *   battles          the primary's own battle log has been admitted
 *                    with battles in it (battlelog_high_water)
 *   clan_followed    a followed clan now, or a clan_added event
 *   clan_auto        of those, one Elixir followed for them (0205)
 *   verified         a verified claim now, or a claim_verified event
 *   came_back_week1  the person using Elixir on a later day of their
 *                    own: a sign-in (signed_in event) or a call they
 *                    made (Console, Ladder, MCP or API; mcp_call_audit
 *                    under their account, never a service token's) on
 *                    a day 1 to 7 days after the signup day
 *   came_back_week2  the same on days 8 to 14
 * Days are the account's own, in its time zone (UTC when it has none,
 * or one Postgres does not know). A session only seen or refreshed is
 * not a return: a tab left open past midnight is not the person coming
 * back (Jamie, 2026-10-08).
 * A came-back window still running reports how many accounts are in it
 * (`open`), so a young cohort's share reads as so far, not as final.
 *
 * Mail: product sends per kind per week (email_send) to the same
 * population. Opens are not here: the pixel counts them in Tinylytics,
 * per mail, never per reader, and the servers never read them back
 * (DECISIONS: "Analytics is client-side Tinylytics only").
 */
const PULSE_WEEKS = 8;

/** One person's mailbox: the address without a +tag, lower-cased. */
const MAILBOX = (col) =>
  `split_part(split_part(lower(${col}), '@', 1), '+', 1) || '@' || split_part(lower(${col}), '@', 2)`;

const POPULATION = `
  staff as (
    select ${MAILBOX("email")} as mailbox
      from account
     where kind = 'person' and role in ('owner', 'admin') and email is not null),
  people as (
    select a.account_id, a.created_at, a.timezone,
           date_trunc('week', a.created_at at time zone 'UTC')::date as week,
           case when a.role in ('owner', 'admin') then 'staff'
                when a.email is not null
                 and ${MAILBOX("a.email")} in (select mailbox from staff) then 'test'
           end as excluded
      from account a
     where a.kind = 'person' and a.status <> 'denied'
       and a.created_at >= ($1::date)::timestamp at time zone 'UTC'),
  cohort as (select * from people where excluded is null)`;

/**
 * The pulse as of `now` (a Date; the clock is a parameter so a test can
 * pin it). Returns { weeks: [...], totals, excluded, mail, opens }.
 */
export async function betaPulse(
  db,
  { now = new Date(), weeks = PULSE_WEEKS } = {},
) {
  const today = now.toISOString().slice(0, 10);
  // The Monday (UTC) that starts the oldest week shown.
  const start = new Date(`${today}T00:00:00Z`);
  start.setUTCDate(
    start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - 7 * (weeks - 1),
  );
  const since = start.toISOString().slice(0, 10);

  const { rows: cohortRows } = await db.query(
    `with ${POPULATION},
     zones as materialized (
       select distinct on (lower(name)) lower(name) as key, name
         from pg_timezone_names
        order by lower(name), name),
     zoned as (
       select c.account_id, c.week, c.created_at, coalesce(z.name, 'UTC') as zone
         from cohort c
         left join zones z on z.key = lower(c.timezone)),
     local as (
       select account_id, week, zone,
              (created_at at time zone zone)::date as day0,
              ($2::timestamptz at time zone zone)::date as today
         from zoned),
     own as (
       select account_id, created_at as at
         from mcp_call_audit
        where created_at >= ($1::date)::timestamp at time zone 'UTC'
          and created_at <= $2::timestamptz
          and surface not like 'svc:%'
          and account_id in (select account_id from cohort)
       union all
       select account_id, created_at
         from account_event
        where kind = 'signed_in' and created_at >= ($1::date)::timestamp at time zone 'UTC'
          and created_at <= $2::timestamptz
          and account_id in (select account_id from cohort)),
     activity as (
       select distinct o.account_id, (o.at at time zone l.zone)::date as day
         from own o
         join local l on l.account_id = o.account_id),
     facts as (
       select c.week,
              exists (select 1 from claim x where x.account_id = c.account_id)
                or exists (select 1 from account_event e
                            where e.account_id = c.account_id and e.kind = 'claim_added')
                as added_player,
              p.player_tag is not null as has_primary,
              p.player_tag is not null and exists (
                select 1 from player_snapshot_daily s
                 where s.player_tag = p.player_tag and s.profile_observed_at is not null)
                as profile,
              p.player_tag is not null and exists (
                select 1 from battlelog_high_water h where h.observer_tag = p.player_tag)
                as battles,
              exists (select 1 from account_clan ac where ac.account_id = c.account_id)
                or exists (select 1 from account_event e
                            where e.account_id = c.account_id and e.kind = 'clan_added')
                as clan_followed,
              exists (select 1 from account_clan ac
                       where ac.account_id = c.account_id and ac.auto_followed_at is not null)
                or exists (select 1 from account_event e
                            where e.account_id = c.account_id and e.kind = 'clan_added'
                              and e.detail->>'auto' = 'true')
                as clan_auto,
              exists (select 1 from claim x
                       where x.account_id = c.account_id and x.verified_at is not null)
                or exists (select 1 from account_event e
                            where e.account_id = c.account_id and e.kind = 'claim_verified')
                as verified,
              exists (select 1 from activity v
                       where v.account_id = c.account_id
                         and v.day between c.day0 + 1 and c.day0 + 7) as back_week1,
              exists (select 1 from activity v
                       where v.account_id = c.account_id
                         and v.day between c.day0 + 8 and c.day0 + 14) as back_week2,
              c.today <= c.day0 + 7 as week1_open,
              c.today <= c.day0 + 14 as week2_open
         from local c
         left join claim p on p.account_id = c.account_id and p.is_primary)
     select week::text,
            count(*)::int as signed_up,
            count(*) filter (where added_player)::int as added_player,
            count(*) filter (where has_primary)::int as primary_set,
            count(*) filter (where profile)::int as profile,
            count(*) filter (where battles)::int as battles,
            count(*) filter (where clan_followed)::int as clan_followed,
            count(*) filter (where clan_auto)::int as clan_auto,
            count(*) filter (where verified)::int as verified,
            count(*) filter (where back_week1)::int as came_back_week1,
            count(*) filter (where week1_open)::int as week1_open,
            count(*) filter (where back_week2)::int as came_back_week2,
            count(*) filter (where week2_open)::int as week2_open
       from facts
      group by week`,
    [since, now.toISOString()],
  );

  const { rows: excludedRows } = await db.query(
    `with ${POPULATION}
     select count(*) filter (where excluded = 'staff')::int as staff,
            count(*) filter (where excluded = 'test')::int as test
       from people`,
    [since],
  );

  const { rows: mailRows } = await db.query(
    `with ${POPULATION}
     select date_trunc('week', s.enqueued_at at time zone 'UTC')::date::text as week,
            i.kind, count(*)::int as sends
       from email_send s
       join email_issue i on i.issue_id = s.issue_id
       join account a on a.account_id = s.account_id
      where s.enqueued_at >= ($1::date)::timestamp at time zone 'UTC'
        and a.kind = 'person'
        and coalesce(a.role, 'member') not in ('owner', 'admin')
        and (a.email is null or ${MAILBOX("a.email")} not in (select mailbox from staff))
      group by 1, 2`,
    [since],
  );

  // Every week of the window, oldest first, empty ones included.
  const weekStarts = [];
  for (let i = 0; i < weeks; i += 1) {
    const d = new Date(`${since}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 7 * i);
    weekStarts.push(d.toISOString().slice(0, 10));
  }
  const empty = {
    signed_up: 0,
    added_player: 0,
    primary_set: 0,
    profile: 0,
    battles: 0,
    clan_followed: 0,
    clan_auto: 0,
    verified: 0,
    came_back_week1: 0,
    week1_open: 0,
    came_back_week2: 0,
    week2_open: 0,
  };
  const byWeek = new Map(cohortRows.map((r) => [r.week, r]));
  const out = weekStarts.map((starts) => {
    // The row's own `week` is the Monday; the label replaces it.
    return {
      ...empty,
      ...byWeek.get(starts),
      week: isoWeek(starts),
      starts,
    };
  });
  const totals = { ...empty };
  for (const w of out) for (const k of Object.keys(empty)) totals[k] += w[k];

  const kinds = [...new Set(mailRows.map((r) => r.kind))].sort();
  const mail = {
    weeks: weekStarts.map(isoWeek),
    kinds: kinds.map((kind) => ({
      kind,
      label: KIND_LABELS[kind] ?? kind,
      sends: weekStarts.map(
        (starts) =>
          mailRows.find((r) => r.kind === kind && r.week === starts)?.sends ??
          0,
      ),
    })),
  };

  return {
    as_of: now.toISOString(),
    since,
    weeks: out,
    totals,
    excluded: excludedRows[0],
    mail,
    opens: {
      measured_here: false,
      where: "Tinylytics",
      path: "/mail/<kind>/<period>",
      note: "Opens are counted by the mail's pixel in Tinylytics, per mail and never per reader; the servers never read them back.",
    },
  };
}

/** "2026-W41" for the Monday that starts an ISO week. */
export function isoWeek(monday) {
  const d = new Date(`${monday}T00:00:00Z`);
  // The ISO week-year is the year of the week's Thursday.
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3);
  const year = thursday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const n = Math.round((d - week1Monday) / (7 * 86400000)) + 1;
  return `${year}-W${String(n).padStart(2, "0")}`;
}
