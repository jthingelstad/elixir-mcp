/** The migrate Lambda — the ONLY thing that applies schema migrations in
 *  the cloud (DESIGN §11.1). Invoked by the deploy script between code
 *  upload and flip. The build packages db/migrations alongside the bundle. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { migrate } from "./migrate.mjs";

/**
 * One-time production seeding, run by explicit invoke payload only
 * ({seed: {owner_email_hash, gateway: {name, static_ip}}}): the owner
 * account (approved, is_owner) and the first gateway row. Idempotent.
 * Everything else (claims, recording opt-in) goes through the real
 * product flow on the site.
 */
async function seed(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const {
      rows: [account],
    } = await db.query(
      `insert into account (email_hash, status, is_owner, decided_at)
       values ($1, 'approved', true, now())
       on conflict (email_hash) do update set status = 'approved', is_owner = true
       returning account_id`,
      [spec.owner_email_hash],
    );
    let gatewayId = null;
    if (spec.gateway) {
      const { rows } = await db.query(
        `insert into gateway (owner_account_id, name, static_ip, status)
         select $1, $2, $3, 'active'
         where not exists (select 1 from gateway where name = $2)
         returning gateway_id`,
        [account.account_id, spec.gateway.name, spec.gateway.static_ip],
      );
      gatewayId =
        rows[0]?.gateway_id ??
        (
          await db.query(`select gateway_id from gateway where name = $1`, [
            spec.gateway.name,
          ])
        ).rows[0].gateway_id;
      // Re-seeding transfers ownership: the seeded account owns the gateway.
      await db.query(
        `update gateway set owner_account_id = $1 where gateway_id = $2`,
        [account.account_id, gatewayId],
      );
    }
    let clanRecording = null;
    if (spec.record_clan) {
      await db.query(
        `insert into clan (clan_tag) values ($1) on conflict do nothing`,
        [spec.record_clan],
      );
      await db.query(
        `insert into recording (subject_type, subject_tag, requested_by, clan_scope)
         select 'clan', $1, $2, 'comprehensive'
         where not exists (select 1 from recording
                           where subject_type = 'clan' and subject_tag = $1 and status = 'active')`,
        [spec.record_clan, account.account_id],
      );
      clanRecording = spec.record_clan;
    }
    let purged = 0;
    if (spec.purge_email_hash) {
      // Hard delete of a mis-seeded account and everything it touches
      // (explicit, one-off; dependents first, FK order).
      const { rows: victims } = await db.query(
        `select account_id from account where email_hash = $1 and account_id <> $2`,
        [spec.purge_email_hash, account.account_id],
      );
      for (const v of victims) {
        await db.query(`delete from session where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from mcp_call_audit where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from recording where requested_by = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from claim where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(
          `delete from oauth_token t using oauth_family f
                        where t.family_id = f.family_id and f.account_id = $1`,
          [v.account_id],
        );
        await db.query(`delete from oauth_code where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from oauth_family where account_id = $1`, [
          v.account_id,
        ]);
        await db.query(`delete from account where account_id = $1`, [
          v.account_id,
        ]);
        purged += 1;
      }
    }
    return {
      seeded: true,
      accountId: account.account_id,
      gatewayId,
      clanRecording,
      purged,
    };
  } finally {
    await db.end();
  }
}

/** Read-only ops stats ({stats: true}) — the admin/ops query path from
 *  DESIGN §7: counts only, no row data, safe to invoke any time. */
async function stats(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const counts = {};
    for (const [key, sql] of Object.entries({
      accounts: `select count(*)::int n from account`,
      recordings: `select count(*)::int n from recording where status = 'active'`,
      players: `select count(*)::int n from player`,
      open_memberships: `select count(*)::int n from clan_membership where left_observed_at is null`,
      battles: `select count(*)::int n from battle`,
      snapshots: `select count(*)::int n from player_snapshot_daily`,
      war_weeks: `select count(*)::int n from war_week`,
      war_participation: `select count(*)::int n from war_participation`,
      war_anchors: `select count(*)::int n from war_period_anchor`,
      receipts_by_endpoint: `select json_object_agg(endpoint, n) n from (
         select endpoint, count(*)::int n from api_receipt group by endpoint) x`,
      audit_calls: `select count(*)::int n from mcp_call_audit`,
    })) {
      counts[key] = (await db.query(sql)).rows[0].n;
    }
    return counts;
  } finally {
    await db.end();
  }
}

/** Read-only yield census ({probe: true}) — hourly fetch volume vs
 *  battles actually harvested, live gateways only (the backfill gateway
 *  is history, not capture). Counts only, no row data; this is how the
 *  monitoring loop measures fetch efficiency across scheduler modes. */
async function probe(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `with fetches as (
         select date_trunc('hour', r.fetched_at) as h,
                count(*) filter (where r.endpoint = 'player_battlelog')::int as battlelog,
                count(distinct r.entity_key)
                  filter (where r.endpoint = 'player_battlelog')::int as battlelog_subjects,
                count(*) filter (where r.endpoint = 'player')::int as player,
                count(*) filter (where r.endpoint in
                  ('currentriverrace', 'riverracelog', 'clan'))::int as clan_war,
                count(*)::int as fetches
         from api_receipt r
         join gateway g on g.gateway_id = r.gateway_id
         where r.fetched_at > now() - interval '48 hours'
           and g.name <> 'backfill-elixir-bot'
         group by 1),
       harvests as (
         select date_trunc('hour', created_at) as h,
                count(*)::int as battles
         from battle
         where created_at > now() - interval '48 hours'
         group by 1)
       select to_char(h at time zone 'UTC', 'MM-DD"T"HH24"Z"') as hour,
              coalesce(f.battlelog, 0) as battlelog,
              coalesce(f.battlelog_subjects, 0) as battlelog_subjects,
              coalesce(f.player, 0) as player,
              coalesce(f.clan_war, 0) as clan_war,
              coalesce(f.fetches, 0) as fetches,
              coalesce(v.battles, 0) as battles
       from fetches f
       full join harvests v using (h)
       order by h`,
    );
    // War-stamp census: unstamped war battles can silently starve every
    // reader that joins on war keys (attendance union, week focus).
    const { rows: stamps } = await db.query(
      `select coalesce(b.season_id::text, 'UNSTAMPED') as season,
              b.section_index, b.war_day, count(*)::int as battles
       from battle b
       where (b.type like 'riverRace%' or b.type = 'boatBattle')
         and b.battle_time > now() - interval '7 days'
       group by 1, 2, 3 order by 1, 2, 3`,
    );
    // Level-economics data support (META-INTEL follow-on): how much of
    // the corpus carries BOTH sides' per-card levels, and what the
    // level-gap distribution looks like. Decks store slim cards with
    // display-scale levels; duels (rounds) and deckless rows excluded.
    const { rows: levels } = await db.query(
      `with sides as (
         select bp.battle_id,
                avg((c.value->>'level')::numeric)
                  filter (where bp.side = 0) as lvl0,
                avg((c.value->>'level')::numeric)
                  filter (where bp.side = 1) as lvl1
         from battle_participant bp
         cross join lateral jsonb_array_elements(bp.deck->'cards') c
         where bp.deck ? 'cards'
         group by bp.battle_id)
       select count(*)::int as battles_with_both_side_levels,
              (select count(*)::int from battle) as battles_total,
              round(avg(abs(lvl0 - lvl1))::numeric, 2) as mean_abs_level_gap,
              round(percentile_cont(0.5) within group (order by abs(lvl0 - lvl1))::numeric, 2) as median_abs_level_gap,
              round(percentile_cont(0.9) within group (order by abs(lvl0 - lvl1))::numeric, 2) as p90_abs_level_gap
       from sides where lvl0 is not null and lvl1 is not null`,
    );
    // War-rivals data support: how many DISTINCT rival clans the corpus
    // already fingerprints, at what depth (races observed per rival),
    // deduped across observers (two of our clans sharing a bracket see
    // the same race twice).
    const { rows: rivals } = await db.query(
      `with races as (
         select distinct season_id, section_index, participant_clan_tag, fame
         from war_week_clan
         where participant_clan_tag not in
           (select subject_tag from recording where subject_type = 'clan'))
       select count(distinct participant_clan_tag)::int as rival_clans_observed,
              count(*)::int as rival_race_rows,
              (select count(*)::int from (
                 select participant_clan_tag from races
                 group by participant_clan_tag having count(*) >= 3) x)
                as rivals_with_3plus_races
       from races`,
    );
    // Push-lane pulse (shipped 2026-09-05): rows by topic, and how
    // much sits unread past each account's cursor.
    const { rows: feed } = await db.query(
      `select topic, count(*)::int as rows,
              min(ef.created_at) as first, max(ef.created_at) as last,
              count(*) filter (where ef.event_id > a.events_seen_through)::int as unread
       from event_feed ef join account a on a.account_id = ef.account_id
       group by topic order by topic`,
    );
    // Pros-collection capture ramp: recording coverage and 24h battle
    // flow for every member of the 'pros' collection.
    const { rows: pros } = await db.query(
      `select count(*)::int as members,
              count(*) filter (where r.subject_tag is not null)::int as recording,
              count(*) filter (where b24.n > 0)::int as active_24h,
              coalesce(sum(b24.n), 0)::int as battles_24h
       from collection c
       join collection_member m on m.collection_id = c.collection_id
       left join recording r on r.subject_type = 'player'
         and r.subject_tag = m.subject_tag and r.status = 'active'
       left join lateral (
         select count(*)::int as n from battle_participant bp
         join battle b on b.battle_id = bp.battle_id
         where bp.player_tag = m.subject_tag
           and b.battle_time > now() - interval '24 hours') b24 on true
       where c.slug = 'pros'`,
    );
    return {
      hours: rows,
      war_stamps_7d: stamps,
      level_census: levels[0],
      rival_census: rivals[0],
      feed_census: feed,
      pros_census: pros[0],
    };
  } finally {
    await db.end();
  }
}

/** Pending feedback ({feedback_pending: true}): every status='new' item
 *  across all accounts - the loop's standing check (Jamie, 2026-09-05:
 *  "make checking for new feedback part of your regular check"). */
async function feedbackPending(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select f.feedback_id, f.surface, f.category, f.message, f.created_at,
              (select c.player_tag from claim c
               where c.account_id = f.account_id and c.is_primary) as from_player
       from feedback f where f.status = 'new'
       order by f.feedback_id`,
    );
    return { pending: rows.length, items: rows };
  } finally {
    await db.end();
  }
}

/** Collection curation ({collection: {op, slug, ...}}), owner ops path
 *  (v1: creation is owner-only - Jamie, 2026-09-05). ops:
 *  upsert {slug,title,kind,description?,visibility?} | add {slug,tags[]}
 *  | remove {slug,tags[]}. */
/** Role ops ({account_role: {...}}): the ops-lane view and lever for
 *  the entitlement ladder. {list: true} reports every account's role
 *  and slot usage; {account_id | service, role} sets a role (the same
 *  act as Admin > Accounts, for the operator console). */
/** Yield A/B ({ab_yield: {a_start, b_start, hours?}}): same-clock-hours
 *  comparison of two capture windows (heat model vs yield scheduler).
 *  Each battle is attributed to its FIRST LIVE observation (earliest
 *  battle_observation receipt from a non-backfill gateway), so archive
 *  replays never contaminate either side. Read-only. */
/** Gateway provisioning ({gateway_provision: {name, iam_user_name,
 *  env}}): stores the owner-minted one-time config for the operator's
 *  web download (0034). The env content passes through as an opaque
 *  string - this op never logs it. */
async function gatewayProvision(databaseUrl, spec) {
  if (!spec?.name || !spec?.env) {
    throw new Error("gateway_provision needs name and env");
  }
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: found } = await db.query(
      `select gateway_id from gateway where name = $1 and status <> 'revoked'`,
      [String(spec.name)],
    );
    if (!found[0]) throw new Error(`no live gateway named ${spec.name}`);
    const env = String(spec.env).replaceAll(
      "__GATEWAY_ID__",
      found[0].gateway_id,
    );
    const { rows } = await db.query(
      `update gateway
       set provision_env = $2, iam_user_name = $3, provision_claimed_at = null
       where gateway_id = $1
       returning gateway_id, name`,
      [found[0].gateway_id, env, spec.iam_user_name ?? null],
    );
    return { gateway_id: rows[0].gateway_id, name: rows[0].name, staged: true };
  } finally {
    await db.end();
  }
}

