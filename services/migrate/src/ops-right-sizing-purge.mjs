/** Approved-manifest-only bounded maintenance. No arbitrary SQL or scope. */
import pg from "pg";
import { createHash } from "node:crypto";
import {
  S3Client,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { RECORDING_CUTOVER_LOCK } from "@elixir-mcp/ledger";
import { canonicalBattleIdentity } from "@elixir-mcp/ingest/battles";
import { normalizeTag } from "@elixir-mcp/contracts";
import { gunzipSync } from "node:zlib";
import { payloadHash } from "@elixir-mcp/ingest/hash";
import { refreshDailyRollups } from "@elixir-mcp/ingest/rollups";
import { rightSizingCensus } from "./ops-right-sizing.mjs";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const TABLES = Object.freeze({
  battlelog_high_water: ["observer_tag"],
  card_meta_season: ["season_month", "mode_group", "card_id", "form"],
  card_meta_season_band: [
    "season_month",
    "mode_group",
    "trophy_band",
    "card_id",
    "form",
  ],
  clan_event: ["event_id"],
  clan_membership: ["clan_tag", "player_tag", "joined_observed_at"],
  clan_ranking_entry: ["snapshot_id", "rank"],
  clan_snapshot_daily: ["clan_tag", "day", "snapshot_kind"],
  collection: ["collection_id"],
  collection_member: ["collection_id", "subject_tag"],
  deck_meta_season: ["season_month", "mode_group", "deck_hash"],
  deck_meta_season_band: [
    "season_month",
    "mode_group",
    "trophy_band",
    "deck_hash",
  ],
  email_featured_card: ["period_key"],
  integration_collection_grant: ["account_id", "collection_id"],
  meta_season_band_totals: ["season_month", "mode_group", "trophy_band"],
  meta_season_pop: ["season_month", "game_day", "battle_id", "player_tag"],
  meta_season_pop_day: ["season_month", "game_day"],
  meta_season_state: ["season_month"],
  meta_season_totals: ["season_month", "mode_group"],
  player_activity: ["player_tag"],
  player_badge: ["player_tag", "name"],
  player_card: ["player_tag", "card_id"],
  player_event: ["event_id"],
  player_pol_season: ["player_tag", "season_month"],
  player_progress_daily: ["player_tag", "progress_key", "day", "snapshot_kind"],
  player_snapshot_daily: ["player_tag", "snapshot_date", "snapshot_kind"],
  ranking_board: ["board", "location_key"],
  ranking_entry: ["snapshot_id", "rank"],
  ranking_presence: ["player_tag", "board", "location_key", "season_month"],
  ranking_snapshot: ["snapshot_id"],
  war_attendance_day: [
    "clan_tag",
    "season_id",
    "section_index",
    "day_in_section",
    "player_tag",
  ],
  war_participation: ["clan_tag", "season_id", "section_index", "player_tag"],
  war_period_anchor: ["clan_tag", "period_index"],
  war_period_log: [
    "clan_tag",
    "season_id",
    "section_index",
    "period_index",
    "participant_clan_tag",
  ],
  war_week: ["clan_tag", "season_id", "section_index"],
  war_week_clan: [
    "clan_tag",
    "season_id",
    "section_index",
    "participant_clan_tag",
  ],
});

const OWNERS = Object.freeze({
  player_event: ["player_tag"],
  clan_event: ["clan_tag", "player_tag"],
});
const PERSONAL_TABLES = new Set([
  "player_event",
  "clan_event",
  "clan_membership",
  "player_badge",
  "player_card",
  "player_pol_season",
  "player_progress_daily",
  "player_snapshot_daily",
  "war_attendance_day",
  "war_participation",
]);
const RETIRED_ENDPOINTS = new Set([
  "leaderboard",
  "leaderboards",
  "rankings_clans_loc",
  "rankings_clanwars",
  "rankings_players",
  "rankings_pol",
  "rankings_pol_season",
]);

const CLOCKS = Object.freeze({
  api_payload: ["first_fetched_at", "last_fetched_at"],
  battlelog_high_water: ["updated_at"],
  card_meta_season: [],
  card_meta_season_band: [],
  clan_event: ["window_end", "joined_observed_at"],
  clan_membership: ["joined_observed_at", "left_observed_at"],
  clan_ranking_entry: [],
  clan_snapshot_daily: ["day", "observed_at"],
  collection: ["created_at", "synced_at"],
  collection_member: ["added_at"],
  deck_meta_season: ["first_used", "last_used"],
  deck_meta_season_band: ["first_used", "last_used"],
  email_featured_card: ["chosen_at", "sent_at"],
  integration_collection_grant: [],
  meta_season_band_totals: [],
  meta_season_pop: [],
  meta_season_pop_day: ["built_at"],
  meta_season_state: [
    "counters_through",
    "rebuilt_at",
    "bands_rebuilt_at",
    "pop_through",
  ],
  meta_season_totals: [],
  player_activity: ["computed_at", "recorded_from"],
  player_badge: ["observed_at"],
  player_card: ["first_seen_at", "observed_at"],
  player_event: ["window_end"],
  player_pol_season: ["observed_at"],
  player_progress_daily: ["day", "observed_at"],
  player_snapshot_daily: [
    "snapshot_date",
    "created_at",
    "observed_at",
    "profile_observed_at",
    "roster_observed_at",
  ],
  ranking_board: ["created_at"],
  ranking_entry: [],
  ranking_presence: ["first_seen_at", "last_seen_at"],
  ranking_snapshot: [
    "observed_at",
    "last_confirmed_at",
    "standings_changed_at",
    "superseded_at",
  ],
  war_attendance_day: [],
  war_participation: [],
  war_period_anchor: ["first_observed_at"],
  war_period_log: ["observed_at"],
  war_week: ["started_observed_at", "finished_observed_at", "closed_at"],
  war_week_clan: ["period_points_observed_at"],
});

async function guard(db, clans) {
  const queries = {
    accounts: "select account_id,kind,status from account order by account_id",
    claims:
      "select account_id,player_tag,status,created_at::text from claim order by account_id,player_tag",
    follows:
      "select account_id,clan_tag,scope,created_at::text from account_clan order by account_id,clan_tag",
    recordings:
      "select recording_id,subject_type,subject_tag,requested_by,status,scope,origin from recording order by recording_id",
    events:
      "select event_id,account_id,kind,created_at::text,detail from account_event where kind in ('claim_added','claim_removed','clan_added','clan_removed','recording_started','recording_stopped','tracked_by_ops') order by event_id",
    members:
      "select clan_tag,player_tag,joined_observed_at::text,left_observed_at::text from clan_membership where clan_tag=any($1::text[]) order by clan_tag,player_tag,joined_observed_at",
    policies:
      "select pk,encode(sha256(convert_to(body::text,'UTF8')),'hex') as body_sha256 from clan_state where starts_with(pk,'policy#') order by pk",
    live_jobs:
      "select job_id,endpoint,entity_key,status from job where lane='live' order by job_id",
  };
  const h = createHash("sha256"),
    counts = {};
  for (const [name, sql] of Object.entries(queries)) {
    const { rows } = await db.query(sql, name === "members" ? [clans] : []);
    h.update(JSON.stringify([name, rows]));
    counts[name] = rows.length;
  }
  return { sha256: h.digest("hex"), counts };
}

async function protectedPlayers(db, clans, profile) {
  const rows = (
    await db.query(
      `select distinct tag from (
    select c.player_tag as tag from claim c join account a using(account_id) where a.kind in ('person','agent')
    union select e.detail->>'player_tag' as tag from account_event e join account a using(account_id) where a.kind in ('person','agent') and e.kind in ('claim_added','tracked_by_ops','recording_started') and e.detail ? 'player_tag'
    union select subject_tag as tag from recording where subject_type='player' and status='active' and origin='ops'
    union select m.player_tag as tag from clan_membership m where
      ($2::boolean and m.clan_tag=any($1::text[])) or
      (not $2::boolean and m.left_observed_at is null and (
        m.clan_tag=any($1::text[]) or
        exists(select 1 from account_clan f join account a using(account_id) where a.kind in ('person','agent') and f.clan_tag=m.clan_tag and f.scope='comprehensive') or
        exists(select 1 from recording r where r.subject_type='clan' and r.subject_tag=m.clan_tag and r.status='active' and r.origin='ops' and r.scope='comprehensive')
      ))
  ) p where tag is not null order by tag`,
      [clans, profile],
    )
  ).rows;
  return rows.map((r) => r.tag);
}

// Cache only verified semantic identities, never raw player bodies. Source
// checks continue to bind every newly admitted receipt, including bulk logs
// whose hot JSON cache is deliberately null.
const observerIds = new Map();
async function freshObserverIds(row, s3, bucket, cachedOnly = false) {
  if (observerIds.has(row.payload_hash))
    return observerIds.get(row.payload_hash);
  let body = row.payload_json;
  if (!Array.isArray(body)) {
    if (cachedOnly)
      throw new Error(
        "new observer arrived after source preflight; retry unchanged batch",
      );
    const prefix = `payloads/endpoint=player_battlelog/entity=${row.entity_key.replace(/^#/, "")}/`;
    let token,
      found = false;
    const seen = new Set();
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of page.Contents ?? []) {
        if (
          !item.Key?.startsWith(prefix) ||
          !item.Key.endsWith(`-${row.payload_hash.slice(0, 16)}.json.gz`)
        )
          continue;
        const r = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: item.Key }),
        );
        if (r.ContentLength > 16_000_000) {
          r.Body.destroy?.();
          throw new Error("oversize new observer source");
        }
        const bytes = Buffer.from(await r.Body.transformToByteArray());
        if (bytes.length > 16_000_000)
          throw new Error("oversize new observer source");
        body = JSON.parse(
          gunzipSync(bytes, { maxOutputLength: 128_000_000 }).toString("utf8"),
        );
        found = true;
        break;
      }
      if (found) break;
      if (page.IsTruncated === false) break;
      if (
        page.IsTruncated !== true ||
        !page.NextContinuationToken ||
        seen.has(page.NextContinuationToken)
      )
        throw new Error("new observer archive inventory incomplete");
      token = page.NextContinuationToken;
      seen.add(token);
    } while (token);
    if (!found)
      throw new Error("new observer source unavailable; refresh evidence");
  }
  if (!Array.isArray(body) || payloadHash(body) !== row.payload_hash)
    throw new Error("new observer full hash differs");
  const ids = body.map((e) => canonicalBattleIdentity(e).battle_id);
  if (observerIds.size >= 5000)
    observerIds.delete(observerIds.keys().next().value);
  observerIds.set(row.payload_hash, ids);
  return ids;
}

