/** Private read-only database census. It writes only immutable census files;
 * there is no delete/apply path and no raw record appears in its response. */
import pg from "pg";
import { createHash } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";

const LANES = Object.freeze({
  account: { columns: "account_id,kind,role,status,created_at" },
  claim: {},
  account_clan: {},
  account_event: {
    columns:
      "event_id,account_id,kind,created_at,jsonb_strip_nulls(jsonb_build_object('player_tag',detail->'player_tag','clan_tag',detail->'clan_tag','scope',detail->'scope','relationship',detail->'relationship','source',left(detail->>'source',200),'subject_type',detail->'subject_type','subject_tag',detail->'subject_tag','recording_id',detail->'recording_id','collection_id',detail->'collection_id','slug',detail->'slug','via',detail->'via')) as detail",
    filter:
      "kind in ('claim_added','claim_removed','clan_added','clan_removed','recording_started','recording_stopped','tracked_by_ops','enrolled','filled','collection_created','collection_deleted','collection_member_added','collection_member_removed','collection_grant_added','collection_grant_revoked')",
  },
  recording: {},
  clan_membership: {},
  collection: {},
  collection_member: {},
  integration_collection_grant: {},
  api_payload: { omit: ["payload_json"] },
  api_receipt: { omit: ["admission_errors"] },
  battle: {
    columns: "battle_id,cursor,battle_time,type,type_class,created_at",
  },
  battle_participant: {
    columns: "battle_id,player_tag,clan_tag,side,deck_hash",
    parentClock: "battle",
  },
  battle_dependency_counts: {
    table: "battle",
    columns:
      "battle_id,(select count(*) from battle_participant p where p.battle_id=battle.battle_id) as participants,(select count(*) from battle_participant_card c where c.battle_id=battle.battle_id) as cards,(select count(*) from battle_participant_round r where r.battle_id=battle.battle_id) as rounds",
  },
  player: { keysOnly: true },
  clan: { keysOnly: true },
  player_snapshot_daily: { keysOnly: true },
  clan_snapshot_daily: { keysOnly: true },
  player_progress_daily: { keysOnly: true },
  player_pol_season: { keysOnly: true },
  player_card: { keysOnly: true },
  player_badge: { keysOnly: true },
  player_event: { omit: ["payload"] },
  clan_event: { omit: ["payload"] },
  player_daily_battle_rollup: { keysOnly: true },
  player_activity: { keysOnly: true },
  battlelog_high_water: { keysOnly: true },
  capture_audit: {},
  poll_state: { keysOnly: true },
  war_week: { keysOnly: true },
  war_week_clan: { keysOnly: true },
  war_period: { keysOnly: true },
  war_period_log: { keysOnly: true },
  war_participation: { keysOnly: true },
  war_attendance_day: { keysOnly: true },
  integration_profile_refresh: {
    columns: "refresh_id,account_id,player_tag,job_id,created_at",
  },
  series_backfill_state: {},
  ranking_board: {},
  ranking_snapshot: {},
  ranking_entry: { keysOnly: true },
  clan_ranking_entry: { keysOnly: true },
  ranking_presence: {},
  meta_season_state: {},
  meta_season_totals: { keysOnly: true },
  deck_meta_season: { keysOnly: true },
  card_meta_season: { keysOnly: true },
  meta_season_band_totals: { keysOnly: true },
  deck_meta_season_band: { keysOnly: true },
  card_meta_season_band: { keysOnly: true },
  meta_season_pop: { keysOnly: true },
  meta_season_pop_day: { keysOnly: true },
});
const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error("unexpected census identifier");
  return `"${value}"`;
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const DEFINITION = digest(
  Buffer.from(
    JSON.stringify({ version: 2, cutoff_algorithm_version: 2, lanes: LANES }),
  ),
);
// Separate from the history census so an in-flight export keeps its definition.
const REFERENCES = Object.freeze({
  deck: {
    columns:
      "deck_hash,(select count(*) from deck_card c where c.deck_hash=deck.deck_hash) as cards",
  },
  war_period_anchor: { keysOnly: true },
  // joined_observed_at is nullable on role/war events. The history excerpt
  // cannot establish their complete inventory; every event has window_end.
  clan_event_inventory: {
    table: "clan_event",
    columns: "event_id,clan_tag,player_tag,receipt_id,window_start,window_end",
    clock: "window_end",
  },
  player_profile_provenance: {
    table: "player_snapshot_daily",
    columns:
      "player_tag,snapshot_date,snapshot_kind,clan_tag,source,observed_at,profile_observed_at,roster_observed_at,created_at",
  },
  clan_profile_provenance: {
    table: "clan_snapshot_daily",
    columns: "clan_tag,day,snapshot_kind,receipt_id,source,observed_at",
  },
  ranking_player_entities: {
    table: "ranking_entry",
    columns: "snapshot_id,rank,player_tag,clan_tag",
  },
  ranking_clan_entities: {
    table: "clan_ranking_entry",
    columns: "snapshot_id,rank,clan_tag",
  },
  live_job: {
    table: "job",
    columns: "job_id,endpoint,entity_key,lane,status,created_at,done_at",
    filter: "lane='live'",
  },
  mcp_call_audit: {
    columns: "audit_id,request_id,tool,created_at,captured",
  },
  email_issue: {
    columns:
      "issue_id,kind,period_key,subject_key,status,composed_at,facts,note",
    hashFields: ["facts", "note"],
  },
  email_featured_card: {
    columns: "period_key,card_id,chosen_at,sent_at,score,reason,candidates",
    hashFields: ["reason", "candidates"],
  },
  email_send: {
    columns: "issue_id,account_id,enqueued_at,send_id,archived",
  },
});
const REFERENCE_DEFINITION = digest(
  Buffer.from(
    JSON.stringify({
      version: 2,
      cutoff_algorithm_version: 2,
      lanes: REFERENCES,
    }),
  ),
);

