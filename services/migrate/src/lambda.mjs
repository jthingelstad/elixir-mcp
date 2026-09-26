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
} from "./deck-backfill.mjs";
import { migrate } from "./migrate.mjs";
import { activityPreview, explainTimeline } from "./ops-activity.mjs";
import { refusalCensus, controlsCensus } from "./ops-captures.mjs";
import { profileTool } from "./ops-profile.mjs";

import {
  seed,
  accountEmailOp,
  accountRoleOp,
  accountEnrollOp,
  accountTrackOp,
  principalOp,
  integrationOp,
  serviceTokenLimitsOp,
} from "./ops-accounts.mjs";
import { collectionOp } from "./ops-record.mjs";
import {
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
  battleFidelityCensus,
  modeShapeCensus,
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
  auditCensus,
  argsCensus,
  callSequenceCensus,
  pollReplay,
  acceptanceCatalogue,
} from "./ops-analysis.mjs";
import { nameCensus } from "./ops-names.mjs";
import {
  cardRolesImport,
  archetypeCensus,
  archetypeStamp,
  archetypeSample,
} from "./ops-archetypes.mjs";
import {
  feedbackPending,
  feedbackRead,
  feedbackRespond,
} from "./ops-feedback.mjs";
import {
  seriesStatus,
  seriesBackfill,
  seriesCensusSelf,
  explainSeries,
} from "./ops-series.mjs";
import { duelRoundDecks } from "./ops-duel-rounds.mjs";

export async function handler(event) {
  if (event?.inspect) {
    const result = await inspect(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.account_track) {
    const result = await accountTrackOp(
      process.env.DATABASE_URL,
      event.account_track,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.name_census) {
    const result = await nameCensus(
      process.env.DATABASE_URL,
      event.name_census === true ? {} : event.name_census,
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
  if (event?.profile_tool) {
    const result = await profileTool(
      process.env.DATABASE_URL,
      event.profile_tool,
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
  if (event?.service_token_limits) {
    const result = await serviceTokenLimitsOp(
      process.env.DATABASE_URL,
      event.service_token_limits,
    );
    console.log(JSON.stringify(result));
    return result;
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
  if (event?.poll_replay) {
    const result = await pollReplay(
      process.env.DATABASE_URL,
      event.poll_replay === true ? {} : event.poll_replay,
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
  if (event?.card_roles_import) {
    const result = await cardRolesImport(
      process.env.DATABASE_URL,
      event.card_roles_import,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.archetype_stamp) {
    const result = await archetypeStamp(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.archetype_sample) {
    const result = await archetypeSample(
      process.env.DATABASE_URL,
      typeof event.archetype_sample === "object" ? event.archetype_sample : {},
    );
    console.log(
      JSON.stringify({ season: result.season, top: result.top.length }),
    );
    return result;
  }
  if (event?.archetype_census) {
    const result = await archetypeCensus(
      process.env.DATABASE_URL,
      typeof event.archetype_census === "object" ? event.archetype_census : {},
    );
    console.log(JSON.stringify({ decks: result.decks, roles: result.roles }));
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
  if (event?.battle_fidelity_census) {
    const result = await battleFidelityCensus(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.mode_shape_census) {
    const result = await modeShapeCensus(process.env.DATABASE_URL);
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
  if (event?.acceptance_catalogue) {
    const result = await acceptanceCatalogue(
      process.env.DATABASE_URL,
      event.acceptance_catalogue,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.call_sequence_census) {
    const result = await callSequenceCensus(
      process.env.DATABASE_URL,
      event.call_sequence_census === true ? {} : event.call_sequence_census,
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
  if (event?.series_backfill) {
    const result = await seriesBackfill(
      process.env.DATABASE_URL,
      event.series_backfill,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.duel_round_decks) {
    const result = await duelRoundDecks(
      process.env.DATABASE_URL,
      event.duel_round_decks === true ? {} : event.duel_round_decks,
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
  if (event?.series_census_self) {
    const result = await seriesCensusSelf(
      process.env.DATABASE_URL,
      event.series_census_self === true ? {} : event.series_census_self,
    );
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.oauth_grants) {
    const { oauthGrants } = await import("./ops-grants.mjs");
    const result = await oauthGrants(
      process.env.DATABASE_URL,
      event.oauth_grants,
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
  if (event?.seed) {
    const result = await seed(process.env.DATABASE_URL, event.seed);
    console.log(JSON.stringify(result));
    return result;
  }
  // Only an empty payload migrates: {} is the deploy's call
  // (deploy.mjs runMigrations). An op name the dispatcher does not know
  // (a typo, or a known key with a falsy value such as {"stats": false})
  // used to fall through to here and apply pending migrations to
  // production; it is refused instead (Jamie, 2026-09-25). The ops are
  // listed in .claude/skills/ops/ops.md.
  const keys =
    event && typeof event === "object" && !Array.isArray(event)
      ? Object.keys(event)
      : [];
  if (keys.length > 0) {
    const refused = {
      error: "unknown_op",
      keys,
      message:
        "No op matched this payload, so nothing ran. Copy the op's key from .claude/skills/ops/ops.md and pass true or an object; an empty payload {} runs the migrations.",
    };
    console.log(JSON.stringify(refused));
    return refused;
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