async function abYield(databaseUrl, spec) {
  const hours = Math.min(Math.max(Number(spec?.hours ?? 24), 1), 72);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const windowStats = async (startIso) => {
      const { rows } = await db.query(
        `with live as (
           select r.receipt_id, r.endpoint, r.entity_key, r.fetched_at
           from api_receipt r
           join gateway g on g.gateway_id = r.gateway_id
           where g.name <> 'backfill-elixir-bot'
             and r.fetched_at >= $1::timestamptz
             and r.fetched_at < $1::timestamptz + make_interval(hours => $2)),
         first_obs as (
           select bo.battle_id, min(bo.receipt_id) as receipt_id
           from battle_observation bo group by bo.battle_id)
         select
           (select count(*)::int from live) as fetches,
           (select count(*)::int from live where endpoint = 'player_battlelog') as battlelog_fetches,
           (select count(distinct entity_key)::int from live
            where endpoint = 'player_battlelog') as battlelog_subjects,
           (select count(*)::int from live
            where endpoint in ('currentriverrace', 'riverracelog')) as war_fetches,
           (select count(*)::int from first_obs fo
            join live l on l.receipt_id = fo.receipt_id
            where l.endpoint = 'player_battlelog') as battles_captured`,
        [startIso, hours],
      );
      return rows[0];
    };
    const a = await windowStats(spec.a_start);
    const b = await windowStats(spec.b_start);
    const per = (w) =>
      w.battlelog_fetches > 0
        ? Math.round((w.battles_captured / w.battlelog_fetches) * 1000) / 1000
        : null;
    return {
      hours,
      a: { start: spec.a_start, ...a, battles_per_battlelog_fetch: per(a) },
      b: { start: spec.b_start, ...b, battles_per_battlelog_fetch: per(b) },
      deltas: {
        fetch_spend_ratio:
          a.fetches > 0
            ? Math.round((b.fetches / a.fetches) * 1000) / 1000
            : null,
        battles_ratio:
          a.battles_captured > 0
            ? Math.round((b.battles_captured / a.battles_captured) * 1000) /
              1000
            : null,
        yield_per_fetch_ratio:
          per(a) > 0 ? Math.round((per(b) / per(a)) * 1000) / 1000 : null,
      },
    };
  } finally {
    await db.end();
  }
}