async function readSchema(db) {
  const foreignKeys = (
    await db.query(
      "select c.conname as name,c.conrelid::regclass::text as child_table,c.confrelid::regclass::text as parent_table,pg_get_constraintdef(c.oid) as definition,c.convalidated as validated from pg_constraint c join pg_namespace n on n.oid=c.connamespace where c.contype='f' and n.nspname='public' order by c.conrelid::regclass::text,c.conname",
    )
  ).rows;
  const primaryKeys = (
    await db.query(
      "select i.indrelid::regclass::text as table_name,array_agg(a.attname::text order by array_position(i.indkey,a.attnum)) as columns from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) join pg_class r on r.oid=i.indrelid join pg_namespace n on n.oid=r.relnamespace where i.indisprimary and n.nspname='public' group by i.indrelid order by i.indrelid::regclass::text",
    )
  ).rows;
  const columns = (
    await db.query(
      "select table_name,column_name,data_type,is_nullable from information_schema.columns where table_schema='public' order by table_name,ordinal_position",
    )
  ).rows;
  const catalog = {
    foreign_keys: foreignKeys,
    primary_keys: primaryKeys,
    columns,
  };
  return {
    readonly: true,
    schema_sha256: digest(Buffer.from(JSON.stringify(catalog))),
    ...catalog,
  };
}

async function schemaCatalog(databaseUrl) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin isolation level repeatable read read only");
    await db.query("set local statement_timeout='30s'");
    const result = await readSchema(db);
    await db.query("commit");
    return result;
  } finally {
    await db.end();
  }
}

