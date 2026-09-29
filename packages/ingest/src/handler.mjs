/**
 * The S3 payload archive helper (docs/archive/DATA-TOOLS-2026-09-04.md §1). The SQS ingest
 * Lambda retired for the job ledger at 0040; the collector door runs
 * processResult inline and builds this archive for it. Nothing else
 * writes `payloads/`.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

/** True when S3 refused a write-once put because the key already exists. */
function alreadyArchived(err) {
  return (
    err?.name === "PreconditionFailed" || err?.$metadata?.httpStatusCode === 412
  );
}

/**
 * The S3 payload archive. Absent bucket = no archive (local dev, tests).
 * In production the put is part of admission: a failure throws, the
 * transaction rolls back, and the door answers 500 so the lease expires
 * and the job is refetched.
 *
 * Write-once (review 2026-09-27 §2.7): the archive is kept forever and
 * content-addressed, so every put carries `If-None-Match: *` and never
 * replaces an object. A 412 means the key is already there, which is
 * what a retried submit of the same fetch produces (the key is built
 * from its fetched_at and hash): it is already archived, not a failure.
 * The ArchiveBucket policy denies a `payloads/` put without the header.
 */
export function makeArchive(bucket, { s3 } = {}) {
  if (!bucket) return null;
  const client = s3 ?? new S3Client({});
  return {
    async put(key, bodyGzip) {
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: bodyGzip,
            ContentType: "application/json",
            ContentEncoding: "gzip",
            IfNoneMatch: "*",
          }),
        );
      } catch (err) {
        if (alreadyArchived(err)) return;
        throw err;
      }
    },
  };
}
