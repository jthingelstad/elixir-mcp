/**
 * Censuses over the call captures (interface review 2026-09-19, Part 7.4
 * and 7.5; contract 3.18.0). The audit row keeps argument KEYS and never
 * values, by design; the captured request and response bodies in the
 * archive bucket (0063) hold the rest. These two readers pull a bounded
 * number of captures and answer the two questions the review could not:
 * which tag was refused, and whether the controls fire and get acted on.
 * Read-only; nothing here writes. Missing captures (the 90-day expiry,
 * a failed write) are counted, never guessed at.
 */

import pg from "pg";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const gunzipAsync = promisify(gunzip);

/** The capture key, as services/mcp/src/capture.mjs writes it. */
function captureKey(at, requestId) {
  const dt = new Date(at).toISOString().slice(0, 10);
  return `calls/dt=${dt}/request_id=${requestId}.json.gz`;
}

/** The last read failure, so a census that reads nothing says why
 *  instead of counting every capture as missing. */
let lastReadError = null;

async function readCapture(s3, bucket, row) {
  const { GetObjectCommand } = await import("@aws-sdk/client-s3");
  try {
    const out = await s3.send(
      new GetObjectCommand({
        Bucket: bucket,
        Key: captureKey(row.created_at, row.request_id),
      }),
    );
    const bytes = Buffer.from(await out.Body.transformToByteArray());
    return JSON.parse((await gunzipAsync(bytes)).toString("utf8"));
  } catch (err) {
    lastReadError = `${err?.name ?? "error"}: ${err?.message ?? err}`;
    return null;
  }
}

async function archive() {
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
  const { S3Client } = await import("@aws-sdk/client-s3");
  return { s3: new S3Client({}), bucket };
}

const TAG_KEYS = ["player_tag", "clan_tag", "tag", "player_tags", "tags"];

/** Every tag-shaped argument value in a captured request, as given. */
function tagValues(args) {
  const out = [];
  const walk = (v, key) => {
    if (v === null || v === undefined) return;
    if (Array.isArray(v)) {
      for (const x of v) walk(x, key);
      return;
    }
    if (typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, k);
      return;
    }
    if (TAG_KEYS.includes(key)) out.push(String(v));
  };
  walk(args, null);
  return out;
}

/**
 * {refusal_census: {code?: "invalid_tag", days?, limit?}}: the argument
 * values behind a refusal code, per tool and surface, as the caller sent
 * them (a tag is a public identifier; nothing else is read). The 58
 * elixir-bot war_history invalid_tag refusals are the case (Part 6.4).
 */
