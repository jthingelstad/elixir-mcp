import pg from "pg";

/** Read-only census for the tracked-only correction (Jamie, 2026-10-06):
 *  history stays when someone tracks it today. Kept players are the
 *  recorded now (RECORDED_PLAYERS_SQL), every account's claims, and anyone
 *  ever seen in a clan recorded comprehensively (members past and present,
 *  from roster or war rows). A battle stays when one of them played in it;
 *  its other participants stay as identities. Clans stay when an account
 *  or an active recording names them. Each part is one repeatable-read,
 *  read-only transaction; nothing is written. Counts only, except
 *  `keep_tags`, which returns the kept subjects for the archive census. */

const PARTS = [
  "recordings",
  "subjects",
  "battles",
  "players",
  "clans",
  "receipts",
  "keep_tags",
];

const KEEP_SQL = `
  tracked_players as materialized (
    select subject_tag as player_tag from recording
     where subject_type = 'player' and status = 'active'
    union
    select cm.player_tag
      from recording r
      join clan_membership cm on cm.clan_tag = r.subject_tag
       and cm.left_observed_at is null
     where r.subject_type = 'clan' and r.status = 'active'
       and r.scope = 'comprehensive'
    union
    select player_tag from claim
  ),
  tracked_clans as materialized (
    select subject_tag as clan_tag from recording
     where subject_type = 'clan' and status = 'active'
    union
    select clan_tag from account_clan
  ),
  deep_clans as materialized (
    select subject_tag as clan_tag from recording
     where subject_type = 'clan' and status = 'active'
       and scope = 'comprehensive'
    union
    select clan_tag from account_clan where scope = 'comprehensive'
  ),
  former_members as materialized (
    select cm.player_tag from clan_membership cm
      join deep_clans d on d.clan_tag = cm.clan_tag
    union
    select wp.player_tag from war_participation wp
      join deep_clans d on d.clan_tag = wp.clan_tag
  ),
  keep_players as materialized (
    select player_tag from tracked_players
    union
    select player_tag from former_members
  ),
  keep_battles as materialized (
    select distinct bp.battle_id from battle_participant bp
      join keep_players k on k.player_tag = bp.player_tag
  )`;

const PLAYER_ENDPOINTS = ["player", "player_battlelog"];
const CLAN_ENDPOINTS = ["clan", "currentriverrace", "riverracelog"];
// Global capture that retired on 2026-10-02; the card catalog and game
// events are reference data and stay.
const RETIRED_ENDPOINTS = [
  "globaltournaments",
  "leaderboard",
  "leaderboards",
  "rankings_clans_loc",
  "rankings_clanwars",
  "rankings_players",
  "rankings_pol",
  "rankings_pol_season",
];

async function one(db, sql, params = []) {
  const { rows } = await db.query(`with ${KEEP_SQL} ${sql}`, params);
  return rows;
}

async function subjects(db) {
  const recordings = (
    await db.query(
      `select subject_type, scope, status, origin, count(*)::int as n
         from recording group by 1, 2, 3, 4 order by 1, 2, 3, 4`,
    )
  ).rows;
  const [sets] = await one(
    db,
    `select
       (select count(*) from tracked_players)::int as tracked_players,
       (select count(*) from claim)::int as claims,
       (select count(*) from tracked_clans)::int as tracked_clans,
       (select count(*) from deep_clans)::int as deep_clans,
       (select count(*) from former_members f
         where not exists (select 1 from tracked_players t
                            where t.player_tag = f.player_tag))::int
         as former_members_only,
       (select count(distinct wp.player_tag) from war_participation wp
          join deep_clans d on d.clan_tag = wp.clan_tag
         where not exists (select 1 from clan_membership cm
                            where cm.player_tag = wp.player_tag
                              and cm.clan_tag = wp.clan_tag))::int
         as war_only_members,
       (select count(*) from keep_players)::int as keep_players`,
  );
  // Players Elixir holds only because a tracked player's own clan roster
  // is polled: open members of a clan nobody tracks.
  const [roster] = await one(
    db,
    `, roster_clans as materialized (
       select distinct p.last_known_clan_tag as clan_tag
         from player p join keep_players k on k.player_tag = p.player_tag
        where p.last_known_clan_tag is not null
          and p.last_known_clan_tag not in (select clan_tag from tracked_clans)
     )
     select (select count(*) from roster_clans)::int as roster_clans,
            (select count(distinct cm.player_tag) from clan_membership cm
               join roster_clans rc on rc.clan_tag = cm.clan_tag
              where cm.left_observed_at is null
                and cm.player_tag not in (select player_tag from keep_players))::int
              as roster_only_members`,
  );
  return { recordings, ...sets, ...roster };
}

