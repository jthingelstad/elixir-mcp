/** The migrate Lambda — the ONLY thing that applies schema migrations in
 *  the cloud (docs/ENGINEERING.md). Invoked by the deploy script between code
 *  upload and flip. The build packages db/migrations alongside the bundle. */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "./migrate.mjs";

import {
  seed,
  accountEmailOp,
  accountRoleOp,
  principalOp,
  integrationOp,
} from "./ops-accounts.mjs";
import {
  replay,
  exportPayloads,
  collectionOp,
  playerNames,
} from "./ops-record.mjs";
import {
  gatewayProvision,
  collectorTokenOp,
  collectorReleaseOp,
  gatewayRecoverOp,
} from "./ops-collectors.mjs";
import {
  stats,
  tables,
  ledger,
  warDrift,
  captureAudit,
  probe,
  inspect,
} from "./ops-diagnostics.mjs";
import {
  abYield,
  auditCensus,
  argsCensus,
  previewIntel,
} from "./ops-analysis.mjs";
import { feedbackPending, feedbackRespond } from "./ops-feedback.mjs";

export async function handler(event) {
  if (event?.inspect) {
    const result = await inspect(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
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
  if (event?.ledger) {
    const result = await ledger(process.env.DATABASE_URL, event.ledger);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.probe) {
    const result = await probe(process.env.DATABASE_URL);
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.feedback_pending) {
    const result = await feedbackPending(process.env.DATABASE_URL);
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
  if (event?.account_email) {
    const result = await accountEmailOp(
      process.env.DATABASE_URL,
      event.account_email,
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
  if (event?.preview_intel) {
    const result = await previewIntel(
      process.env.DATABASE_URL,
      event.preview_intel,
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
