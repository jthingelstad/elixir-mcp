import pg from "pg";

/** Collections by ops ({collection: {op, slug, ...}}): upsert a
 *  collection under the owner, add or remove members through the same
 *  helper every other door uses, or reconcile its recordings. */
export async function collectionOp(databaseUrl, spec) {
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    const slug = String(spec?.slug ?? "").toLowerCase();
    if (spec.op === "upsert") {
      const { rows } = await db.query(
        `insert into collection (slug, title, kind, description, visibility, owner_account, synced_from)
         values ($1, $2, $3, $4, coalesce($5, 'public'),
                 (select account_id from account where is_owner limit 1), $6)
         on conflict (slug) do update set
           title = excluded.title,
           description = coalesce(excluded.description, collection.description),
           visibility = coalesce($5, collection.visibility),
           synced_from = coalesce($6, collection.synced_from)
         returning collection_id`,
        [
          slug,
          spec.title,
          spec.kind,
          spec.description ?? null,
          spec.visibility ?? null,
          spec.synced_from ?? null,
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
