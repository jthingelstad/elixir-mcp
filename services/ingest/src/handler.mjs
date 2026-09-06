/**
 * Lambda handler shape for the results queue (SQS partial-batch response).
 *
 * Outcomes and retry semantics:
 *  - admitted / rejected / duplicate / fetch_error: processed, deleted.
 *  - bad_message: reported as a batch item failure -> SQS redrives ->
 *    DLQ after maxReceiveCount (a malformed message never heals).
 *  - thrown errors (DB down, etc.): batch item failure -> retry is correct.
 */

import pg from "pg";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { processResult } from "./pipeline.mjs";

/** The S3 payload archive (DATA-TOOLS §1). Absent bucket = no archive
 *  (local dev, tests); in prod the put is part of admission and a
 *  failure fails the message so SQS retries. */
export function makeArchive(bucket) {
  if (!bucket) return null;
  const s3 = new S3Client({});
  return {
    async put(key, bodyGzip) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bodyGzip,
          ContentType: "application/json",
          ContentEncoding: "gzip",
        }),
      );
    },
  };
}

export function makeHandler({ databaseUrl, archiveBucket }) {
  const archive = makeArchive(archiveBucket);
  return async function handler(event) {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const batchItemFailures = [];
    try {
      for (const record of event.Records ?? []) {
        let outcome;
        try {
          const message = JSON.parse(record.body);
          outcome = await processResult(
            client,
            message,
            archive ? { archive } : {},
          );
          // One structured line per message: Logs Insights reads these
          // for live-path performance (the census, permanently on).
          if (outcome.timings) {
            console.log(
              JSON.stringify({
                perf: message?.job?.endpoint,
                ...outcome.timings,
                ...(outcome.projection?.phase_race_ms !== undefined
                  ? {
                      race_ms: outcome.projection.phase_race_ms,
                      stamp_ms: outcome.projection.phase_stamp_ms,
                    }
                  : {}),
              }),
            );
          }
        } catch (err) {
          // The retry path must leave a trace: Lambda's Errors metric
          // never fires for handled batch failures (sol-6 F8).
          console.error("ingest_retry", record.messageId, err?.message);
          batchItemFailures.push({ itemIdentifier: record.messageId });
          continue;
        }
        if (outcome.outcome === "bad_message") {
          batchItemFailures.push({ itemIdentifier: record.messageId });
        }
      }
    } finally {
      await client.end();
    }
    return { batchItemFailures };
  };
}
