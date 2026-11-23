import { publishPublicStats } from "./public-stats.mjs";
import { clanLifecycle, runClanEvaluation } from "./clan.mjs";
import { isActiveEmailKind, inactiveEmailReason } from "@elixir-mcp/contracts";
/** The jobs Lambda — scheduled product work, split out of the migrate
 *  Lambda (2026-09-05): EventBridge fires the sweeps and
 *  the nightly archetype stamp here, so the function that can
 *  alter schema is never also the one running on a timer. Same VPC and
 *  role; deliberately no migration or seeding code paths.
 *
 *  Ops payloads: {sweep_payloads: true,
 *  sweep_operational: true} · {sweep_operational: true} ·
 *  {archetype_stamp: true} · {capture_efficiency: true} ·
 *  {shape_census: true} · {retention_trim: true} ·
 *  {week_form: true | {week_start, after?}} ·
 *  {email: "<kind>", account_id?, force?}.
 *  Retired editorial payloads refuse before I/O. */

import { S3Client } from "@aws-sdk/client-s3";
import { guardS3, openJobsClient, runJob, runRemainingMs } from "./db.mjs";
import { purgeQuality } from "@elixir-mcp/syndication/quality";
import { sweepSilentCollectors } from "./fleet.mjs";
import { newsletterSync } from "./newsletter-sync.mjs";
import { loadVocabulary, stampDecks } from "@elixir-mcp/ingest/card-roles";
import { makeOutbox } from "@elixir-mcp/outbox";
import { runWebPush } from "./push/drain.mjs";
import { wakeClosingSittings } from "@elixir-mcp/syndication";
import {
  homeWeeksToWake,
  homeWeekWake,
} from "@elixir-mcp/tools/activity/home-feed";
import { storiesToWake } from "@elixir-mcp/tools/activity/story-store";
import { storyWake } from "@elixir-mcp/tools/activity/story-wake";
import { runFeedbackAnswers } from "./email/feedback-answers.mjs";
import { runWeekForm } from "./week-form.mjs";
import { runActivityMail } from "./email/activity-today.mjs";
import { runCollectorUpgrades } from "./email/collector-upgrades.mjs";
import { runEmail } from "./email/index.mjs";
import { captureEfficiency } from "./efficiency.mjs";
import { warBattlesUnresolved, warUnresolvedEmf } from "./war-calendar.mjs";
import { shapeCensus } from "./shape-census.mjs";
import { retentionTrim } from "@elixir-mcp/record/retention";

/** Hourly Postgres sweep ({sweep_payloads: true}, EventBridge :15):
 *  superseded payload rows (not the latest per endpoint+entity) leave
 *  Postgres only after their S3 twin HEAD-verifies; and the JSON of any
 *  row not fetched for two hours is nulled the same way (0071/0072),
 *  because the column is a cache of the archive, not the archive - its
 *  one reader is live_fetch, seconds after admission (0076: only
 *  live-lane payloads are cached at all). Bounded per run — the next
 *  hour takes the next slice. */