export async function rightSizingCensus(
  databaseUrl,
  spec = {},
  { bucket = process.env.ARCHIVE_BUCKET, s3 = new S3Client({}) } = {},
) {
  if (Object.hasOwn(spec, "apply") || Object.hasOwn(spec, "delete"))
    throw new Error("right sizing census cannot delete or apply game data");
  const group = spec.group ?? "history";
  if (!["history", "references"].includes(group))
    throw new Error("unknown census group");
  const lanes = group === "history" ? LANES : REFERENCES;
  const definition = group === "history" ? DEFINITION : REFERENCE_DEFINITION;
  if (Object.hasOwn(spec, "catalog")) {
    if (spec.catalog !== true || spec.export)
      throw new Error("catalog is a separate read-only census");
    return schemaCatalog(databaseUrl);
  }
  if (!spec.export)
    return {
      readonly: true,
      catalog_available: true,
      definition_sha256: definition,
      lanes: Object.keys(lanes),
    };
  const {
    lane,
    snapshot_id: snapshotId,
    cutoff,
    after = null,
    limit = 2000,
  } = spec.export;
  if (!Object.hasOwn(lanes, lane)) throw new Error("unknown census lane");
  if (
    spec.export.definition_sha256 &&
    spec.export.definition_sha256 !== definition
  )
    throw new Error("census definition changed");
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      snapshotId ?? "",
    )
  )
    throw new Error("census needs a snapshot UUID");
  if (
    typeof cutoff !== "string" ||
    !Number.isFinite(Date.parse(cutoff)) ||
    new Date(cutoff).toISOString() !== cutoff ||
    Date.parse(cutoff) > Date.now()
  )
    throw new Error("census needs a canonical past cutoff");
  if (!Number.isInteger(limit) || limit < 1 || limit > 10000)
    throw new Error("census limit is 1..10000");
  let previous = null;
  if (after !== null) {
    if (
      typeof after !== "string" ||
      after.length > 4000 ||
      !/^[A-Za-z0-9_-]+$/.test(after)
    )
      throw new Error("invalid census cursor");
    previous = JSON.parse(Buffer.from(after, "base64url").toString("utf8"));
    if (
      previous.lane !== lane ||
      previous.snapshot_id !== snapshotId ||
      previous.cutoff !== cutoff ||
      !Array.isArray(previous.values) ||
      previous.values.some(
        (v) =>
          v === null || !["string", "number", "boolean"].includes(typeof v),
      )
    )
      throw new Error("census cursor belongs to another snapshot");
  }
  const db = new pg.Client({
    connectionString: databaseUrl,
    types: {
      getTypeParser: (oid, format) =>
        [1082, 1114, 1184].includes(oid)
          ? (value) => value
          : pg.types.getTypeParser(oid, format),
    },
  });
  await db.connect();
  try {
    await db.query("begin isolation level repeatable read read only");
    await db.query("set local statement_timeout='30s'");
    const schema = await readSchema(db);
    if (
      spec.export.schema_sha256 &&
      spec.export.schema_sha256 !== schema.schema_sha256
    )
      throw new Error("census schema changed");
    if (previous && previous.schema_sha256 !== schema.schema_sha256)
      throw new Error("census cursor schema changed");
    const table = lanes[lane].table ?? lane;
    const keys = (
      await db.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=$1::regclass and i.indisprimary order by array_position(i.indkey,a.attnum)`,
        [table],
      )
    ).rows.map((r) => r.attname);
    if (!keys.length || (previous && previous.values.length !== keys.length))
      throw new Error("census needs the complete primary key");
    const columns = (
      await db.query(
        "select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
        [table],
      )
    ).rows;
    const names = keys.map(identifier);
    const conditions = lanes[lane].filter ? [lanes[lane].filter] : [];
    const values = [];
    if (previous) {
      values.push(...previous.values);
      conditions.push(
        `(${names.join(",")}) > (${names.map((_, i) => `$${i + 1}`).join(",")})`,
      );
    }
    const clockColumn =
      lanes[lane].clock ??
      [
        "created_at",
        "first_fetched_at",
        "fetched_at",
        "observed_at",
        "captured_at",
        "joined_observed_at",
        "added_at",
        "first_seen_at",
        "first_observed_at",
        "recorded_at",
        ...(group === "references"
          ? ["composed_at", "chosen_at", "enqueued_at"]
          : []),
        "window_end",
        "snapshot_date",
        "day",
      ].find((n) => columns.some((c) => c.column_name === n));
    let cutoffPolicy = "current_inventory";
    if (lanes[lane].parentClock) {
      values.push(cutoff);
      conditions.push(
        `exists (select 1 from battle b where b.battle_id=${identifier(table)}.battle_id and b.created_at <= $${values.length}::timestamptz)`,
      );
      cutoffPolicy = "parent_created_at:battle";
    } else if (clockColumn) {
      values.push(cutoff);
      const clockType =
        columns.find((c) => c.column_name === clockColumn).data_type === "date"
          ? "date"
          : "timestamptz";
      conditions.push(
        `${identifier(clockColumn)} <= $${values.length}::${clockType}`,
      );
      cutoffPolicy = `${clockType}:${clockColumn}`;
    }
    values.push(limit + 1);
    const selected =
      lanes[lane].columns ??
      (lanes[lane].keysOnly
        ? names.join(",")
        : columns
            .filter((c) => !(lanes[lane].omit ?? []).includes(c.column_name))
            .map((c) => identifier(c.column_name))
            .join(","));
    const rows = (
      await db.query(
        `select ${selected} from ${identifier(table)}${conditions.length ? ` where ${conditions.join(" and ")}` : ""} order by ${names.join(",")} limit $${values.length}`,
        values,
      )
    ).rows;
    const page = rows.slice(0, limit);
    for (const row of page)
      for (const field of lanes[lane].hashFields ?? []) {
        const value = Buffer.from(JSON.stringify(row[field]));
        row[`${field}_sha256`] = digest(value);
        row[`${field}_bytes`] = value.length;
        delete row[field];
      }
    const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const next =
      rows.length > limit
        ? encode({
            lane,
            snapshot_id: snapshotId,
            cutoff,
            schema_sha256: schema.schema_sha256,
            values: keys.map((k) => page.at(-1)[k]),
          })
        : null;
    const bytes = Buffer.from(
      JSON.stringify({
        version: 1,
        snapshot_id: snapshotId,
        lane,
        cutoff,
        after,
        cutoff_policy: cutoffPolicy,
        snapshot_isolation: "per_page",
        definition_sha256: definition,
        schema_sha256: schema.schema_sha256,
        next_after: next,
        primary_key: keys,
        rows: page,
      }),
    );
    if (bytes.length > 5_000_000)
      throw new Error("census page exceeds private size bound; reduce limit");
    const sha256 = digest(bytes),
      key = `right-sizing/v1/${snapshotId}/${lane}/${sha256}.json`;
    await db.query("commit");
    try {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          ServerSideEncryption: "AES256",
          IfNoneMatch: "*",
          ChecksumSHA256: createHash("sha256").update(bytes).digest("base64"),
        }),
      );
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 412) throw error;
      const existing = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (existing.ContentLength > 5_000_000) {
        existing.Body.destroy?.();
        throw new Error("stored census page exceeds size bound");
      }
      const saved = await existing.Body.transformToByteArray();
      if (saved.byteLength > 5_000_000 || digest(saved) !== sha256)
        throw new Error("stored census page differs from its digest");
    }
    return {
      readonly: true,
      snapshot_id: snapshotId,
      lane,
      cutoff,
      key,
      sha256,
      cutoff_policy: cutoffPolicy,
      snapshot_isolation: "per_page",
      definition_sha256: definition,
      schema_sha256: schema.schema_sha256,
      bytes: bytes.length,
      rows: page.length,
      next_after: next,
      done: next === null,
    };
  } catch (error) {
    await db.query("rollback").catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}
