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
      "event_id,account_id,kind,created_at,jsonb_strip_nulls(jsonb_build_object('player_tag',detail->'player_tag','clan_tag',detail->'clan_tag','subject_type',detail->'subject_type','subject_tag',detail->'subject_tag','recording_id',detail->'recording_id','collection_id',detail->'collection_id','slug',detail->'slug','via',detail->'via')) as detail",
    filter:
      "kind in ('claim_added','claim_removed','clan_added','clan_removed','recording_started','recording_stopped','collection_created','collection_deleted','collection_member_added','collection_member_removed','collection_grant_added','collection_grant_revoked')",
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
  battle_participant: { columns: "battle_id,player_tag,clan_tag,side" },
  ranking_board: {},
  ranking_snapshot: {},
  ranking_entry: { keysOnly: true },
  ranking_presence: {},
  meta_season_state: {},
  meta_season_totals: { keysOnly: true },
  deck_meta_season: { keysOnly: true },
  meta_season_band_totals: { keysOnly: true },
  deck_meta_season_band: { keysOnly: true },
  meta_season_pop: { keysOnly: true },
  meta_season_pop_day: { keysOnly: true },
});
const identifier = (value) => {
  if (!/^[a-z][a-z0-9_]*$/.test(value))
    throw new Error("unexpected census identifier");
  return `"${value}"`;
};
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function rightSizingCensus(
  databaseUrl,
  spec = {},
  { bucket = process.env.ARCHIVE_BUCKET, s3 = new S3Client({}) } = {},
) {
  if (Object.hasOwn(spec, "apply") || Object.hasOwn(spec, "delete"))
    throw new Error("right sizing census cannot delete or apply game data");
  if (!spec.export) return { readonly: true, lanes: Object.keys(LANES) };
  const {
    lane,
    snapshot_id: snapshotId,
    cutoff,
    after = null,
    limit = 2000,
  } = spec.export;
  if (!Object.hasOwn(LANES, lane)) throw new Error("unknown census lane");
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
    const keys = (
      await db.query(
        `select a.attname from pg_index i join pg_attribute a on a.attrelid=i.indrelid and a.attnum=any(i.indkey) where i.indrelid=$1::regclass and i.indisprimary order by array_position(i.indkey,a.attnum)`,
        [lane],
      )
    ).rows.map((r) => r.attname);
    if (!keys.length || (previous && previous.values.length !== keys.length))
      throw new Error("census needs the complete primary key");
    const columns = (
      await db.query(
        "select column_name,data_type from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position",
        [lane],
      )
    ).rows;
    const names = keys.map(identifier);
    const conditions = LANES[lane].filter ? [LANES[lane].filter] : [];
    const values = [];
    if (previous) {
      values.push(...previous.values);
      conditions.push(
        `(${names.join(",")}) > (${names.map((_, i) => `$${i + 1}`).join(",")})`,
      );
    }
    const clockColumn = [
      "created_at",
      "first_fetched_at",
      "fetched_at",
      "observed_at",
      "captured_at",
      "joined_observed_at",
    ].find((n) => columns.some((c) => c.column_name === n));
    if (clockColumn) {
      values.push(cutoff);
      conditions.push(
        `${identifier(clockColumn)} <= $${values.length}::timestamptz`,
      );
    }
    values.push(limit + 1);
    const selected =
      LANES[lane].columns ??
      (LANES[lane].keysOnly
        ? names.join(",")
        : columns
            .filter((c) => !(LANES[lane].omit ?? []).includes(c.column_name))
            .map((c) => identifier(c.column_name))
            .join(","));
    const rows = (
      await db.query(
        `select ${selected} from ${identifier(lane)}${conditions.length ? ` where ${conditions.join(" and ")}` : ""} order by ${names.join(",")} limit $${values.length}`,
        values,
      )
    ).rows;
    const page = rows.slice(0, limit);
    const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
    const next =
      rows.length > limit
        ? encode({
            lane,
            snapshot_id: snapshotId,
            cutoff,
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