export async function sweepPayloads(databaseUrl, s3override) {
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) throw new Error("ARCHIVE_BUCKET not configured");
  const { archiveKey } = await import("@elixir-mcp/ingest/pipeline");
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = s3override ?? new S3Client({});
  const db = await openJobsClient(databaseUrl, { op: "sweep_payloads" });
  try {
    const { rows } = await db.query(
      `select p.payload_id, p.endpoint, p.entity_key, p.payload_hash,
              p.first_fetched_at
       from api_payload p
       where exists (select 1 from api_payload newer
                     where newer.endpoint = p.endpoint
                       and newer.entity_key = p.entity_key
                       and (newer.last_fetched_at, newer.payload_id)
                         > (p.last_fetched_at, p.payload_id))
       order by p.payload_id limit 2000`,
    );
    let swept = 0;
    let missing = 0;
    for (const r of rows) {
      const key = archiveKey(
        r.endpoint,
        r.entity_key,
        r.first_fetched_at.toISOString(),
        r.payload_hash,
      );
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        missing += 1; // no twin -> the row stays until the archive has it
        continue;
      }
      await db.query(`delete from api_payload where payload_id = $1`, [
        r.payload_id,
      ]);
      swept += 1;
    }
    // Phase two: the cache window. Rows still holding JSON two hours
    // after their last fetch give it up once the archive has it. Only
    // live-lane payloads carry JSON at all since 0076; nothing is exempt
    // by endpoint name - the catalog and the collection are tables.
    const { rows: stale } = await db.query(
      `select payload_id, endpoint, entity_key, payload_hash, first_fetched_at
       from api_payload
       where payload_json is not null
         and last_fetched_at < now() - interval '2 hours'
       order by last_fetched_at limit 5000`,
    );
    let cleared = 0;
    let unarchived = 0; // no twin: the JSON stays until the archive has it
    for (const r of stale) {
      const key = archiveKey(
        r.endpoint,
        r.entity_key,
        r.first_fetched_at.toISOString(),
        r.payload_hash,
      );
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch {
        unarchived += 1;
        continue;
      }
      await db.query(
        `update api_payload set payload_json = null where payload_id = $1`,
        [r.payload_id],
      );
      cleared += 1;
    }
    return {
      candidates: rows.length,
      swept,
      missing,
      stale: stale.length,
      cleared,
      unarchived,
    };
  } finally {
    await db.end();
  }
}

/** Operational-row sweep ({sweep_operational: true}, hourly, rides the
 *  same EventBridge rule as the payload sweep): every
 *  check is already expiry-aware, these rows are pure dead weight.
 *  oauth_token keeps 90 days (not 30): rotated-token rows are the
 *  memory behind family replay detection, and 90d is the absolute
 *  family lifetime — never trim below it. */
/** Re-stamp every deck behind the current archetype version (0148). */
export async function archetypeStampNightly(databaseUrl) {
  const db = await openJobsClient(databaseUrl, { op: "archetype_stamp" });
  try {
    const vocab = await loadVocabulary(db);
    return await stampDecks(db, vocab, {});
  } finally {
    await db.end();
  }
}

/** Wake the timeline sync for each account whose cross-posted sitting
 *  went quiet while told open (syndication wakeClosingSittings). */
async function closingSittings(databaseUrl, { wakeOutbox = outbox } = {}) {
  if (!wakeOutbox) return { skipped: "no_outbox" };
  const db = await openJobsClient(databaseUrl, { op: "discord_sittings" });
  try {
    return { woken: await wakeClosingSittings(db, { outbox: wakeOutbox }) };
  } finally {
    await db.end();
  }
}

/** The stored stories' sweep (stage 2 of the stored Timeline,
 *  2026-11-23), riding Home's five-minute run: wakes the recorded players
 *  whose rows no admission will refresh (a sitting gone quiet, news no
 *  admission announced, never written, the six-hour floor). Counts only;
 *  never fails the run it rides. */
async function storySweep(db, wake, now) {
  try {
    const { tags, counts } = await storiesToWake(db, { now });
    for (const tag of tags) await wake(tag, now);
    return { woken: tags.length, ...counts };
  } catch (err) {
    console.error(
      "timeline_story_sweep_failed",
      err?.code ?? err?.name ?? "error",
    );
    return { failed: err?.code ?? err?.name ?? "error" };
  }
}

/** Wake the timeline-sync lane for each account that read Home lately and
 *  whose stored week is past fresh (home_feed, 0245; #649). */
export async function homeFeeds(databaseUrl, { wakeOutbox = outbox } = {}) {
  const wake = homeWeekWake(wakeOutbox);
  if (!wake) return { skipped: "no_outbox" };
  const db = await openJobsClient(databaseUrl, { op: "home_feeds" });
  try {
    const now = Date.now();
    const accounts = await homeWeeksToWake(db, { now });
    for (const accountId of accounts) await wake(accountId, now);
    const processed = await clanLifecycle(db).drain();
    const stories = await storySweep(db, storyWake(wakeOutbox), now);
    return { woken: accounts.length, lifecycle_processed: processed, stories };
  } finally {
    await db.end();
  }
}

