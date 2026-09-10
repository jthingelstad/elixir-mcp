/** The jobs Lambda — scheduled product work, split out of the migrate
 *  Lambda (review item 5, 2026-09-05): EventBridge fires the daily
 *  clan pulse and the weekly sweeps here, so the function that can
 *  alter schema is never also the one running on a timer. Same VPC and
 *  role; deliberately no migration or seeding code paths.
 *
 *  Ops payloads: {clan_pulse: true} · {sweep_payloads: true,
 *  sweep_operational: true} · {sweep_operational: true}. */

import pg from "pg";

/** Weekly Postgres sweep ({sweep_payloads: true}, EventBridge MON 08:15Z):
 *  superseded payload rows (not the latest per endpoint+entity) leave
 *  Postgres only after their S3 twin HEAD-verifies. Bounded per run —
 *  next week's run takes the next slice. */
export async function sweepPayloads(databaseUrl, s3override) {
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
  const { archiveKey } = await import("../../ingest/src/pipeline.mjs");
  const { S3Client, HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = s3override ?? new S3Client({});
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select p.payload_id, p.endpoint, p.entity_key, p.payload_hash,
              p.first_fetched_at
       from api_payload p
       where exists (select 1 from api_payload newer
                     where newer.endpoint = p.endpoint
                       and newer.entity_key = p.entity_key
                       and (newer.last_fetched_at, newer.payload_id)
                         > (p.last_fetched_at, p.payload_id))
       order by p.payload_id limit 2000`,
    );
    let swept = 0;
    let missing = 0;
    for (const r of rows) {
      const key = archiveKey(
        r.endpoint,
        r.entity_key,
        r.first_fetched_at.toISOString(),
        r.payload_hash,
      );
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        missing += 1; // no twin -> the row stays; export fills the gap
        continue;
      }
      await db.query(`delete from api_payload where payload_id = $1`, [
        r.payload_id,
      ]);
      swept += 1;
    }
    return { candidates: rows.length, swept, missing };
  } finally {
    await db.end();
  }
}

/** Daily clan pulse ({clan_pulse: true}, EventBridge 07:00Z —
 *  CLAN-PULSE.md): one digest feed event per added-with-notify clan per
 *  UTC day, so a scheduled agent routine can run clan management from
 *  the feed. FACTS ONLY — days-quiet numbers and deck counts, never
 *  judgments; thresholds beyond the 5-day reporting floor belong to the
 *  routine reading it. Idempotent per (clan, UTC day): safe to re-invoke
 *  by hand after a partial run. */
export async function clanPulse(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { emitToSubjectWatchers } = await import("../../mcp/src/feed.mjs");
    const { anchoredPeriod } = await import("../../ingest/src/war-clock.mjs");
    const { rows: clans } = await db.query(
      `select distinct clan_tag from account_clan where notify order by clan_tag`,
    );
    const out = { clans: clans.length, emitted: 0, skipped: 0 };
    for (const { clan_tag } of clans) {
      const { rows: dup } = await db.query(
        `select 1 from event_feed
         where topic = 'clan_pulse' and subject_tag = $1
           and created_at >= date_trunc('day', now()) limit 1`,
        [clan_tag],
      );
      if (dup[0]) {
        out.skipped += 1;
        continue;
      }
      const payload = await computeClanPulse(db, clan_tag, anchoredPeriod);
      await emitToSubjectWatchers(db, "clan_pulse", clan_tag, { payload });
      out.emitted += 1;
    }
    return out;
  } finally {
    await db.end();
  }
}

async function computeClanPulse(db, tag, anchoredPeriod) {
  const { rows: roster } = await db.query(
    `select count(*)::int as members from clan_membership
     where clan_tag = $1 and left_observed_at is null`,
    [tag],
  );
  // bp.clan_tag is the clan AT BATTLE TIME, so a member's battles count
  // for the clan they were in when they played them.
  const { rows: act } = await db.query(
    `select count(distinct bp.battle_id)::int as battles,
            count(distinct bp.player_tag)::int as active
     from battle b join battle_participant bp on bp.battle_id = b.battle_id
     where bp.clan_tag = $1 and b.battle_time > now() - interval '24 hours'`,
    [tag],
  );
  const { rows: top } = await db.query(
    `select bp.player_tag, p.name, count(distinct bp.battle_id)::int as battles
     from battle b join battle_participant bp on bp.battle_id = b.battle_id
     join player p on p.player_tag = bp.player_tag
     where bp.clan_tag = $1 and b.battle_time > now() - interval '24 hours'
     group by bp.player_tag, p.name
     order by battles desc, p.name nulls last limit 3`,
    [tag],
  );
  // 5 recorded-quiet days is the reporting FLOOR (elixir-bot's line);
  // what a leader does about day 6 vs day 9 is the routine's call.
  /**
   * Quiet members, each carrying enough to tell OUR gap from THEIR silence.
   *
   * days_quiet is derived from the last battle we RECORDED, so for a member
   * we stopped polling it measures our capture gap and not their inactivity
   * -- and the payload gave no way to tell those apart. A reader asking "is X
   * inactive or just not tracked?" had to spend an elixir_coverage call per
   * name (agent feedback #10, filed from a pulse).
   *
   * Both added fields use coverage's OWN definitions -- last_admitted_at on
   * the battlelog poll_state row, and the first battle we ever saw -- so the
   * pulse and elixir_coverage cannot disagree about the same member.
   *
   * Still facts, not judgments: days_since_poll sits beside days_quiet in the
   * same unit so they are directly comparable, and what counts as "too stale
   * to trust" stays the reading routine's call.
   */
  const { rows: quiet } = await db.query(
    `select cm.player_tag, p.name,
            floor(extract(epoch from (now() - max(b.battle_time))) / 86400)::int
              as days_quiet,
            min(b.battle_time) as recorded_since,
            (select floor(extract(epoch from (now() - ps.last_admitted_at)) / 86400)::int
               from poll_state ps
              where ps.subject_tag = cm.player_tag
                and ps.endpoint = 'player_battlelog') as days_since_poll
     from clan_membership cm
     join player p on p.player_tag = cm.player_tag
     join battle_participant bp on bp.player_tag = cm.player_tag
     join battle b on b.battle_id = bp.battle_id
     where cm.clan_tag = $1 and cm.left_observed_at is null
     group by cm.player_tag, p.name
     having max(b.battle_time) < now() - interval '5 days'
     order by days_quiet desc, p.name nulls last limit 10`,
    [tag],
  );
  // The count alone could not be acted on: "3 members have no recorded
  // history" gives a routine nobody to look at. These are the members the
  // quiet[] list structurally cannot contain -- it joins through
  // battle_participant, so somebody with no recorded battle at all is
  // invisible there. Bounded, because a freshly added clan is briefly all of
  // them.
  const { rows: neverRec } = await db.query(
    `select count(*)::int as n,
            coalesce((select json_agg(x) from (
              select cm2.player_tag, p2.name
                from clan_membership cm2
                join player p2 on p2.player_tag = cm2.player_tag
               where cm2.clan_tag = $1 and cm2.left_observed_at is null
                 and not exists (select 1 from battle_participant bp2
                                  where bp2.player_tag = cm2.player_tag)
               order by p2.name nulls last limit 10) x), '[]') as members
     from clan_membership cm
     where cm.clan_tag = $1 and cm.left_observed_at is null
       and not exists (select 1 from battle_participant bp
                       where bp.player_tag = cm.player_tag)`,
    [tag],
  );
  const { rows: changes } = await db.query(
    `select count(*) filter (where joined_observed_at > now() - interval '24 hours')::int
              as joined,
            count(*) filter (where left_observed_at > now() - interval '24 hours')::int
              as departed
     from clan_membership where clan_tag = $1`,
    [tag],
  );

  // War state, guarded like war_current's decks_today: only while the
  // latest anchored period is nominally still open — a clan whose polls
  // stopped must not have an ancient day reported as "today".
  let war = null;
  const { rows: anchorRows } = await db.query(
    `select period_index, first_observed_at from war_period_anchor
     where clan_tag = $1 order by first_observed_at desc limit 1`,
    [tag],
  );
  if (anchorRows[0]) {
    // One derivation, shared with war_current. This used to rebuild the
    // nominal end from the primitives itself and carried the "next 10:00Z
    // after the anchor" bug independently (feedback #9), silently dropping
    // the war block on a live war day whenever the reset ran early.
    const period = anchoredPeriod(
      anchorRows[0].period_index,
      anchorRows[0].first_observed_at.getTime(),
    );
    const info = period.info;
    if (period.openNow) {
      war = {
        kind: info.kind,
        ...(info.warDay ? { war_day: info.warDay } : {}),
      };
      if (info.warDay) {
        const { rows: wkRows } = await db.query(
          `select season_id, section_index from war_week
           where clan_tag = $1 order by season_id desc, section_index desc limit 1`,
          [tag],
        );
        if (wkRows[0]) {
          const { rows: decks } = await db.query(
            `with base as (
               select wp.player_tag from war_participation wp
               where wp.clan_tag = $1 and wp.season_id = $2 and wp.section_index = $3
                 and exists (select 1 from clan_membership cm
                             where cm.clan_tag = wp.clan_tag
                               and cm.player_tag = wp.player_tag
                               and cm.left_observed_at is null)),
             att as (
               select player_tag, decks_used_today from war_attendance_day
               where clan_tag = $1 and season_id = $2 and section_index = $3
                 and war_day = $4),
             fought as (
               select bp.player_tag, count(distinct b.battle_id)::int as n
               from battle b join battle_participant bp on bp.battle_id = b.battle_id
               where bp.clan_tag = $1 and b.season_id = $2 and b.section_index = $3
                 and b.war_day = $4
               group by bp.player_tag),
             merged as (
               select base.player_tag,
                      least(greatest(coalesce(att.decks_used_today, 0),
                                     coalesce(fought.n, 0)), 4) as d
               from base
               left join att on att.player_tag = base.player_tag
               left join fought on fought.player_tag = base.player_tag)
             select count(*) filter (where d = 0)::int as untouched,
                    count(*) filter (where d between 1 and 3)::int as partial,
                    count(*) filter (where d = 4)::int as finished,
                    count(*)::int as participants
             from merged`,
            [tag, wkRows[0].season_id, wkRows[0].section_index, info.warDay],
          );
          if (decks[0].participants > 0) war.decks_today = decks[0];
        }
      }
    }
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    battles_24h: act[0].battles,
    members_active_24h: act[0].active,
    members_total: roster[0].members,
    top_24h: top,
    quiet,
    never_recorded: neverRec[0].n,
    never_recorded_members: neverRec[0].members,
    ...(war ? { war } : {}),
    roster_changes_24h: {
      joined: changes[0].joined,
      left: changes[0].departed,
    },
    note: "Recorded facts only: 'quiet' means no RECORDED battles in that many days. Compare days_quiet with days_since_poll on the same row before calling anyone inactive - if we have not polled them recently, the silence is ours. recorded_since is how far back our record of that member goes; never_recorded_members have no recorded history at all. Drill with war_current, clans_roster, and battles_query.",
  };
}

/** Weekly operational-row sweep ({sweep_operational: true}, rides the
 *  same EventBridge rule as the payload sweep): docs/archive/DB-AUDIT-2026-09-04.md R3 — every
 *  check is already expiry-aware, these rows are pure dead weight.
 *  oauth_token keeps 90 days (not 30): rotated-token rows are the
 *  memory behind family replay detection, and 90d is the absolute
 *  family lifetime — never trim below it. */
export async function sweepOperational(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const out = {};
    out.integration_refreshes = (
      await db.query(
        "delete from integration_profile_refresh where created_at < now() - interval '1 day'",
      )
    ).rowCount;
    out.integration_usage = (
      await db.query(
        "delete from integration_usage where day < current_date - 90",
      )
    ).rowCount;
    out.rate_limit = (
      await db.query(
        `delete from rate_limit where window_start < now() - interval '7 days'`,
      )
    ).rowCount;
    // Refusals answer "is something still presenting this?", which is a
    // question about now, not about March.
    out.credential_refusal = (
      await db.query(
        `delete from credential_refusal where day < current_date - 30`,
      )
    ).rowCount;
    // The call history stays; the ADDRESS in it does not. Usage is the
    // account's own record, an IP is a person's location, and only one of
    // those has to be kept to answer "what has this credential done".
    out.viewer_ip_scrubbed = (
      await db.query(
        `update mcp_call_audit set viewer_ip = null
          where viewer_ip is not null and created_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.magic_login = (
      await db.query(
        `delete from magic_login where expires_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.session = (
      await db.query(
        `delete from session
         where sliding_expires_at < now() - interval '30 days'
            or (revoked_at is not null and revoked_at < now() - interval '30 days')`,
      )
    ).rowCount;
    out.oauth_token = (
      await db.query(
        `delete from oauth_token where expires_at < now() - interval '90 days'`,
      )
    ).rowCount;
    out.job_done = (
      await db.query(
        `delete from job where status = 'done' and done_at < now() - interval '7 days'`,
      )
    ).rowCount;
    out.job_dead = (
      await db.query(
        `delete from job where status = 'dead' and done_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.event_feed = (
      await db.query(
        `delete from event_feed where created_at < now() - interval '30 days'`,
      )
    ).rowCount;
    // An unclaimed collector bearer is a live credential sitting in
    // plaintext. Past its window it is unclaimable already (#31); this
    // stops it being READABLE too.
    out.provision_env_expired = (
      await db.query(
        `update gateway set provision_env = null, provision_expires_at = null
         where provision_env is not null and provision_expires_at <= now()`,
      )
    ).rowCount;
    out.audit_args_nulled = (
      await db.query(
        `update mcp_call_audit set args = null
         where created_at < now() - interval '90 days' and args is not null`,
      )
    ).rowCount;
    // The captured bodies follow the same 90-day rule as the arguments.
    // The objects themselves expire under the archive bucket's calls/
    // lifecycle rule (infra/template.yaml); this flips the pointer so the
    // console stops offering a body the bucket no longer has.
    out.audit_capture_expired = (
      await db.query(
        `update mcp_call_audit set captured = false
         where captured and created_at < now() - interval '90 days'`,
      )
    ).rowCount;
    return out;
  } finally {
    await db.end();
  }
}

export async function handler(event) {
  if (event?.clan_pulse) {
    const result = await clanPulse(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.sweep_payloads) {
    const result = await sweepPayloads(process.env.DATABASE_URL);
    if (event?.sweep_operational) {
      result.operational = await sweepOperational(process.env.DATABASE_URL);
    }
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.sweep_operational) {
    const result = await sweepOperational(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  throw new Error("jobs: no recognized op in event");
}