async function accountRoleOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    if (spec?.list) {
      const { rows: gateways } = await db.query(
        `select name, status, static_ip, enrolled_at,
                (provision_env is not null) as provision_staged,
                provision_claimed_at is not null as provision_claimed
         from gateway order by enrolled_at`,
      );
      const { rows } = await db.query(
        `select a.account_id, left(a.email_hash, 10) as email_hash, a.status,
                a.role, a.is_owner,
                (select string_agg(t.name, ',') from service_token t
                 where t.account_id = a.account_id and t.revoked_at is null) as services,
                (select count(*)::int from recording r
                 where r.requested_by = a.account_id and r.subject_type = 'player'
                   and r.status = 'active') as players_recording
         from account a order by a.created_at`,
      );
      return { accounts: rows, gateways };
    }
    const { isRole } = await import("@elixir-mcp/contracts");
    if (!isRole(spec?.role)) throw new Error(`unknown role ${spec?.role}`);
    let accountId = spec.account_id ?? null;
    if (!accountId && spec.service) {
      const { rows } = await db.query(
        `select account_id from service_token
         where name = $1 and revoked_at is null`,
        [String(spec.service)],
      );
      if (!rows[0])
        throw new Error(`no live service token named ${spec.service}`);
      accountId = rows[0].account_id;
    }
    if (!accountId) throw new Error("account_role needs account_id or service");
    const { rows } = await db.query(
      `update account set role = $2 where account_id = $1
       returning account_id, role`,
      [accountId, spec.role],
    );
    if (!rows[0]) throw new Error("no such account");
    await db.query(
      `insert into account_event (account_id, kind, detail) values ($1, 'role_changed', $2)`,
      [rows[0].account_id, JSON.stringify({ role: spec.role, via: "ops" })],
    );
    const { emitFeedEvent } = await import("../../mcp/src/feed.mjs");
    await emitFeedEvent(db, rows[0].account_id, "role_changed", null, {
      role: spec.role,
    });
    return { account_id: rows[0].account_id, role: rows[0].role };
  } finally {
    await db.end();
  }
}

