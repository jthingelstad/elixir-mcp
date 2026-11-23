/** The sent mail itself, kept: every product send's rendered HTML goes
 *  to the archive bucket under mail/sent/, keyed by the send's own id,
 *  so the console can show a person the email they were sent
 *  (/settings/emails/sent) and a report about one can carry it.
 *
 *  Same split as call capture (packages/tools/src/capture.mjs): S3 holds
 *  the body, email_send holds the pointer (archived). Written BEFORE
 *  the enqueue so the footer's id opens something the moment the mail
 *  lands; a failed write logs mail_archive_failed and the row says
 *  archived=false. A send is never refused because the archive failed.
 *  Absent store (local dev, tests) = nothing archived. */
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

/** Partitioned by the send's UTC day, like calls/, so a reader finds
 *  it from the row's enqueued_at and a lifecycle rule could scope it. */
export function sentMailKey(at, sendId) {
  const dt = new Date(at).toISOString().slice(0, 10);
  return `mail/sent/dt=${dt}/send_id=${sendId}.json.gz`;
}

export async function archiveSentMail({
  store,
  sendId,
  at = Date.now(),
  kind,
  subject,
  html,
  text,
}) {
  if (!store?.s3 || !store?.bucket) return false;
  try {
    const body = await gzipAsync(
      JSON.stringify({
        send_id: sendId,
        kind,
        subject,
        html,
        text,
        archived_at: new Date().toISOString(),
      }),
    );
    await store.s3.send(
      new PutObjectCommand({
        Bucket: store.bucket,
        Key: sentMailKey(at, sendId),
        Body: body,
        ContentType: "application/json",
        ContentEncoding: "gzip",
      }),
    );
    return true;
  } catch (err) {
    console.error("mail_archive_failed", sendId, err?.message);
    return false;
  }
}

/** The archived mail as written. Throws on a miss; the web API decides
 *  how to render that. */
export async function readSentMail({ store, at, sendId }) {
  const out = await store.s3.send(
    new GetObjectCommand({
      Bucket: store.bucket,
      Key: sentMailKey(at, sendId),
    }),
  );
  const raw = await out.Body.transformToByteArray();
  return JSON.parse((await gunzipAsync(raw)).toString("utf8"));
}

/** A deleted account's archived mail (2026-11-23): the bodies removed,
 *  best-effort, after the removal has committed. S3's batch delete, a
 *  thousand keys a call, each call capped at five seconds, so a long mail
 *  history stays inside the web handler's deadline (Codex on #1218).
 *  Never throws; answers how many went and how many did not, so the
 *  caller logs counts and never a key. Absent store = nothing deleted. */
export async function deleteSentMail({ store, sends, timeoutMs = 5_000 }) {
  if (!store?.s3 || !store?.bucket || !sends?.length)
    return { deleted: 0, failed: 0 };
  const keys = sends.map(({ enqueued_at: at, send_id: sendId }) =>
    sentMailKey(at, sendId),
  );
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    try {
      const out = await store.s3.send(
        new DeleteObjectsCommand({
          Bucket: store.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
        }),
        { abortSignal: AbortSignal.timeout(timeoutMs) },
      );
      const errors = out?.Errors?.length ?? 0;
      failed += errors;
      deleted += batch.length - errors;
    } catch {
      failed += batch.length;
    }
  }
  return { deleted, failed };
}
