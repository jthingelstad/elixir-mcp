/**
 * Settle the recordings of suspended agents ({agent_recordings: {...}}).
 *
 *   {agent_recordings: {dry_run: true}}    which recordings would stop
 *   {agent_recordings: {dry_run: false}}   stop them
 *
 * Dry run by default: `dry_run` must be false to write.
 *
 * Since 2026-10-10 only active agents are in their owner's slots, and a
 * suspended agent's tracking is no reason to record (Jamie: "Only active
 * ones should count against usage slots."). Suspending or resuming an
 * agent settles its subjects in the same transaction (setAgentStatus);
 * this settles the agents that were already suspended when the rule
 * shipped, through the claims package's own reconcile, so nothing here
 * decides on its own what a reason to record is.
 *
 * Stopping a recording deletes nothing it recorded. A subject someone else
 * still tracks keeps recording, at the widest scope still asked for. One
 * transaction; a re-run stops nothing.
 */

import pg from "pg";
import { reconcileRecording } from "@elixir-mcp/claims";

export async function agentRecordingsOp(databaseUrl, spec = {}) {
  const dryRun = spec?.dry_run !== false;
  const db = new pg.Client({ connectionString: databaseUrl });
  await db.connect();
  try {
    await db.query("begin");
    try {
      const { rows: subjects } = await db.query(
        `select distinct s.kind, s.tag
           from (select 'player' as kind, c.player_tag as tag, c.account_id
                   from claim c
                 union all
                 select 'clan', ac.clan_tag, ac.account_id
                   from account_clan ac) s
           join account a on a.account_id = s.account_id
          where a.kind = 'agent' and a.status <> 'approved'
          order by s.tag, s.kind`,
      );
      const stopping = [];
      for (const { kind, tag } of subjects) {
        // The subject lock every claims mutation takes, in tag order.
        await db.query(`select pg_advisory_xact_lock(hashtext($1))`, [tag]);
        const r = await reconcileRecording(db, kind, tag, null, { dryRun });
        if (r.stopped) stopping.push({ kind, tag });
      }
      await db.query(dryRun ? "rollback" : "commit");
      return {
        dry_run: dryRun,
        subjects: subjects.length,
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