async function collectionOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const slug = String(spec?.slug ?? "").toLowerCase();
    if (spec.op === "upsert") {
      const { rows } = await db.query(
        `insert into collection (slug, title, kind, description, visibility, owner_account)
         values ($1, $2, $3, $4, coalesce($5, 'public'),
                 (select account_id from account where is_owner limit 1))
         on conflict (slug) do update set
           title = excluded.title,
           description = coalesce(excluded.description, collection.description),
           visibility = coalesce($5, collection.visibility)
         returning collection_id`,
        [
          slug,
          spec.title,
          spec.kind,
          spec.description ?? null,
          spec.visibility ?? null,
        ],
      );
      return { collection_id: rows[0].collection_id, slug };
    }
    if (spec.op === "add" || spec.op === "remove") {
      const { rows: col } = await db.query(
        `select collection_id from collection where slug = $1`,
        [slug],
      );
      if (!col[0]) throw new Error(`no collection ${slug}`);
      const { normalizeTag } = await import("@elixir-mcp/contracts");
      const tags = (spec.tags ?? []).map((t) => normalizeTag(String(t)));
      let n = 0;
      for (const tag of tags) {
        if (spec.op === "add") {
          const r = await db.query(
            `insert into collection_member (collection_id, subject_tag)
             values ($1, $2) on conflict do nothing`,
            [col[0].collection_id, tag],
          );
          n += r.rowCount;
        } else {
          const r = await db.query(
            `delete from collection_member where collection_id = $1 and subject_tag = $2`,
            [col[0].collection_id, tag],
          );
          n += r.rowCount;
        }
      }
      return { slug, [spec.op === "add" ? "added" : "removed"]: n };
    }
    throw new Error(`unknown collection op ${spec?.op}`);
  } finally {
    await db.end();
  }
}

