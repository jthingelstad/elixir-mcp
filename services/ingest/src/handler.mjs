/**
 * The S3 payload archive helper (DATA-TOOLS §1). Once the SQS ingest
 * Lambda retired for the job ledger (0040), the door runs processResult
 * inline; this module survives only to build the archive dep both the
 * door and migrate use.
 */

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

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