export async function sweepOperational(databaseUrl) {
  const db = await openJobsClient(databaseUrl, { op: "sweep_operational" });
  try {
    const war_unresolved = await warBattlesUnresolved(db);
    process.stdout.write(`${warUnresolvedEmf(war_unresolved)}\n`);
    const out = { war_unresolved };
    out.rate_limit = (
      await db.query(
        `delete from rate_limit where window_start < now() - interval '7 days'`,
      )
    ).rowCount;
    // Refusals answer "is something still presenting this?", which is a
    // question about now, not about March.
    out.credential_refusal = (
      await db.query(
        `delete from credential_refusal where day < current_date - 30`,
      )
    ).rowCount;
    // An address is a person's location, so it never outlives 30 days.
    // The retention trim deletes the whole row at 28 days, so this
    // normally finds nothing; it stays as the backstop for rows the trim
    // has not reached yet (its daily caps while a backlog drains, or a
    // run that errored), since only the address is time-critical. The
    // 90-day argument and capture-flag sweeps that sat beside it were
    // removed with the 28-day trim: a row that old is a trim failure the
    // trim's own next run fixes, and its body is gone from S3 at 28 days.
    out.viewer_ip_scrubbed = (
      await db.query(
        `update mcp_call_audit set viewer_ip = null
          where viewer_ip is not null and created_at < now() - interval '30 days'`,
      )
    ).rowCount;
    // The quality ledger of Elixir's Discord posts (0222): 90 days, as
    // the privacy and limits pages say.
    out.discord_quality = await purgeQuality(db);
    out.magic_login = (
      await db.query(
        `delete from magic_login where expires_at < now() - interval '30 days'`,
      )
    ).rowCount;
    // Comments (0282): a removed comment stays 30 days for an admin to
    // read back, then goes; every check row (and a refusal's words)
    // goes at 35 days, as the privacy page says.
    out.comment_removed = (
      await db.query(
        `delete from timeline_comment
          where status = 'removed' and removed_at < now() - interval '30 days'`,
      )
    ).rowCount;
    // Posts (0285): one an admin removed stays 30 days, as a comment.
    out.post_removed = (
      await db.query(
        `delete from account_post
          where status = 'removed' and removed_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.comment_check = (
      await db.query(
        `delete from comment_check where created_at < now() - interval '35 days'`,
      )
    ).rowCount;
    // A Discord round trip lives ten minutes and is used once (0233).
    out.discord_login = (
      await db.query(
        `delete from discord_login where expires_at < now() - interval '1 day'`,
      )
    ).rowCount;
    // A console session's address is kept no longer than a connection's
    // (limits.md: addresses are cleared after 30 days). An active
    // session rewrites it on every request; an idle one used to keep it
    // until the row itself went, 30 days after its sliding expiry.
    out.session_ip_scrubbed = (
      await db.query(
        `update session set last_seen_from = null
          where last_seen_from is not null
            and last_seen_at < now() - interval '30 days'`,
      )
    ).rowCount;
    out.session = (
      await db.query(
        `delete from session
         where sliding_expires_at < now() - interval '30 days'
            or (revoked_at is not null and revoked_at < now() - interval '30 days')`,
      )
    ).rowCount;
    out.oauth_token = (
      await db.query(
        `delete from oauth_token where expires_at < now() - interval '90 days'`,
      )
    ).rowCount;
    out.job_done = (
      await db.query(
        `delete from job where status = 'done' and done_at < now() - interval '7 days'`,
      )
    ).rowCount;
    out.collector_fetch_error = (
      await db.query(
        `delete from collector_fetch_error
         where recorded_at < now() - interval '7 days'`,
      )
    ).rowCount;
    out.job_dead = (
      await db.query(
        `delete from job where status = 'dead' and done_at < now() - interval '30 days'`,
      )
    ).rowCount;
    // An unclaimed collector bearer is a live credential sitting in
    // plaintext. Past its window it is unclaimable already (#31); this
    // stops it being READABLE too.
    out.provision_env_expired = (
      await db.query(
        `update gateway set provision_env = null, provision_expires_at = null
         where provision_env is not null and provision_expires_at <= now()`,
      )
    ).rowCount;
    return out;
  } finally {
    await db.end();
  }
}

/** The daily retention trim ({retention_trim: true}, EventBridge
 *  04:40Z): one year for the record and accounts' history, 28 days for
 *  operational logs (packages/record/src/retention.mjs declares which).
 *  Bounded per run; what is left goes the next day. */
export async function runRetentionTrim(databaseUrl, { remainingMs } = {}) {
  const db = await openJobsClient(databaseUrl, { op: "retention_trim" });
  try {
    return await retentionTrim(db, { remainingMs: remainingMs ?? null });
  } finally {
    await db.end();
  }
}

// Mail leaves through the outbox for the relay (packages/outbox/src/outbox.mjs).
// Its writes stop once the run is aborted (db.mjs guardS3).
const outbox = makeOutbox(process.env.OUTBOX_BUCKET, guardS3(new S3Client({})));
async function enqueueEmail(msg) {
  if (!outbox) throw new Error("OUTBOX_BUCKET is not set");
  await outbox(
    "email",
    msg,
    msg.issue_key?.startsWith("collector-upgrade/")
      ? { id: msg.send_id, once: true }
      : {},
  );
}

/** The archive bucket store every send's body goes to (email/archive.mjs);
 *  null without a bucket, which archives nothing and sends anyway. */
let mailArchive;
async function mailArchiveStore() {
  if (mailArchive !== undefined) return mailArchive;
  const bucket = process.env.ARCHIVE_BUCKET;
  if (!bucket) return (mailArchive = null);
  return (mailArchive = { s3: guardS3(new S3Client({})), bucket });
}

/** Whether the site bucket's card-art mirror holds a file (deliver's
 *  cardArt): an Evo or Hero whose image Supercell has not published yet
 *  (about two weeks after the API lists it) draws the base card in
 *  mail, which cannot fall back the way a page does. One HEAD per path
 *  per invocation; any error reads as "not held", so a mail draws the
 *  base card rather than a broken image. Null without a bucket. */
async function cardArtHeld() {
  const bucket = process.env.SITE_BUCKET;
  if (!bucket) return null;
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({});
  return (p) =>
    s3
      .send(
        new HeadObjectCommand({ Bucket: bucket, Key: p.replace(/^\//, "") }),
      )
      .then(
        () => true,
        () => false,
      );
}

/** What a sent mail's unsubscribe link is signed with (packages/mail
 *  unsubscribe.mjs): its own key once the app secret carries one, else
 *  the session secret, as every link before it was. */
function unsubscribeKeys() {
  return {
    unsubscribe: process.env.UNSUBSCRIBE_SECRET || null,
    session: process.env.SESSION_SECRET,
  };
}

/** The ops an event names, in the order the dispatch runs them: the
 *  run's limits are the widest of theirs (db.mjs). */
export function eventOps(event) {
  const ops = [];
  if (event?.clan_evaluate) ops.push("clan_evaluate");
  if (event?.discord_sittings) ops.push("discord_sittings");
  if (event?.home_feeds) ops.push("home_feeds");
  if (event?.collector_upgrades) ops.push("collector_upgrades");
  if (event?.feedback_answers) ops.push("feedback_answers");
  if (event?.activity_mail) ops.push("activity_mail");
  if (event?.web_push) ops.push("web_push");
  if (typeof event?.email === "string") ops.push("email");
  if (event?.retention_trim) ops.push("retention_trim");
  if (event?.week_form) ops.push("week_form");
  if (event?.shape_census) ops.push("shape_census");
  if (event?.capture_efficiency) ops.push("capture_efficiency");
  if (event?.public_stats) ops.push("public_stats");
  if (event?.archetype_stamp) ops.push("archetype_stamp");
  if (event?.sweep_payloads) ops.push("sweep_payloads");
  if (event?.sweep_operational) ops.push("sweep_operational", "sweep_fleet");
  if (event?.newsletter_sync) ops.push("newsletter_sync");
  if (event?.sweep_fleet) ops.push("sweep_fleet");
  return ops;
}

/** Every op runs as one job (db.mjs, #814): its connections time out,
 *  a lost connection ends it, and it settles by a deadline well under
 *  the Lambda's 900 s, so a stuck run never holds the one reserved
 *  slot. */
export async function handler(event, context, options = {}) {
  if (typeof event?.email === "string" && !isActiveEmailKind(event.email))
    return { skipped: inactiveEmailReason(event.email) };
  const ops = eventOps(event);
  if (ops.length === 0) throw new Error("jobs: no recognized op in event");
  return runJob(ops, context, () => dispatch(event), options);
}

async function dispatch(event) {
  if (event?.clan_evaluate) {
    const result = await runClanEvaluation({
      databaseUrl: process.env.DATABASE_URL,
      enqueue: enqueueEmail,
      secret: unsubscribeKeys(),
      archive: await mailArchiveStore(),
      sealingSecret: process.env.CLAN_MODEL_SECRET ?? null,
      outboxBucket: process.env.OUTBOX_BUCKET ?? null,
    });
    console.log(JSON.stringify({ clan_evaluate: result }));
    return result;
  }
  // The closing edit of a timeline sitting cross-posted to Discord while
  // still open (#454): its own five-minute rule wakes the sync for the
  // accounts whose open sitting has gone quiet.
  if (event?.discord_sittings) {
    const result = await closingSittings(process.env.DATABASE_URL);
    console.log(JSON.stringify({ discord_sittings: result }));
    return result;
  }
  // Home's stored weeks: its own five-minute rule wakes the builds of the
  // accounts that read Home lately (0245, #649).
  if (event?.home_feeds) {
    const result = await homeFeeds(process.env.DATABASE_URL);
    console.log(JSON.stringify({ home_feeds: result }));
    return result;
  }
  if (event?.collector_upgrades) {
    const spec =
      event.collector_upgrades === true ? {} : event.collector_upgrades;
    const result = await runCollectorUpgrades({
      databaseUrl: process.env.DATABASE_URL,
      enqueue: enqueueEmail,
      secret: unsubscribeKeys(),
      archive: await mailArchiveStore(),
      accountEmail: spec.account_email ?? null,
      replay: spec.replay ?? null,
      apply: spec.apply === true,
      remainingMs: runRemainingMs,
    });
    console.log(JSON.stringify({ collector_upgrades: result }));
    if (!event.feedback_answers) return result;
  }
  // Answers to feedback (0204) ride the collector upgrade drain's
  // one-minute rule ({"collector_upgrades": true, "feedback_answers":
  // true}), after it, so a failure here never holds an upgrade notice.
  if (event?.feedback_answers) {
    const result = await runFeedbackAnswers({
      databaseUrl: process.env.DATABASE_URL,
      enqueue: enqueueEmail,
      secret: unsubscribeKeys(),
      archive: await mailArchiveStore(),
      remainingMs: runRemainingMs,
    });
    console.log(JSON.stringify({ feedback_answers: result }));
    if (!event.web_push) return result;
  }
  // Web push (2026-11-16) rides the same one-minute rule last, when the
  // stack's WebPush is on: a failure here never holds a mail.
  if (event?.web_push) {
    const result = await runWebPush({
      databaseUrl: process.env.DATABASE_URL,
      outbox: outbox ? (lane, msg) => outbox(lane, msg) : null,
      remainingMs: runRemainingMs,
    });
    console.log(JSON.stringify({ web_push: result }));
    return result;
  }
  // The activity mail (2026-11-16): its own hourly rule; each run mails
  // the people whose evening hour it is.
  if (event?.activity_mail) {
    const result = await runActivityMail({
      databaseUrl: process.env.DATABASE_URL,
      enqueue: enqueueEmail,
      secret: unsubscribeKeys(),
      archive: await mailArchiveStore(),
      remainingMs: runRemainingMs,
      // A push the person opened told its part already (web push).
      pushToldAt: true,
    });
    console.log(JSON.stringify({ activity_mail: result }));
    // Stopped short of this hour's people: the async retry carries on,
    // as a scheduled mail run's does.
    if (result.incomplete)
      throw new Error(
        `activity_mail_incomplete: sent ${result.sent}, ${result.remaining} remaining`,
      );
    return result;
  }
  if (typeof event?.email === "string") {
    const result = await runEmail({
      databaseUrl: process.env.DATABASE_URL,
      kind: event.email,
      accountId: event.account_id ?? null,
      accountEmail: event.account_email ?? null,
      force: Boolean(event.force),
      enqueue: enqueueEmail,
      secret: unsubscribeKeys(),
      archive: await mailArchiveStore(),
      cardArt: await cardArtHeld(),
      remainingMs: runRemainingMs,
    });
    console.log(JSON.stringify({ email: result }));
    // A run that stopped short of its recipients fails the invocation,
    // so the async retry (JobsInvokeConfig) carries on from where
    // the ledger says it stopped, and the jobs errors alarm says a mail
    // run has outgrown one invocation.
    if (result.incomplete)
      throw new Error(
        `email_run_incomplete: ${event.email} sent ${result.sent}, ${result.remaining} remaining after ${result.ms} ms`,
      );
    return result;
  }
  if (event?.retention_trim) {
    const result = await runRetentionTrim(process.env.DATABASE_URL, {
      remainingMs: runRemainingMs,
    });
    console.log(JSON.stringify({ retention_trim: result }));
    return result;
  }
  // A week's form (0311): the Monday 16:15Z rule stores the readings of
  // the game week that closed at 10:00Z, once its grace has passed.
  if (event?.week_form) {
    const result = await runWeekForm(process.env.DATABASE_URL, {
      spec: event.week_form === true ? null : event.week_form,
      remainingMs: runRemainingMs,
    });
    console.log(JSON.stringify({ week_form: result }));
    if (result.incomplete)
      throw new Error(
        `week_form_incomplete: ${result.players} players to ${result.after}`,
      );
    return result;
  }
  if (event?.shape_census) {
    const result = await shapeCensus(process.env.DATABASE_URL);
    console.log(JSON.stringify({ shape_census: result }));
    return result;
  }
  if (event?.capture_efficiency) {
    const result = await captureEfficiency(process.env.DATABASE_URL);
    console.log(JSON.stringify({ capture_efficiency: result }));
    return result;
  }
  if (event?.public_stats) return publishPublicStats(process.env.DATABASE_URL);
  // The nightly catch-up of deck archetype stamps (0148). It rode the
  // battle-activity histogram's 05:30Z rule until that retired
  // (2026-11-13); the time and the work are unchanged.
  if (event?.archetype_stamp) {
    const result = {
      archetype_stamp: await archetypeStampNightly(process.env.DATABASE_URL),
    };
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.sweep_payloads) {
    const result = await sweepPayloads(process.env.DATABASE_URL);
    if (event?.sweep_operational) {
      result.operational = await sweepOperational(process.env.DATABASE_URL);
      result.fleet = await sweepSilentCollectors(process.env.DATABASE_URL, {
        enqueue: enqueueEmail,
      });
    }
    console.log(JSON.stringify(result));
    return result;
  }
  if (event?.sweep_operational) {
    const result = await sweepOperational(process.env.DATABASE_URL);
    result.fleet = await sweepSilentCollectors(process.env.DATABASE_URL, {
      enqueue: enqueueEmail,
    });
    console.log(JSON.stringify(result));
    return result;
  }
  // By hand only: the mailing list caught up with the accounts that
  // opted in ({"newsletter_sync": {"dry_run": false}}; a dry run counts).
  if (event?.newsletter_sync) {
    const result = await newsletterSync(process.env.DATABASE_URL, {
      dryRun: event.newsletter_sync?.dry_run !== false,
      enqueue: outbox ? (msg) => outbox("email", msg) : null,
    });
    console.log(JSON.stringify({ newsletter_sync: result }));
    return result;
  }
  if (event?.sweep_fleet) {
    const result = await sweepSilentCollectors(process.env.DATABASE_URL, {
      enqueue: enqueueEmail,
    });
    console.log(JSON.stringify(result));
    return result;
  }
  throw new Error("jobs: no recognized op in event");
}