/** Maintainer feedback response ({feedback_respond: {feedback_id,
 *  status, response}}): the ops-side path to close a feedback item so
 *  the requester sees status + reply (0026). The admin web panel is the
 *  interactive equivalent. */
async function feedbackRespond(databaseUrl, spec) {
  const status = ["seen", "planned", "done", "declined"].includes(spec?.status)
    ? spec.status
    : null;
  if (!status || !spec?.feedback_id)
    throw new Error("feedback_respond needs feedback_id and a valid status");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: updated } = await db.query(
      `update feedback set status = $2,
              response = coalesce($3, response),
              responded_at = case when $3 is not null then now() else responded_at end,
              shipped_in = coalesce($4, shipped_in),
              related_tools = coalesce($5, related_tools)
       where feedback_id = $1
       returning account_id`,
      [
        spec.feedback_id,
        status,
        spec.response ? String(spec.response).slice(0, 4000) : null,
        spec.shipped_in ?? null,
        spec.related_tools ?? null,
      ],
    );
    if (updated[0] && spec.response) {
      const { emitFeedEvent } = await import("../../mcp/src/feed.mjs");
      await emitFeedEvent(
        db,
        updated[0].account_id,
        "feedback_responded",
        null,
        {
          feedback_id: Number(spec.feedback_id),
          status,
        },
      );
    }
    return { updated: updated.length };
  } finally {
    await db.end();
  }
}

/** MCP request effectiveness census ({audit_census: {days?}}): the
 *  product-signal read of mcp_call_audit (Jamie, 2026-09-05) - per-tool
 *  volume, errors, truncation, latency, and reach across surfaces, plus
 *  declared tools nobody has called. Read-only, counts only. */
