/** The sending half of the outbox (2026-09-24; the contract is
 *  packages/contracts, outboxKey). A VPC Lambda reaches S3 through the
 *  free gateway endpoint and nothing else, so a message for the relay is one JSON object here; S3 notifies that lane's queue and
 *  the worker deletes the object once it has acted on it. */

import { randomUUID } from "node:crypto";
import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { outboxKey } from "@elixir-mcp/contracts";

/** `send(lane, message)`, or null without a bucket (tests, local runs). */
export function makeOutbox(bucket, s3 = new S3Client({})) {
  if (!bucket) return null;
  return async (lane, message, { id = randomUUID(), once = false } = {}) => {
    try {
      return await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: outboxKey(lane, id),
          ...(once ? { IfNoneMatch: "*" } : {}),
          ContentType: "application/json",
          Body: JSON.stringify(message),
        }),
      );
    } catch (err) {
      if (once && err?.$metadata?.httpStatusCode === 412) return;
      throw err;
    }
  };
}

/** Past each lane's last retry, the queue's retry window: an object
 *  still here then is what dead-lettered, since the worker deletes every
 *  object it acted on. Email retries five times two minutes apart. */
const STUCK_AFTER_MINUTES = { email: 15 };

export async function countStuck(
  bucket,
  { s3 = new S3Client({}), now = Date.now() } = {},
) {
  let stuck = 0;
  let token;
  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: "email/",
        ContinuationToken: token,
      }),
    );
    for (const o of page.Contents ?? []) {
      const minutes = STUCK_AFTER_MINUTES[o.Key.split("/")[0]];
      if (minutes === undefined) continue;
      if (new Date(o.LastModified).getTime() < now - minutes * 60_000)
        stuck += 1;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return stuck;
}