export async function refusalCensus(databaseUrl, spec = {}) {
  const code = String(spec.code ?? "invalid_tag");
  const days = Math.min(Math.max(Number(spec.days ?? 14), 1), 90);
  const limit = Math.min(Math.max(Number(spec.limit ?? 300), 1), 1000);
  const { s3, bucket } = await archive();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select request_id, created_at, tool, surface, client_name, captured, args
         from mcp_call_audit
        where error_code = $1 and request_id is not null
          and created_at > now() - make_interval(days => $2)
        order by created_at desc limit $3`,
      [code, days, limit],
    );
    const byKey = new Map();
    let read = 0;
    let missing = 0;
    for (const r of rows) {
      const key = `${r.tool}|${r.surface}`;
      const cur = byKey.get(key) ?? {
        tool: r.tool,
        surface: r.surface,
        refusals: 0,
        captured: 0,
        values: new Map(),
        message: null,
      };
      cur.refusals += 1;
      if (r.captured) {
        const body = await readCapture(s3, bucket, r);
        if (body) {
          read += 1;
          cur.captured += 1;
          for (const v of tagValues(body.request?.arguments ?? {}))
            cur.values.set(v, (cur.values.get(v) ?? 0) + 1);
          cur.message ??= body.response?.error?.message ?? null;
        } else missing += 1;
      }
      byKey.set(key, cur);
    }
    return {
      code,
      days,
      refusals: rows.length,
      captures_read: read,
      captures_missing: missing,
      last_read_error: lastReadError,
      by_tool: [...byKey.values()].map((c) => ({
        tool: c.tool,
        surface: c.surface,
        refusals: c.refusals,
        captured: c.captured,
        example_message: c.message,
        values: [...c.values.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 40)
          .map(([value, n]) => ({ value, n })),
      })),
    };
  } finally {
    await db.end();
  }
}

/** The controls a response can carry, and how each one reads as fired. */
const CONTROLS = {
  comparable_false: (b) => b?.comparable === false,
  trophy_floor_floored: (b) => b?.trophy_floor?.floored === true,
  partial_bucket: (b) =>
    [b?.weeks, b?.player?.monthly_trend].some(
      (rows) => Array.isArray(rows) && rows.some((r) => r?.partial === true),
    ),
  season_crossed: (b) =>
    Array.isArray(b?.applied?.window?.crosses) &&
    b.applied.window.crosses.length > 0,
  completeness_note: (b) => typeof b?.meta?.completeness_note === "string",
  segment_omitted: (b) =>
    Array.isArray(b?.notes) &&
    b.notes.some((n) => /segment was omitted/.test(String(n))),
  pooled_modes: (b) =>
    Array.isArray(b?.notes) &&
    b.notes.some((n) =>
      /pool(s|ed) (every|more than one) mode/i.test(String(n)),
    ),
  single_player: (b) =>
    Array.isArray(b?.notes) &&
    b.notes.some((n) => /one player's/i.test(String(n))),
};
const CONTROL_TOOLS = [
  "players_summary",
  "battles_performance",
  "battles_decks",
  "battles_cards",
  "battles_trends",
  "battles_meta_decks",
  "battles_meta_cards",
  "cards_synergy",
  "clans_standings",
  "clans_participation",
];

/**
 * {controls_census: {days?, limit?}}: per control, how often it fired
 * over the captured calls, and what the same account called next within
 * ten minutes (the follow-up's tool and argument keys from the audit
 * row, so "did the next call pass mode" is a number). Captures are read
 * newest first up to `limit`; the audit rows say how many there were.
 */
export async function controlsCensus(databaseUrl, spec = {}) {
  const days = Math.min(Math.max(Number(spec.days ?? 7), 1), 90);
  const limit = Math.min(Math.max(Number(spec.limit ?? 400), 1), 2000);
  const { s3, bucket } = await archive();
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `select a.request_id, a.created_at, a.tool, a.surface, a.account_id,
              (select json_build_object('tool', n.tool, 'keys',
                        (select coalesce(json_agg(k order by k), '[]'::json)
                           from jsonb_object_keys(coalesce(n.args, '{}'::jsonb)) k))
                 from mcp_call_audit n
                where n.account_id = a.account_id
                  and n.created_at > a.created_at
                  and n.created_at <= a.created_at + interval '10 minutes'
                  and n.error_code is null
                order by n.created_at limit 1) as next_call
         from mcp_call_audit a
        where a.tool = any($1::text[]) and a.captured and a.error_code is null
          and a.created_at > now() - make_interval(days => $2)
        order by a.created_at desc limit $3`,
      [CONTROL_TOOLS, days, limit],
    );
    const per = {};
    for (const name of Object.keys(CONTROLS))
      per[name] = { total: 0, fired: 0, by_tool: {}, followups: {} };
    let read = 0;
    let missing = 0;
    for (const r of rows) {
      const body = await readCapture(s3, bucket, r);
      if (!body) {
        missing += 1;
        continue;
      }
      read += 1;
      const resp = body.response ?? {};
      for (const [name, test] of Object.entries(CONTROLS)) {
        const c = per[name];
        c.total += 1;
        let fired = false;
        try {
          fired = test(resp);
        } catch {
          fired = false;
        }
        if (!fired) continue;
        c.fired += 1;
        c.by_tool[r.tool] = (c.by_tool[r.tool] ?? 0) + 1;
        const next = r.next_call;
        const key = next
          ? `${next.tool}${next.keys.includes("mode") ? " +mode" : ""}`
          : "(none within 10m)";
        c.followups[key] = (c.followups[key] ?? 0) + 1;
      }
    }
    return {
      days,
      audited_calls: rows.length,
      captures_read: read,
      captures_missing: missing,
      last_read_error: lastReadError,
      controls: per,
    };
  } finally {
    await db.end();
  }
}
