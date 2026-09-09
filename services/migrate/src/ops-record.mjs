import pg from "pg";

/**
 * Ordered backfill replay ({replay: {messages: [...]}}) — the elixir-bot
 * archive lane (NOTES 2026-09-04). Each message is a CrResultMessage
 * (real API payload, gzipped by the orchestrator) processed STRICTLY in
 * order through the same processResult the results queue uses — SQS
 * cannot guarantee chronology and stage-2 projections need it. The
 * gateway row 'backfill-elixir-bot' is the provenance: every receipt is
 * attributed and one-click revocable like any gateway.
 */
export async function replay(databaseUrl, spec) {
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

export async function collectionOp(databaseUrl, spec) {
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
    // Membership through the SAME helper every other door uses. This op
    // used to write collection_member directly, which meant an ops add
    // did not start recording and an ops remove did not stop it - the
    // one door where "added means recorded" quietly did not hold.
    if (spec.op === "add" || spec.op === "remove") {
      const { rows: col } = await db.query(
        `select collection_id, kind, owner_account from collection where slug = $1`,
        [slug],
      );
      if (!col[0]) throw new Error(`no collection ${slug}`);
      const { normalizeTag } = await import("@elixir-mcp/contracts");
      const { setCollectionMembers } = await import("@elixir-mcp/claims");
      const tags = (spec.tags ?? []).map((t) => normalizeTag(String(t)));
      const r = await setCollectionMembers(
        db,
        {
          collectionId: col[0].collection_id,
          kind: col[0].kind,
          ownerAccount: col[0].owner_account,
        },
        tags,
        { mode: spec.op },
      );
      return {
        slug,
        [spec.op === "add" ? "added" : "removed"]:
          spec.op === "add" ? r.added : r.removed,
        recordings_started: r.recordingsStarted,
        recordings_stopped: r.recordingsStopped,
      };
    }
    // Repair op: re-apply a collection's settings to the members it
    // already holds, starting any recording that is missing. Needed
    // when something stopped a recording the collection still wants.
    if (spec.op === "reconcile") {
      const { rows: col } = await db.query(
        `select collection_id from collection where slug = $1`,
        [slug],
      );
      if (!col[0]) throw new Error(`no collection ${slug}`);
      const { reconcileCollection } = await import("@elixir-mcp/claims");
      const r = await reconcileCollection(db, col[0].collection_id);
      return { slug, ...r };
    }
    throw new Error(`unknown collection op ${spec?.op}`);
  } finally {
    await db.end();
  }
}

/**
 * Fill MISSING player names ({player_names: {entries: [{tag, name}]}}):
 * the June-July archive rows arrived without opponent names (feedback
 * #14), while elixir-bot's own record of the same battles carries them.
 * COALESCE semantics only - a name the recorder has observed is never
 * overwritten by this path, and unknown tags are never created. Returns
 * how many rows were filled so the repair is measured, not assumed.
 */
export async function playerNames(databaseUrl, spec) {
  const { normalizeTag } = await import("@elixir-mcp/contracts");
  const entries = [];
  for (const e of spec?.entries ?? []) {
    if (!e || typeof e.name !== "string" || !e.name.trim()) continue;
    try {
      entries.push({ tag: normalizeTag(String(e.tag)), name: e.name.trim() });
    } catch {
      // A malformed tag is skipped, never guessed.
    }
  }
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const { rows } = await db.query(
      `update player p set name = t.name
       from unnest($1::text[], $2::text[]) as t(tag, name)
       where p.player_tag = t.tag and p.name is null
       returning p.player_tag`,
      [entries.map((e) => e.tag), entries.map((e) => e.name)],
    );
    const { rows: still } = await db.query(
      `select count(*)::int as n from player where name is null`,
    );
    return {
      offered: entries.length,
      filled: rows.length,
      still_unnamed: still[0].n,
    };
  } finally {
    await db.end();
  }
}
