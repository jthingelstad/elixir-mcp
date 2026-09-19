/** The migrate Lambda — the ONLY thing that applies schema migrations in
 *  the cloud (docs/ENGINEERING.md). Invoked by the deploy script between code
 *  upload and flip. The build packages db/migrations alongside the bundle. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deckCensus,
  explainMeta,
  rewriteTable,
  terminateBackends,
  listBackends,
  typeBackfill,
  towerHpBackfill,
} from "./deck-backfill.mjs";
import { migrate } from "./migrate.mjs";
import { activityPreview, explainTimeline } from "./ops-activity.mjs";
import { refusalCensus, controlsCensus } from "./ops-captures.mjs";

import {
  seed,
  accountEmailOp,
  accountRoleOp,
  accountEnrollOp,
  principalOp,
  integrationOp,
} from "./ops-accounts.mjs";
import {
  replay,
  tenureHistory,
  exportPayloads,
  collectionOp,
  playerNames,
} from "./ops-record.mjs";
import {
  gatewayProvision,
  collectorTokenOp,
  collectorReleaseOp,
  gatewayRecoverOp,
  gatewayDrainOp,
} from "./ops-collectors.mjs";
import {
  stats,
  tables,
  ledger,
  warDrift,
  warWeekSeasonCensus,
  enumCensus,
  captureAudit,
  probe,
  explainParticipation,
  explainStandings,
  inspect,
  sessions,
  vacuum,
  pollStateOp,
} from "./ops-diagnostics.mjs";
import {
  abYield,
  auditCensus,
  argsCensus,
  rhythmScore,
} from "./ops-analysis.mjs";
import {
  feedbackPending,
  feedbackRead,
  feedbackRespond,
} from "./ops-feedback.mjs";
import { seriesImport, seriesCensus } from "./ops-bot-import.mjs";
import {
  snapshotDayCensus,
  snapshotRekey,
  seriesStatus,
  seriesBackfill,
  seriesCensusSelf,
  arenaMomentDedupe,
  raceWeekRepair,
  warWeekRekeyRepair,
  explainSeries,
  lifetimeZeroCensus,
  lifetimeZeroRepair,
} from "./ops-series.mjs";

export async function handler(event) {
  if (event?.inspect) {
    const result = await inspect(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.tenure_history) {
    return tenureHistory(process.env.DATABASE_URL, event.tenure_history);
  }
  if (event?.replay) {
    const result = await replay(process.env.DATABASE_URL, event.replay);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.player_names) {
    const result = await playerNames(
      process.env.DATABASE_URL,
      event.player_names,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.stats) {
    const result = await stats(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.tables) {
    // Sizes only - no payloads - so the whole answer is loggable.
    const result = await tables(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.poll_state) {
    const result = await pollStateOp(
      process.env.DATABASE_URL,
      event.poll_state,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.ledger) {
    const result = await ledger(process.env.DATABASE_URL, event.ledger);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.sessions) {
    const result = await sessions(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.probe) {
    const result = await probe(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.vacuum) {
    const result = await vacuum(process.env.DATABASE_URL, event.vacuum);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.explain_standings) {
    const result = await explainStandings(
      process.env.DATABASE_URL,
      event.explain_standings === true ? {} : event.explain_standings,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.explain_participation) {
    const result = await explainParticipation(
      process.env.DATABASE_URL,
      event.explain_participation,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.feedback_pending) {
    const result = await feedbackPending(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.feedback_read) {
    const result = await feedbackRead(
      process.env.DATABASE_URL,
      event.feedback_read,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.collector_token) {
    const result = await collectorTokenOp(
      process.env.DATABASE_URL,
      event.collector_token,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.integration) {
    return integrationOp(process.env.DATABASE_URL, event.integration);
  }
  if (event?.principal) {
    const result = await principalOp(process.env.DATABASE_URL, event.principal);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.collector_release) {
    const result = await collectorReleaseOp(
      process.env.DATABASE_URL,
      event.collector_release,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.gateway_drain) {
    const result = await gatewayDrainOp(
      process.env.DATABASE_URL,
      event.gateway_drain,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.gateway_recover) {
    const result = await gatewayRecoverOp(
      process.env.DATABASE_URL,
      event.gateway_recover,
    );
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
  if (event?.rhythm_score) {
    const result = await rhythmScore(
      process.env.DATABASE_URL,
      event.rhythm_score === true ? {} : event.rhythm_score,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.account_email) {
    const result = await accountEmailOp(
      process.env.DATABASE_URL,
      event.account_email,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.account_enroll) {
    const result = await accountEnrollOp(
      process.env.DATABASE_URL,
      event.account_enroll,
    );
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
  if (event?.war_week_season_census) {
    const result = await warWeekSeasonCensus(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.war_drift) {
    const result = await warDrift(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.capture_audit) {
    const result = await captureAudit(
      process.env.DATABASE_URL,
      event.capture_audit,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.tower_hp_backfill) {
    const result = await towerHpBackfill(
      process.env.DATABASE_URL,
      event.tower_hp_backfill === true ? {} : event.tower_hp_backfill,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.type_backfill) {
    const result = await typeBackfill(
      process.env.DATABASE_URL,
      event.type_backfill === true ? {} : event.type_backfill,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.backends) {
    const result = await listBackends(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.terminate_backends) {
    const result = await terminateBackends(
      process.env.DATABASE_URL,
      event.terminate_backends === true ? {} : event.terminate_backends,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.rewrite_table) {
    const result = await rewriteTable(
      process.env.DATABASE_URL,
      event.rewrite_table,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.explain_meta) {
    const result = await explainMeta(
      process.env.DATABASE_URL,
      event.explain_meta === true ? {} : event.explain_meta,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.enum_census) {
    const result = await enumCensus(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.deck_census) {
    const result = await deckCensus(process.env.DATABASE_URL);
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
  if (event?.args_census) {
    const result = await argsCensus(
      process.env.DATABASE_URL,
      event.args_census,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.refusal_census) {
    const result = await refusalCensus(
      process.env.DATABASE_URL,
      event.refusal_census === true ? {} : event.refusal_census,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.controls_census) {
    const result = await controlsCensus(
      process.env.DATABASE_URL,
      event.controls_census === true ? {} : event.controls_census,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.explain_timeline) {
    const result = await explainTimeline(
      process.env.DATABASE_URL,
      event.explain_timeline === true ? {} : event.explain_timeline,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.activity_preview) {
    const result = await activityPreview(
      process.env.DATABASE_URL,
      event.activity_preview,
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
  if (event?.snapshot_day_census) {
    const result = await snapshotDayCensus(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.series_backfill) {
    const result = await seriesBackfill(
      process.env.DATABASE_URL,
      event.series_backfill,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.series_import) {
    const result = await seriesImport(
      process.env.DATABASE_URL,
      event.series_import,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.series_census) {
    const result = await seriesCensus(
      process.env.DATABASE_URL,
      event.series_census === true ? {} : event.series_census,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.lifetime_zero_census) {
    const result = await lifetimeZeroCensus(
      process.env.DATABASE_URL,
      event.lifetime_zero_census === true ? {} : event.lifetime_zero_census,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.lifetime_zero_repair) {
    const result = await lifetimeZeroRepair(
      process.env.DATABASE_URL,
      event.lifetime_zero_repair === true ? {} : event.lifetime_zero_repair,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.explain_series) {
    const result = await explainSeries(
      process.env.DATABASE_URL,
      event.explain_series === true ? {} : event.explain_series,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.war_week_rekey_repair) {
    const result = await warWeekRekeyRepair(
      process.env.DATABASE_URL,
      event.war_week_rekey_repair === true ? {} : event.war_week_rekey_repair,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.race_week_repair) {
    const result = await raceWeekRepair(
      process.env.DATABASE_URL,
      event.race_week_repair === true ? {} : event.race_week_repair,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.arena_moment_dedupe) {
    const result = await arenaMomentDedupe(
      process.env.DATABASE_URL,
      event.arena_moment_dedupe === true ? {} : event.arena_moment_dedupe,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.series_census_self) {
    const result = await seriesCensusSelf(
      process.env.DATABASE_URL,
      event.series_census_self === true ? {} : event.series_census_self,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.series_status) {
    const result = await seriesStatus(
      process.env.DATABASE_URL,
      event.series_status === true ? {} : event.series_status,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.snapshot_rekey) {
    const result = await snapshotRekey(
      process.env.DATABASE_URL,
      event.snapshot_rekey === true ? {} : event.snapshot_rekey,
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