async function battles(db) {
  const [totals] = await one(
    db,
    `select (select count(*) from battle)::int as battles,
            (select count(*) from keep_battles)::int as keep,
            (select count(*) from battle_participant bp
              where not exists (select 1 from keep_battles k
                                 where k.battle_id = bp.battle_id))::int
              as remove_participants,
            (select count(*) from battle_participant_card c
              where not exists (select 1 from keep_battles k
                                 where k.battle_id = c.battle_id))::int
              as remove_cards,
            (select count(*) from battle_participant_round r
              where not exists (select 1 from keep_battles k
                                 where k.battle_id = r.battle_id))::int
              as remove_rounds,
            (select count(*) from player_event e
              where e.battle_id is not null
                and not exists (select 1 from keep_battles k
                                 where k.battle_id = e.battle_id))::int
              as remove_battle_events`,
  );
  const months = await one(
    db,
    `select to_char(date_trunc('month', b.battle_time), 'YYYY-MM') as month,
            count(*)::int as battles,
            count(*) filter (where k.battle_id is null)::int as remove
       from battle b left join keep_battles k on k.battle_id = b.battle_id
      group by 1 order by 1`,
  );
  const [decks] = await one(
    db,
    `, kept_decks as materialized (
       select bp.deck_hash from battle_participant bp
         join keep_battles k on k.battle_id = bp.battle_id
        where bp.deck_hash is not null
       union
       select r.deck_hash from battle_participant_round r
         join keep_battles k on k.battle_id = r.battle_id
        where r.deck_hash is not null
     )
     select (select count(*) from deck)::int as decks,
            (select count(*) from deck d
              where not exists (select 1 from kept_decks kd
                                 where kd.deck_hash = d.deck_hash))::int
              as orphaned_decks`,
  );
  return {
    ...totals,
    remove: totals.battles - totals.keep,
    by_month: months,
    ...decks,
  };
}

/** Every identity a kept row still names. */
const IDENTITY_SQL = `, identity_players as materialized (
    select player_tag from keep_players
    union select bp.player_tag from battle_participant bp
      join keep_battles k on k.battle_id = bp.battle_id
    union select player_tag from clan_membership
      where clan_tag in (select clan_tag from tracked_clans)
    union select player_tag from war_participation
      where clan_tag in (select clan_tag from tracked_clans)
    union select player_tag from war_attendance_day
      where clan_tag in (select clan_tag from tracked_clans)
    union select player_tag from clan_event
      where player_tag is not null
        and clan_tag in (select clan_tag from tracked_clans)
    union select player_tag from agent_identity
  )`;

const PLAYER_TABLES = [
  "player_snapshot_daily",
  "player_card",
  "player_badge",
  "player_daily_battle_rollup",
  "player_progress_daily",
  "player_pol_season",
  "player_activity",
  "player_event",
];

async function players(db) {
  const [ids] = await one(
    db,
    `${IDENTITY_SQL}
     select (select count(*) from player)::int as players,
            (select count(*) from keep_players)::int as keep_full,
            (select count(*) from identity_players)::int as keep_identity,
            (select count(*) from player p
              where not exists (select 1 from identity_players i
                                 where i.player_tag = p.player_tag))::int
              as remove`,
  );
  const tables = {};
  for (const table of PLAYER_TABLES) {
    const [row] = await one(
      db,
      `select count(*)::int as rows,
              count(*) filter (where x.player_tag not in
                (select player_tag from keep_players))::int as remove
         from ${table} x`,
    );
    tables[table] = row;
  }
  const [hw] = await one(
    db,
    `select count(*)::int as rows,
            count(*) filter (where observer_tag not in
              (select player_tag from keep_players))::int as remove
       from battlelog_high_water`,
  );
  tables.battlelog_high_water = hw;
  return { ...ids, tables };
}

const CLAN_TABLES = [
  "clan_snapshot_daily",
  "war_week",
  "war_week_clan",
  "war_participation",
  "war_attendance_day",
  "war_period_log",
  "war_period_anchor",
];

async function clans(db) {
  const tables = {};
  for (const table of CLAN_TABLES) {
    const [row] = await one(
      db,
      `select count(*)::int as rows,
              count(*) filter (where x.clan_tag not in
                (select clan_tag from tracked_clans))::int as remove
         from ${table} x`,
    );
    tables[table] = row;
  }
  // Memberships and clan events stay for a tracked clan, or for a kept
  // player wherever they were seen.
  for (const table of ["clan_membership", "clan_event"]) {
    const [row] = await one(
      db,
      `select count(*)::int as rows,
              count(*) filter (where x.clan_tag not in
                  (select clan_tag from tracked_clans)
                and (x.player_tag is null or x.player_tag not in
                  (select player_tag from keep_players)))::int as remove
         from ${table} x`,
    );
    tables[table] = row;
  }
  const [ids] = await one(
    db,
    `, identity_clans as materialized (
       select clan_tag from tracked_clans
       union select cm.clan_tag from clan_membership cm
         where cm.player_tag in (select player_tag from keep_players)
       union select ce.clan_tag from clan_event ce
         where ce.player_tag in (select player_tag from keep_players)
       union select s.clan_tag from player_snapshot_daily s
         where s.clan_tag is not null
           and s.player_tag in (select player_tag from keep_players)
       union select clan_tag from agent_policy_context_grant
     )
     select (select count(*) from clan)::int as clans,
            (select count(*) from clan c
              where c.clan_tag in (select clan_tag from tracked_clans))::int
              as tracked,
            (select count(*) from clan c
              where not exists (select 1 from identity_clans i
                                 where i.clan_tag = c.clan_tag))::int
              as remove`,
  );
  return { ...ids, tables };
}

