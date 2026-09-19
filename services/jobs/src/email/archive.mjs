/** The sent mail itself, kept: every product send's rendered HTML goes
 *  to the archive bucket under mail/sent/, keyed by the send's own id,
 *  so the console can show a person the email they were sent
 *  (/account/activity/emails) and a report about one can carry it.
 *
 *  Same split as call capture (services/mcp/src/capture.mjs): S3 holds
 *  the body, email_send holds the pointer (archived). Written BEFORE
 *  the enqueue so the footer's id opens something the moment the mail
 *  lands; a failed write logs mail_archive_failed and the row says
 *  archived=false. A send is never refused because the archive failed.
 *  Absent store (local dev, tests) = nothing archived. */
import { promisify } from "node:util";
import { gzip, gunzip } from "node:zlib";
import { PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";

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