async function auditCensus(databaseUrl, spec) {
  const days = Math.min(Math.max(Number(spec?.days ?? 7), 1), 90);
  const { TOOL_GROUPS } = await import("@elixir-mcp/contracts");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows: perTool } = await db.query(
      `select tool,
              count(*)::int as calls,
              count(distinct account_id)::int as accounts,
              count(*) filter (where error_code is not null)::int as errors,
              round(avg(duration_ms))::int as avg_ms,
              max(duration_ms)::int as max_ms,
              round(avg(result_bytes))::int as avg_bytes,
              count(*) filter (where truncated)::int as truncated,
              max(created_at) as last_called
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
       group by tool order by calls desc`,
      [days],
    );
    const { rows: perSurface } = await db.query(
      `select surface, count(*)::int as calls,
              count(*) filter (where error_code is not null)::int as errors
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
       group by surface order by calls desc`,
      [days],
    );
    const { rows: errors } = await db.query(
      `select tool, error_code, count(*)::int as n
       from mcp_call_audit
       where created_at > now() - make_interval(days => $1)
         and error_code is not null
       group by tool, error_code order by n desc limit 20`,
      [days],
    );
    const called = new Set(perTool.map((r) => r.tool));
    const never_called = Object.keys(TOOL_GROUPS).filter((t) => !called.has(t));
    return {
      days,
      per_tool: perTool,
      per_surface: perSurface,
      top_errors: errors,
      never_called,
    };
  } finally {
    await db.end();
  }
}

/** Prototype intelligence preview ({preview_intel: {player_tag, clan_tag}}):
 *  read-only flavor of the META-INTEL section 9/10 tools computed on live
 *  data — the level-gap curve, one player's position on it, and rival
 *  fingerprints for one clan's current bracket. Also the seed of the
 *  section 6 validation harness. */
async function previewIntel(databaseUrl, spec) {
  const tag = spec?.player_tag ?? "#20JJJ2CCRU";
  const clan = spec?.clan_tag ?? "#J2RGCRVG";
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const sides = `
      with sides as (
        select bp.battle_id, bp.player_tag, bp.outcome, b.battle_time,
               avg((c.value->>'level')::numeric) as lvl
        from battle_participant bp
        join battle b on b.battle_id = bp.battle_id
        cross join lateral jsonb_array_elements(bp.deck->'cards') c
        where bp.deck ? 'cards' and b.type_class = 'pvp'
          and bp.outcome in ('win','loss')
        group by bp.battle_id, bp.player_tag, bp.outcome, b.battle_time),
      duos as (select battle_id from sides group by battle_id having count(*) = 2),
      pairs as (
        select a.battle_id, a.player_tag, a.outcome, a.battle_time,
               round(a.lvl - o.lvl, 2) as gap
        from sides a
        join sides o on o.battle_id = a.battle_id and o.player_tag <> a.player_tag
        where a.battle_id in (select battle_id from duos))`;
    const { rows: curve } = await db.query(
      `${sides}
       select width_bucket(gap, array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]) as bin,
              min(gap) as gap_lo, max(gap) as gap_hi,
              count(*)::int as n,
              round(avg((outcome = 'win')::int)::numeric, 3) as win_rate
       from pairs group by bin order by bin`,
    );
    const tags = Array.isArray(spec?.player_tags) ? spec.player_tags : [tag];
    // Score each player against the corpus curve: expected win rate at
    // each battle's level gap -> actual minus expected = the win-rate
    // the LEVELS cannot explain (level-adjusted skill signal). The
    // player's own battles are a negligible share of the 66k-obs curve.
    const { rows: me } = await db.query(
      `${sides},
       curve as (
         select width_bucket(gap, array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5]) as bin,
                avg((outcome = 'win')::int) as wr
         from pairs group by bin)
       select p.player_tag,
              count(*)::int as n,
              round(avg(p.gap)::numeric, 2) as mean_gap,
              round(avg((p.outcome = 'win')::int)::numeric, 3) as actual_wr,
              round(avg(c.wr)::numeric, 3) as expected_wr_from_levels,
              round((avg((p.outcome = 'win')::int) - avg(c.wr))::numeric, 3) as skill_residual,
              round((1.0 / sqrt(count(*)) / 2)::numeric, 3) as residual_se_approx,
              round(avg((p.outcome = 'win')::int)
                filter (where p.gap >= 0.1)::numeric, 3) as wr_when_ahead,
              round(avg((p.outcome = 'win')::int)
                filter (where p.gap > -0.1 and p.gap < 0.1)::numeric, 3) as wr_when_even,
              count(*) filter (where p.gap >= 0.1)::int as n_ahead,
              count(*) filter (where p.gap > -0.1 and p.gap < 0.1)::int as n_even
       from pairs p
       join curve c on c.bin = width_bucket(p.gap, array[-2.5,-1.5,-1.0,-0.6,-0.3,-0.1,0.1,0.3,0.6,1.0,1.5,2.5])
       where p.player_tag = any($1)
         and p.battle_time > now() - interval '60 days'
       group by p.player_tag`,
      [tags],
    );
    const { rows: rivals } = await db.query(
      `with bracket as (
         select participant_clan_tag, participant_name
         from war_week_clan
         where clan_tag = $1 and participant_clan_tag <> $1
           and (season_id, section_index) = (
             select season_id, section_index from war_week
             where clan_tag = $1
             order by season_id desc, section_index desc limit 1)),
       races as (
         select distinct w.season_id, w.section_index, w.participant_clan_tag,
                max(w.fame) as fame
         from war_week_clan w
         join bracket bk on bk.participant_clan_tag = w.participant_clan_tag
         group by w.season_id, w.section_index, w.participant_clan_tag)
       select b.participant_clan_tag as clan_tag, b.participant_name as name,
              count(r.fame)::int as races_observed,
              round(avg(r.fame) filter (where (r.season_id, r.section_index) <> (
                select season_id, section_index from war_week where clan_tag = $1
                order by season_id desc, section_index desc limit 1))::numeric)::int
                as mean_fame_finished,
              max(r.fame)::int as max_fame,
              min(r.season_id)::int as first_season,
              max(r.season_id)::int as last_season
       from bracket b left join races r on r.participant_clan_tag = b.participant_clan_tag
       group by 1, 2 order by races_observed desc`,
      [clan],
    );
    return { curve, players: me, rivals };
  } finally {
    await db.end();
  }
}