async function receipts(db) {
  const rows = await one(
    db,
    `select r.endpoint,
            count(*)::int as receipts,
            count(*) filter (where r.replay_retired_at is not null)::int
              as already_retired,
            count(*) filter (where r.replay_retired_at is null and (
              (r.endpoint = any($1)
                and r.entity_key not in (select player_tag from keep_players))
              or (r.endpoint = any($2)
                and r.entity_key not in (select clan_tag from tracked_clans))
              or r.endpoint = any($3)
            ))::int as would_retire
       from api_receipt r group by 1 order by 1`,
    [PLAYER_ENDPOINTS, CLAN_ENDPOINTS, RETIRED_ENDPOINTS],
  );
  const [poll] = await one(
    db,
    `select count(*)::int as poll_state,
            count(*) filter (where not (
              ps.subject_tag in (select player_tag from keep_players)
              or ps.subject_tag in (select clan_tag from tracked_clans)
            ))::int as poll_state_untracked
       from poll_state ps`,
  );
  return { by_endpoint: rows, ...poll };
}

/** Active player recordings no claim explains: who they are, who asked,
 *  and what keeps them in the record besides the recording itself. */
async function recordings(db) {
  const { rows } = await db.query(
    `select r.subject_tag as player_tag, p.name, r.origin, r.scope,
            r.created_at, a.kind as requested_by_kind,
            a.role as requested_by_role,
            exists (select 1 from clan_membership m
                     join recording cr on cr.subject_type = 'clan'
                      and cr.subject_tag = m.clan_tag
                      and cr.status = 'active' and cr.scope = 'comprehensive'
                     where m.player_tag = r.subject_tag)
              as deep_clan_member_ever,
            p.last_known_clan_tag as clan_tag, c.name as clan_name,
            exists (select 1 from recording cr
                     where cr.subject_type = 'clan' and cr.status = 'active'
                       and cr.scope = 'comprehensive'
                       and cr.subject_tag = p.last_known_clan_tag)
              as clan_recorded,
            (select count(*) from claim cl
              where cl.player_tag = r.subject_tag)::int as claims,
            (select count(*) from battle_participant bp
              where bp.player_tag = r.subject_tag)::int as battles,
            (select max(bp.battle_time) from battle_participant bp
              where bp.player_tag = r.subject_tag) as last_battle
       from recording r
       join player p on p.player_tag = r.subject_tag
       left join account a on a.account_id = r.requested_by
       left join clan c on c.clan_tag = p.last_known_clan_tag
      where r.subject_type = 'player' and r.status = 'active'
        and r.origin <> 'claim'
      order by r.origin, p.name`,
  );
  return { rows };
}

async function keepTags(db) {
  const [row] = await one(
    db,
    `select array(select player_tag from keep_players order by 1) as players,
            array(select clan_tag from tracked_clans order by 1) as clans`,
  );
  return row;
}

const RUN = {
  recordings,
  subjects,
  battles,
  players,
  clans,
  receipts,
  keep_tags: keepTags,
};

export async function trackedCensus(databaseUrl, spec, client = null) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec))
    return { error: "invalid_tracked_census", reason: "object_required" };
  if (Object.keys(spec).some((key) => key !== "part"))
    return { error: "invalid_tracked_census", reason: "unknown_fields" };
  if (!PARTS.includes(spec.part))
    return {
      error: "invalid_tracked_census",
      reason: "unknown_part",
      parts: PARTS,
    };
  const db =
    client ??
    new pg.Client({
      connectionString: databaseUrl,
      connectionTimeoutMillis: 5000,
    });
  let transaction = false;
  try {
    await db.connect();
    await db.query("begin isolation level repeatable read read only");
    transaction = true;
    await db.query("set local statement_timeout = '80s'");
    await db.query("set local lock_timeout = '500ms'");
    const started = Date.now();
    const result = await RUN[spec.part](db);
    await db.query("commit");
    transaction = false;
    return {
      part: spec.part,
      readonly: true,
      elapsed_ms: Date.now() - started,
      ...result,
    };
  } catch (err) {
    if (transaction) {
      try {
        await db.query("rollback");
      } catch {
        /* Connection failed; no writes were allowed. */
      }
    }
    return {
      error: "tracked_census_failed",
      part: spec.part,
      message: err.message,
    };
  } finally {
    await db.end();
  }
}
