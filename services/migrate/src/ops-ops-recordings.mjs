/**
 * Settle the recordings the retired `ops` reason kept open
 * ({ops_recordings: {...}}).
 *
 *   {ops_recordings: {dry_run: true}}    the census, and which would stop
 *   {ops_recordings: {dry_run: false}}   stop them
 *
 * Dry run by default: `dry_run` must be false to write.
 *
 * Since 2026-10-12 only people's tracking is a reason to record (Jamie,
 * the record brief): the maintainer's own `ops` reason is retired (#527).
 * The claims reconcile no longer spares a recording whose origin is `ops`,
 * but it runs only when a subject's tracking changes, so a subject recorded
 * under `ops` alone stays active until something touches it. This settles
 * those through the claims package's own reconcile, so nothing here
 * decides on its own what a reason to record is.
 *
 * The census counts every recording row whose origin is `ops`, by subject
 * type and status. No op mints the origin; the 0042 backfill was its only
 * writer, and the check constraint still allows it.
 *
 * Stopping a recording deletes nothing it recorded; the trim (#528)
 * decides what happens to an untracked subject's history. A subject
 * someone tracks keeps recording, at the widest scope still asked for, and
 * its row keeps the `ops` label. One transaction; a re-run stops nothing.
 */

import pg from "pg";
import { reconcileRecording } from "@elixir-mcp/claims";

export async function opsRecordingsOp(databaseUrl, spec = {}) {
  const dryRun = spec?.dry_run !== false;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    try {
      const { rows: census } = await db.query(
        `select subject_type, status, count(*)::int as n
           from recording where origin = 'ops'
          group by 1, 2 order by 1, 2`,
      );
      const { rows: subjects } = await db.query(
        `select distinct subject_type as kind, subject_tag as tag
           from recording
          where origin = 'ops' and status = 'active'
          order by subject_tag, subject_type`,
      );
      const stopping = [];
      for (const { kind, tag } of subjects) {
        // The subject lock every claims mutation takes, in tag order.
        await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [tag]);
        const r = await reconcileRecording(db, kind, tag, null, { dryRun });
        if (r.stopped) stopping.push({ kind, tag });
      }
      await db.query(dryRun ? "rollback" : "commit");
      const count = (kind) => stopping.filter((s) => s.kind === kind).length;
      return {
        dry_run: dryRun,
        origin_ops: census,
        subjects: subjects.length,
        [dryRun ? "would_stop_count" : "stopped_count"]: {
          player: count("player"),
          clan: count("clan"),
        },
        [dryRun ? "would_stop" : "stopped"]: stopping,
      };
    } catch (err) {
      await db.query("rollback").catch(() => {});
      throw err;
    }
  } finally {
    await db.end();
  }
}
