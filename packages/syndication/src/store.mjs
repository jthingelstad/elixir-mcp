/** The relay's records in the outbox bucket (timeline-discord-state/):
 *  each post's message id, written with S3's conditional writes, and the
 *  account's delivery status. Read by the relay, and the status by the
 *  sync and the console. No payloads, keys or responses logged. */
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { timelineDiscordStatusKey } from "@elixir-mcp/contracts";

const STATE =
  /^timeline-discord-state\/[a-f0-9-]{36}\/[^/]+(?:\/[^/]+)?\.json$/;
const signal = () => ({ abortSignal: AbortSignal.timeout(5000) });
const precondition = (err) =>
  err?.name === "PreconditionFailed" ||
  err?.$metadata?.httpStatusCode === 412 ||
  err?.$metadata?.httpStatusCode === 409;

export function timelineDiscordStore(
  bucket,
  s3 = new S3Client({ maxAttempts: 2 }),
) {
  if (!bucket) throw new Error("the timeline's Discord records need a bucket");

  /** { text, etag } or null when there is no such object. */
  async function getText(key) {
    try {
      const out = await s3.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        signal(),
      );
      return { text: await out.Body.transformToString(), etag: out.ETag };
    } catch (e) {
      if (["NoSuchKey", "NotFound"].includes(e.name)) return null;
      // A role allowed to list only these records' own keys is answered
      // AccessDenied for a missing one. Confirm its absence by listing the
      // exact key (as Clan's bridges do); anything else keeps the error.
      if (e.name === "AccessDenied" && STATE.test(key)) {
        const listed = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: key, MaxKeys: 1 }),
          signal(),
        );
        if (
          (listed.KeyCount ?? listed.Contents?.length) === 0 &&
          !listed.IsTruncated
        )
          return null;
      }
      throw e;
    }
  }

  async function putJson(key, body, condition = {}) {
    try {
      const out = await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          ContentType: "application/json",
          ServerSideEncryption: "AES256",
          Body: JSON.stringify(body),
          ...condition,
        }),
        signal(),
      );
      return out.ETag ?? "";
    } catch (e) {
      if (precondition(e)) return null;
      throw e;
    }
  }

  return {
    async read(key) {
      const got = await getText(key);
      return got ? { body: JSON.parse(got.text), etag: got.etag } : null;
    },
    /** The new etag, or null when the key already exists. */
    create: (key, body) => putJson(key, body, { IfNoneMatch: "*" }),
    /** The new etag, or null when the object changed since `etag`. */
    replace: (key, body, etag) => putJson(key, body, { IfMatch: etag }),
    async put(key, body) {
      await putJson(key, body);
    },
    async remove(key) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        signal(),
      );
    },
    /** An outbox object's text, or null once it is gone. */
    async readObject({ bucket: b, key }) {
      if (b !== bucket) throw new Error("timeline_discord_unknown_bucket");
      try {
        const out = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          signal(),
        );
        return await out.Body.transformToString();
      } catch (e) {
        if (["NoSuchKey", "NotFound"].includes(e.name)) return null;
        throw e;
      }
    },
    async deleteObject({ key }) {
      await s3.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: key }),
        signal(),
      );
    },
  };
}

/** The relay's last word on an account's webhook (contracts
 *  TimelineDiscordStatus), or null when it has written none. */
export function makeStatusReader(bucket, s3) {
  if (!bucket) return async () => null;
  const store = timelineDiscordStore(bucket, s3);
  return async (accountId) =>
    (await store.read(timelineDiscordStatusKey(accountId)))?.body ?? null;
}