/** One-time payload-history export ({export_payloads: {after_id?, limit?}}):
 *  copy api_payload rows into the S3 archive under the ingest key scheme,
 *  keyed by payload_id cursor so a local loop can drive it to completion.
 *  Bytes are the jsonb re-serialized + gzipped — the content hash (of
 *  canonical JSON) is unchanged, which is what content-addressing keys on. */
export async function exportPayloads(databaseUrl, spec, s3override) {
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
  const { archiveKey } = await import("../../ingest/src/pipeline.mjs");
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const { gzipSync } = await import("node:zlib");
  const s3 = s3override ?? new S3Client({});
  const afterId = Number(spec?.after_id ?? 0);
  const limit = Math.min(Number(spec?.limit ?? 500), 2000);
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select payload_id, endpoint, entity_key, payload_hash, payload_json,
              first_fetched_at
       from api_payload where payload_id > $1
       order by payload_id limit $2`,
      [afterId, limit],
    );
    let exported = 0;
    for (const r of rows) {
      const key = archiveKey(
        r.endpoint,
        r.entity_key,
        r.first_fetched_at.toISOString(),
        r.payload_hash,
      );
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: gzipSync(Buffer.from(JSON.stringify(r.payload_json))),
          ContentType: "application/json",
          ContentEncoding: "gzip",
        }),
      );
      exported += 1;
    }
    return {
      exported,
      last_id: rows.length ? rows[rows.length - 1].payload_id : afterId,
      done: rows.length < limit,
    };
  } finally {
    await db.end();
  }
}

/**
 * Ordered backfill replay ({replay: {messages: [...]}}) — the elixir-bot
 * archive lane (NOTES 2026-09-04). Each message is a CrResultMessage
 * (real API payload, gzipped by the orchestrator) processed STRICTLY in
 * order through the same processResult the results queue uses — SQS
 * cannot guarantee chronology and stage-2 projections need it. The
 * gateway row 'backfill-elixir-bot' is the provenance: every receipt is
 * attributed and one-click revocable like any gateway.
 */
async function replay(databaseUrl, spec) {
  const { processResult } = await import("../../ingest/src/pipeline.mjs");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    // gateway.name has no unique constraint: check-then-insert.
    let gw = (
      await db.query(
        `select gateway_id from gateway where name = 'backfill-elixir-bot' limit 1`,
      )
    ).rows[0];
    if (!gw) {
      gw = (
        await db.query(
          `insert into gateway (owner_account_id, name, static_ip, cr_key_ref, status)
           select account_id, 'backfill-elixir-bot', '127.0.0.1', 'none: archive replay, no CR key', 'active'
           from account where is_owner limit 1
           returning gateway_id`,
        )
      ).rows[0];
    }
    const gatewayId = gw.gateway_id;
    const tally = {};
    const perf = {}; // endpoint -> {count, phase sums}
    for (const msg of spec.messages ?? []) {
      const out = await processResult(db, { ...msg, gateway_id: gatewayId });
      tally[out.outcome] = (tally[out.outcome] ?? 0) + 1;
      if (out.timings) {
        const ep = (perf[msg.job.endpoint] ??= { count: 0 });
        ep.count += 1;
        for (const [k, v] of Object.entries(out.timings))
          ep[k] = (ep[k] ?? 0) + v;
      }
    }
    return {
      gateway_id: gatewayId,
      processed: (spec.messages ?? []).length,
      tally,
      perf,
    };
  } finally {
    await db.end();
  }
}

/** Read-only storage census for the DB audit ({inspect: true}). */
async function inspect(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const tables = (
      await db.query(
        `select relname,
                pg_size_pretty(pg_total_relation_size(relid)) as total,
                pg_total_relation_size(relid) as bytes,
                n_live_tup, n_dead_tup, seq_scan, idx_scan,
                autovacuum_count, autoanalyze_count
         from pg_stat_user_tables
         order by pg_total_relation_size(relid) desc`,
      )
    ).rows;
    const indexes = (
      await db.query(
        `select relname as table, indexrelname as index,
                pg_size_pretty(pg_relation_size(indexrelid)) as size,
                idx_scan
         from pg_stat_user_indexes
         order by pg_relation_size(indexrelid) desc limit 25`,
      )
    ).rows;
    const dbsize = (
      await db.query(
        `select pg_size_pretty(pg_database_size(current_database())) s`,
      )
    ).rows[0].s;
    return { database_size: dbsize, tables, indexes };
  } finally {
    await db.end();
  }
}

export async function handler(event) {
  if (event?.inspect) {
    const result = await inspect(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.replay) {
    const result = await replay(process.env.DATABASE_URL, event.replay);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.stats) {
    const result = await stats(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.probe) {
    const result = await probe(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.feedback_pending) {
    const result = await feedbackPending(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.gateway_provision) {
    const result = await gatewayProvision(
      process.env.DATABASE_URL,
      event.gateway_provision,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.ab_yield) {
    const result = await abYield(process.env.DATABASE_URL, event.ab_yield);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.account_role) {
    const result = await accountRoleOp(
      process.env.DATABASE_URL,
      event.account_role,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.collection) {
    const result = await collectionOp(
      process.env.DATABASE_URL,
      event.collection,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.feedback_respond) {
    const result = await feedbackRespond(
      process.env.DATABASE_URL,
      event.feedback_respond,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.audit_census) {
    const result = await auditCensus(
      process.env.DATABASE_URL,
      event.audit_census,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.preview_intel) {
    const result = await previewIntel(
      process.env.DATABASE_URL,
      event.preview_intel,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.export_payloads) {
    const result = await exportPayloads(
      process.env.DATABASE_URL,
      event.export_payloads,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.seed) {
    const result = await seed(process.env.DATABASE_URL, event.seed);
    console.log(JSON.stringify(result));
    return result;
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const result = await migrate({
    databaseUrl: process.env.DATABASE_URL,
    migrationsDir: path.join(here, "migrations"),
    log: (m) => console.log(m),
  });
  console.log(JSON.stringify(result));
  return result;
}