export async function rightSizingPurge(
  databaseUrl,
  spec = {},
  {
    bucket = process.env.ARCHIVE_BUCKET,
    s3 = new S3Client({ maxAttempts: 1 }),
  } = {},
) {
  const clans = spec.guard_clans;
  const readOnlyGuard = spec.guard === true;
  let manifest, batch;
  const read = async (key, expected, max) => {
    const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (r.ContentLength > max) {
      r.Body.destroy?.();
      throw new Error("oversize purge metadata");
    }
    const bytes = Buffer.from(await r.Body.transformToByteArray());
    if (bytes.length > max || sha(bytes) !== expected)
      throw new Error("purge metadata digest differs");
    return JSON.parse(bytes);
  };
  if (!readOnlyGuard) {
    if (
      !HASH.test(spec.manifest_sha256 ?? "") ||
      !HASH.test(spec.batch_sha256 ?? "")
    )
      throw new Error("missing exact purge manifest and batch digests");
    manifest = await read(
      `right-sizing/v1/purge/${spec.manifest_sha256}.json`,
      spec.manifest_sha256,
      8_000_000,
    );
    if (
      manifest.version !== 1 ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        manifest.cutoff ?? "",
      ) ||
      !Number.isFinite(Date.parse(manifest.cutoff)) ||
      new Date(manifest.cutoff).toISOString() !== manifest.cutoff ||
      Date.parse(manifest.cutoff) >= Date.now() ||
      !HASH.test(manifest.guard_sha256 ?? "") ||
      !HASH.test(manifest.schema_sha256 ?? "") ||
      !/^(0|[1-9][0-9]*)$/.test(manifest.receipt_high_water ?? "") ||
      !Array.isArray(manifest.batches) ||
      !manifest.batches.includes(spec.batch_sha256)
    )
      throw new Error("undeclared purge batch");
    batch = await read(
      `right-sizing/v1/purge/batches/${spec.batch_sha256}.json`,
      spec.batch_sha256,
      1_000_000,
    );
    if (
      spec.apply === true &&
      spec.approved_manifest_sha256 !== spec.manifest_sha256
    )
      throw new Error("exact manifest approval required");
    if (
      batch.version !== 1 ||
      !Array.isArray(batch.keys) ||
      batch.keys.length < 1 ||
      batch.keys.length > 250
    )
      throw new Error("invalid bounded purge batch");
    const columns =
      batch.kind === "battle"
        ? ["battle_id"]
        : batch.kind === "receipt"
          ? [
              "receipt_id",
              "endpoint",
              "entity_key",
              "payload_hash",
              "replacement_hash",
            ]
          : batch.kind === "editorial"
            ? ["issue_id", "facts_sha256", "note_sha256"]
            : batch.kind === "capture"
              ? ["audit_id", "request_id"]
              : batch.kind === "cache"
                ? ["payload_id", "endpoint", "entity_key", "payload_hash"]
                : Object.hasOwn(TABLES, batch.table)
                  ? TABLES[batch.table]
                  : undefined;
    if (
      !["battle", "receipt", "table", "editorial", "capture", "cache"].includes(
        batch.kind,
      ) ||
      !columns ||
      batch.keys.some(
        (k) =>
          Object.keys(k).sort().join() !== [...columns].sort().join() ||
          Object.values(k).some(
            (v) =>
              v !== null && typeof v !== "string" && !Number.isSafeInteger(v),
          ),
      ) ||
      new Set(batch.keys.map((k) => JSON.stringify(columns.map((c) => k[c]))))
        .size !== batch.keys.length
    )
      throw new Error("purge scope or keys are not allowed");
    const physical = {
      receipt: "receipt_id",
      cache: "payload_id",
      capture: "audit_id",
      editorial: "issue_id",
    }[batch.kind];
    if (
      physical &&
      (batch.keys.some((k) => !/^[1-9][0-9]*$/.test(String(k[physical]))) ||
        new Set(batch.keys.map((k) => String(k[physical]))).size !==
          batch.keys.length)
    )
      throw new Error("invalid or duplicate physical target identity");
    if (
      batch.kind === "battle" &&
      (batch.keys.some((k) => !HASH.test(k.battle_id)) ||
        !Array.isArray(batch.events) ||
        !Array.isArray(batch.dependencies))
    )
      throw new Error("battle dependency evidence required");
    if (
      batch.kind === "receipt" &&
      batch.keys.some(
        (k) =>
          !/^[1-9][0-9]*$/.test(String(k.receipt_id)) ||
          BigInt(k.receipt_id) > BigInt(manifest.receipt_high_water) ||
          !HASH.test(k.payload_hash) ||
          (k.replacement_hash !== null && !HASH.test(k.replacement_hash)),
      )
    )
      throw new Error("invalid replay identities");
  }
  // A redirect is never installed until its exact retained-only body exists.
  if (batch?.kind === "receipt") {
    const hashes = [
      ...new Set(
        batch.keys
          .filter((k) => k.replacement_hash)
          .map((k) => `${k.replacement_hash}/${k.entity_key}`),
      ),
    ];
    for (const identity of hashes) {
      const hash = identity.split("/")[0];
      const replacement = manifest.replacements?.[identity];
      if (
        !replacement ||
        !/^payloads\/endpoint=player_battlelog\//.test(replacement.key ?? "") ||
        !HASH.test(replacement.compressed_sha256 ?? "") ||
        !replacement.key.endsWith(`-${hash.slice(0, 16)}.json.gz`)
      )
        throw new Error("undeclared retained-only replacement");
      const r = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: replacement.key }),
      );
      if (r.ContentLength > 16_000_000) {
        r.Body.destroy?.();
        throw new Error("oversize retained replay");
      }
      const bytes = Buffer.from(await r.Body.transformToByteArray());
      const body = JSON.parse(
        gunzipSync(bytes, { maxOutputLength: 128_000_000 }).toString("utf8"),
      );
      if (
        !Array.isArray(body) ||
        body.length === 0 ||
        bytes.length > 16_000_000 ||
        sha(bytes) !== replacement.compressed_sha256 ||
        payloadHash(body) !== hash
      )
        throw new Error("retained-only replacement differs");
    }
  }
  const protectedClans = readOnlyGuard ? clans : manifest.guard_clans;
  if (
    !Array.isArray(protectedClans) ||
    protectedClans.length > 256 ||
    protectedClans.some((t) => normalizeTag(t) !== t) ||
    new Set(protectedClans).size !== protectedClans.length
  )
    throw new Error("invalid retained-clan guard");
  const battleClans = readOnlyGuard ? [] : manifest.battle_guard_clans;
  if (
    !Array.isArray(battleClans) ||
    battleClans.length > 256 ||
    battleClans.some((t) => normalizeTag(t) !== t) ||
    new Set(battleClans).size !== battleClans.length
  )
    throw new Error("invalid battle-clan guard");
  const catalog = await rightSizingCensus(databaseUrl, { catalog: true });
  if (manifest && catalog.schema_sha256 !== manifest.schema_sha256)
    throw new Error("purge schema changed");
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  const latestSources = async () =>
    (
      await db.query(
        "select distinct coalesce(r.replay_payload_hash,r.payload_hash) as payload_hash,r.entity_key,p.payload_json from api_receipt r left join api_payload p on p.endpoint=r.endpoint and p.entity_key=r.entity_key and p.payload_hash=coalesce(r.replay_payload_hash,r.payload_hash) where r.endpoint='player_battlelog' and r.admission='admitted' and r.replay_retired_at is null and r.receipt_id > $1::bigint",
        [manifest.receipt_high_water],
      )
    ).rows;
  try {
    if (batch?.kind === "battle") {
      const sources = await latestSources();
      if (sources.length > 2000)
        throw new Error(
          "new observer review exceeds bounded batch; refresh evidence",
        );
      for (let i = 0; i < sources.length; i += 12)
        await Promise.all(
          sources.slice(i, i + 12).map((r) => freshObserverIds(r, s3, bucket)),
        );
    }
    await db.query("begin");
    await db.query("set local statement_timeout='15s'");
    await db.query("set local lock_timeout='2s'");
    if (spec.apply === true || readOnlyGuard)
      await db.query("select pg_advisory_xact_lock(hashtext($1))", [
        RECORDING_CUTOVER_LOCK,
      ]);
    if (spec.apply === true)
      await db.query(
        "lock table account,claim,account_clan,recording,account_event,clan_membership,clan_state,job in share mode",
      );
    const current = await guard(db, protectedClans);
    if (readOnlyGuard) {
      const highWater = (
        await db.query(
          "select coalesce(max(receipt_id),0)::text as id from api_receipt",
        )
      ).rows[0].id;
      await db.query("rollback");
      return {
        receipt_high_water: highWater,
        readonly: true,
        schema_sha256: catalog.schema_sha256,
        ...current,
      };
    }
    if (current.sha256 !== manifest.guard_sha256)
      throw new Error("retained reasons changed; regenerate manifest");
    let affected = 0;
    if (batch.kind === "battle") {
      const ids = batch.keys.map((k) => k.battle_id);
      // Capture may continue while a manifest is reviewed. Protect any
      // later admitted log's whole entries, including a defender whose tag
      // the API omits from the entry. Missing source evidence refuses.
      const latest = await latestSources();
      const targetIds = new Set(ids);
      if (latest.length > 2000)
        throw new Error(
          "new observer review exceeds bounded batch; refresh evidence",
        );
      for (let i = 0; i < latest.length; i += 12) {
        const identities = await Promise.all(
          latest
            .slice(i, i + 12)
            .map((r) => freshObserverIds(r, s3, bucket, true)),
        );
        if (identities.some((ids) => ids.some((id) => targetIds.has(id))))
          throw new Error("battle has newly admitted observer evidence");
      }
      const personal = await protectedPlayers(
        db,
        manifest.battle_guard_clans ?? [],
        false,
      );
      const overlaps = (
        await db.query(
          "select count(*)::int as n from battle_participant where battle_id=any($1::text[]) and player_tag=any($2::text[])",
          [ids, personal],
        )
      ).rows[0].n;
      if (overlaps)
        throw new Error("battle overlaps retained personal or clan history");
      const existing = (
        await db.query(
          "select battle_id,created_at <= $2::timestamptz as within_cutoff from battle where battle_id=any($1::text[]) order by battle_id for update",
          [ids, manifest.cutoff],
        )
      ).rows;
      if (existing.some((r) => !r.within_cutoff))
        throw new Error("battle exceeds approved cutoff");
      const eventIds = (
        await db.query(
          "select event_id::text from player_event where battle_id=any($1::text[]) order by event_id",
          [ids],
        )
      ).rows.map((r) => r.event_id);
      if (eventIds.some((id) => !batch.events.includes(id)))
        throw new Error("new dependent event; regenerate manifest");
      const deps = (
        await db.query(
          "select b.battle_id,(select count(*) from battle_participant p where p.battle_id=b.battle_id)::text as participants,(select count(*) from battle_participant_card c where c.battle_id=b.battle_id)::text as cards,(select count(*) from battle_participant_round r where r.battle_id=b.battle_id)::text as rounds from battle b where b.battle_id=any($1::text[])",
          [ids],
        )
      ).rows;
      const expected = new Map(batch.dependencies.map((d) => [d.battle_id, d]));
      if (
        deps.some(
          (d) =>
            JSON.stringify([d.participants, d.cards, d.rounds]) !==
            JSON.stringify([
              expected.get(d.battle_id)?.participants,
              expected.get(d.battle_id)?.cards,
              expected.get(d.battle_id)?.rounds,
            ]),
        )
      )
        throw new Error("battle dependencies changed");
      const pairs = (
        await db.query(
          "select distinct player_tag as tag,(battle_time at time zone 'UTC')::date::text as day from battle_participant where battle_id=any($1::text[])",
          [ids],
        )
      ).rows;
      if (spec.apply === true) {
        for (const table of [
          "player_event",
          "battle_participant_card",
          "battle_participant_round",
          "battle_participant",
          "battle",
        ])
          affected += (
            await db.query(
              `delete from ${table} where battle_id=any($1::text[])`,
              [ids],
            )
          ).rowCount;
        await refreshDailyRollups(
          db,
          pairs.map((p) => ({ playerTag: p.tag, day: p.day })),
        );
      }
    } else if (batch.kind === "receipt") {
      const currentRows = (
        await db.query(
          "select receipt_id::text,endpoint,entity_key,fetched_at,payload_hash,replay_retired_at,replay_payload_hash from api_receipt where receipt_id=any($1::bigint[]) for update",
          [batch.keys.map((k) => k.receipt_id)],
        )
      ).rows;
      const byId = new Map(batch.keys.map((k) => [String(k.receipt_id), k]));
      for (const r of currentRows) {
        const k = byId.get(r.receipt_id);
        if (r.endpoint !== k.endpoint || r.entity_key !== k.entity_key)
          throw new Error("receipt endpoint or observer differs");
        if (r.fetched_at.getTime() > Date.parse(manifest.cutoff))
          throw new Error("receipt exceeds approved cutoff");
        if (k.replacement_hash) {
          const replacement =
            manifest.replacements[`${k.replacement_hash}/${k.entity_key}`];
          const match =
            /^payloads\/endpoint=player_battlelog\/entity=([^/]+)\//.exec(
              replacement.key,
            );
          if (
            r.endpoint !== "player_battlelog" ||
            match?.[1] !== r.entity_key.replace(/^#/, "")
          )
            throw new Error("receipt endpoint or observer differs");
        }
      }
      if (
        currentRows.some(
          (r) =>
            r.payload_hash !== byId.get(r.receipt_id).payload_hash ||
            (r.replay_payload_hash &&
              r.replay_payload_hash !==
                byId.get(r.receipt_id).replacement_hash) ||
            (r.replay_retired_at && byId.get(r.receipt_id).replacement_hash),
        )
      )
        throw new Error("receipt replay identity changed");
      if (spec.apply === true)
        for (const k of batch.keys)
          affected += (
            await db.query(
              "update api_receipt set replay_retired_at=case when $3::text is null then coalesce(replay_retired_at,now()) else null end,replay_payload_hash=$3 where receipt_id=$1 and payload_hash=$2 and (replay_retired_at is null and replay_payload_hash is null)",
              [k.receipt_id, k.payload_hash, k.replacement_hash],
            )
          ).rowCount;
    } else if (batch.kind === "editorial") {
      const rows = (
        await db.query(
          "select issue_id::text,kind,composed_at,facts,note from email_issue where issue_id=any($1::bigint[]) for update",
          [batch.keys.map((k) => k.issue_id)],
        )
      ).rows;
      if (
        rows.some(
          (r) =>
            !["ultimate_champions", "featured_card", "card_of_week"].includes(
              r.kind,
            ) || r.composed_at.getTime() > Date.parse(manifest.cutoff),
        )
      )
        throw new Error("editorial kind or cutoff differs");
      affected = rows.filter((r) => r.facts !== null || r.note !== null).length;
      const byId = new Map(batch.keys.map((k) => [String(k.issue_id), k]));
      const fieldSha = (v) =>
        v === null ? null : sha(Buffer.from(JSON.stringify(v)));
      if (
        rows.some(
          (r) =>
            (r.facts !== null &&
              fieldSha(r.facts) !== byId.get(r.issue_id).facts_sha256) ||
            (r.note !== null &&
              fieldSha(r.note) !== byId.get(r.issue_id).note_sha256),
        )
      )
        throw new Error("editorial facts changed");
      if (spec.apply === true)
        affected = (
          await db.query(
            "update email_issue set facts=null,note=null where issue_id=any($1::bigint[]) and composed_at <= $2::timestamptz and (facts is not null or note is not null)",
            [batch.keys.map((k) => k.issue_id), manifest.cutoff],
          )
        ).rowCount;
    } else if (batch.kind === "capture") {
      const rows = (
        await db.query(
          "select audit_id::text,request_id::text,created_at,captured from mcp_call_audit where audit_id=any($1::bigint[]) for update",
          [batch.keys.map((k) => k.audit_id)],
        )
      ).rows;
      const byId = new Map(batch.keys.map((k) => [String(k.audit_id), k]));
      if (
        rows.some(
          (r) =>
            r.request_id !== byId.get(r.audit_id).request_id ||
            r.created_at.getTime() > Date.parse(manifest.cutoff),
        )
      )
        throw new Error("capture identity or cutoff differs");
      affected = rows.filter((r) => r.captured).length;
      if (spec.apply === true)
        affected = (
          await db.query(
            "update mcp_call_audit a set captured=false from jsonb_to_recordset($1::jsonb) k(audit_id bigint,request_id uuid) where a.audit_id=k.audit_id and a.request_id=k.request_id and a.created_at <= $2::timestamptz and a.captured",
            [JSON.stringify(batch.keys), manifest.cutoff],
          )
        ).rowCount;
    } else if (batch.kind === "cache") {
      const rows = (
        await db.query(
          "select payload_id::text,endpoint,entity_key,payload_hash,first_fetched_at,last_fetched_at from api_payload where payload_id=any($1::bigint[]) for update",
          [batch.keys.map((k) => k.payload_id)],
        )
      ).rows;
      const byId = new Map(batch.keys.map((k) => [String(k.payload_id), k]));
      const personal = await protectedPlayers(db, protectedClans, true);
      for (const r of rows) {
        const k = byId.get(r.payload_id);
        if (
          r.endpoint !== k.endpoint ||
          r.entity_key !== k.entity_key ||
          r.payload_hash !== k.payload_hash ||
          r.first_fetched_at.getTime() > Date.parse(manifest.cutoff) ||
          r.last_fetched_at.getTime() > Date.parse(manifest.cutoff)
        )
          throw new Error("cache identity or cutoff differs");
        if (
          !RETIRED_ENDPOINTS.has(r.endpoint) &&
          r.endpoint !== "player_battlelog"
        ) {
          if (
            (r.endpoint === "player" && personal.includes(r.entity_key)) ||
            (["clan", "currentriverrace", "riverracelog"].includes(
              r.endpoint,
            ) &&
              protectedClans.includes(r.entity_key))
          )
            throw new Error("cache overlaps retained personal or clan history");
          if (
            !["player", "clan", "currentriverrace", "riverracelog"].includes(
              r.endpoint,
            )
          )
            throw new Error("cache endpoint outside reviewed scope");
        }
        if (
          r.endpoint === "player_battlelog" &&
          !batch.replay_sources?.includes(r.payload_hash)
        )
          throw new Error("cache has no reviewed replay disposition");
      }
      affected = rows.length;
      if (spec.apply === true)
        affected = (
          await db.query(
            "delete from api_payload where payload_id=any($1::bigint[])",
            [rows.map((r) => r.payload_id)],
          )
        ).rowCount;
    } else {
      const table = batch.table,
        cols = TABLES[table];
      const join = cols.map((c) => `t.${c}=k.${c}`).join(" and ");
      const clocks = CLOCKS[table];
      const selected = [...new Set([...cols, ...(OWNERS[table] ?? [])])];
      const rows = (
        await db.query(
          `select ${selected.map((c) => `t.${c}`).join(",")},${clocks?.length ? clocks.map((c) => `coalesce(t.${c} > $2::timestamptz,false)`).join(" or ") : "false"} as changed from ${table} t join jsonb_populate_recordset(null::${table},$1::jsonb) k on ${join} order by ${cols.map((c) => `t.${c}`).join(",")} for update of t`,
          clocks?.length
            ? [JSON.stringify(batch.keys), manifest.cutoff]
            : [JSON.stringify(batch.keys)],
        )
      ).rows;
      if (rows.some((r) => r.changed))
        throw new Error("target projection changed after cutoff");
      if (PERSONAL_TABLES.has(table) || table === "battlelog_high_water") {
        const personal = await protectedPlayers(
          db,
          table === "battlelog_high_water"
            ? (manifest.battle_guard_clans ?? [])
            : protectedClans,
          table !== "battlelog_high_water",
        );
        if (rows.some((r) => personal.includes(r.player_tag ?? r.observer_tag)))
          throw new Error(
            "projection overlaps retained personal or clan history",
          );
      }
      if (
        selected.includes("clan_tag") &&
        rows.some((r) => protectedClans.includes(r.clan_tag))
      )
        throw new Error("projection overlaps retained clan history");
      // Parent cascades must never erase undeclared children.
      for (const child of table === "collection"
        ? ["collection_member", "integration_collection_grant"]
        : table === "ranking_snapshot"
          ? ["ranking_entry", "clan_ranking_entry"]
          : []) {
        const col = table === "collection" ? "collection_id" : "snapshot_id";
        if (
          (
            await db.query(
              `select count(*)::int as n from ${child} where ${col}=any($1::${table === "collection" ? "bigint" : "bigint"}[])`,
              [rows.map((r) => r[col])],
            )
          ).rows[0].n
        )
          throw new Error("parent still has undeclared children");
      }
      if (spec.apply === true)
        affected = (
          await db.query(
            `delete from ${table} t using jsonb_populate_recordset(null::${table},$1::jsonb) k where ${join}`,
            [JSON.stringify(batch.keys)],
          )
        ).rowCount;
      else affected = rows.length;
    }

    if (spec.apply === true) await db.query("commit");
    else await db.query("rollback");
    return {
      preview: spec.apply !== true,
      manifest_sha256: spec.manifest_sha256,
      batch_sha256: spec.batch_sha256,
      targets: batch.keys.length,
      affected,
    };
  } catch (e) {
    await db.query("rollback").catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}
